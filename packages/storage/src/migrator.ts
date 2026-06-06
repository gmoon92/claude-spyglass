/**
 * 파일 기반 마이그레이션 로더
 *
 * @description
 * `packages/storage/migrations/` 디렉토리의 SQL 파일을 스캔하여
 * 현재 DB 버전보다 높은 마이그레이션만 순차 실행한다.
 * 각 파일명은 `NNN-description.sql` 형식이며, NNN은 버전 번호이다.
 *
 * 파일 버전 → PRAGMA user_version 자동 매핑:
 * - 001-init.sql → version 1
 * - 002-add-tool-detail.sql → version 2
 * - ...
 * - 035-add-migrations-meta-table.sql → version 35
 *
 * 실행 흐름:
 * 1. 현재 PRAGMA user_version 조회
 * 2. migrations/ 디렉토리 .sql 파일 정렬 (파일명 기준)
 * 3. 파일명에서 버전 파싱 (001, 002, ...) — 3자리 padding 한도(001~999) 강제
 * 4. currentVersion보다 큰 파일만 트랜잭션으로 실행
 * 5. 각 파일 적용 후 PRAGMA user_version = N 자동 설정
 * 6. v35 이후 메타테이블(`_migrations`) 존재 시 동일 트랜잭션에서 히스토리 INSERT
 * 7. 실패 시 트랜잭션 롤백 + 예외 throw
 * 8. debug 옵션 켜져 있을 때만 console.log 출력
 *
 * @see .claude/docs/plans/auto-update-migration-hardening/adr.md
 *   ADR-001: `_migrations` 메타테이블 (PRAGMA + 메타테이블 병행)
 *   ADR-002: 마이그레이션 번호 999 한도 (silent overflow 가드)
 *   ADR-006: 부팅 panic 로그 fsync + 후속 부팅 lag 감지
 */

import { readdirSync, readFileSync, appendFileSync, openSync, fsyncSync, closeSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { Database } from 'bun:sqlite';

// 마이그레이션 SQL 디렉토리 — packaged 환경(Electron desktop)에서는
// `import.meta.dir`이 standalone executable 가상 경로(`/$bunfs/root/...`)를 반환해
// 실제 파일에 도달하지 못한다. 그래서 `SPYGLASS_MIGRATIONS_ROOT` env 가 설정돼 있으면
// 그 절대 경로를 사용한다 (Electron 메인 프로세스가 동봉 위치를 주입).
// dev 모드에서는 env 미설정 → 기존 동작 그대로.
const MIGRATIONS_DIR = process.env.SPYGLASS_MIGRATIONS_ROOT
  ? process.env.SPYGLASS_MIGRATIONS_ROOT
  : join(import.meta.dir, '..', 'migrations');

// =============================================================================
// ADR-002: 마이그레이션 번호 한도 (001~999, 3자리 padding)
// =============================================================================
//
// `file.slice(0, 3)`로 앞 3자리를 버전으로 파싱하는 컨벤션 — 1000번이 들어오면
// `slice(0,3)`이 `100`을 반환해 silent overflow가 발생할 수 있다(`100`을 기존
// 100번보다 작은 버전으로 오해 → 스킵 또는 잘못된 순서 적용).
//
// 999 도달 시점에 4자리 padding 확장을 별도 ADR로 결정한다 (yagni — 현재 35번).
// =============================================================================
const MIGRATION_VERSION_LIMIT = 999;

// 이 버전 이상부터 `_migrations` 메타테이블에 INSERT 수행. v35 자체는 메타테이블을
// CREATE하는 트랜잭션 안에서 동시에 자기 자신 행을 INSERT한다.
const META_TABLE_INTRODUCED_AT = 35;

// =============================================================================
// 모듈 상태 — 마지막 마이그레이션 실행 결과 (API 응답·테스트 용도)
// =============================================================================

/**
 * `runMigrations()` 1회 실행의 결과 요약. `/api/update` 응답의
 * `migrationsApplied` 필드 SSoT — 외부에서 변경 금지(읽기 전용).
 */
export interface MigrationRunResult {
  /** 실행 시작 시점 PRAGMA user_version */
  from: number;
  /** 실행 종료 시점 PRAGMA user_version */
  to: number;
  /** 이번 실행에서 새로 적용된 SQL 파일명 (적용 순서 보존) */
  files: string[];
  /** 본 실행 누적 소요 시간 (ms) */
  durationMs: number;
}

let lastRunResult: MigrationRunResult = {
  from: 0,
  to: 0,
  files: [],
  durationMs: 0,
};

/** 마지막 `runMigrations()` 결과 조회 — `/api/update` 응답 회수에 사용. */
export function getLastMigrationRun(): MigrationRunResult {
  return { ...lastRunResult, files: [...lastRunResult.files] };
}

/**
 * 부팅 직후 user_version과 디렉토리 최신 파일 버전 비교.
 * 이전 부팅에서 마이그레이션이 실패했다면 `current < latest`로 lag 감지.
 */
export interface MigrationLag {
  /** 현재 적용된 user_version */
  current: number;
  /** 디렉토리에서 발견된 최신 파일 번호 */
  latest: number;
  /** 최신 파일명 (lag 진단 메시지에 노출) */
  latestFile: string | null;
}

export function detectMigrationLag(db: Database): MigrationLag {
  const currentResult = db.query('PRAGMA user_version').get() as { user_version: number } | undefined;
  const current = currentResult?.user_version ?? 0;

  let files: string[];
  try {
    files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  } catch {
    return { current, latest: current, latestFile: null };
  }

  // 가장 큰 버전 파일 찾기 — slice(0,3) 한도 가드 통과 파일만 인정
  let latest = 0;
  let latestFile: string | null = null;
  for (const file of files) {
    const versionStr = file.slice(0, 3);
    const version = parseInt(versionStr, 10);
    if (isNaN(version) || version < 1 || version > MIGRATION_VERSION_LIMIT) continue;
    if (version > latest) {
      latest = version;
      latestFile = file;
    }
  }

  return { current, latest, latestFile };
}

/**
 * `_migrations` 테이블 존재 여부 — 마이그레이션 적용 트랜잭션 안에서
 * INSERT 가능 여부를 판단하기 위해 사용.
 */
function hasMigrationsMetaTable(db: Database): boolean {
  const row = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'")
    .get() as { name: string } | undefined;
  return !!row;
}

/**
 * `_migrations` 최신 row의 filename 조회 — `/api/version` 응답 SSoT.
 * 메타테이블이 없거나 비어있으면 null.
 */
export function getLatestMigrationFile(db: Database): string | null {
  try {
    if (!hasMigrationsMetaTable(db)) return null;
    const row = db
      .query(
        `SELECT filename FROM _migrations
         WHERE filename != '(legacy)'
         ORDER BY version DESC LIMIT 1`,
      )
      .get() as { filename: string } | undefined;
    if (row?.filename) return row.filename;
    // legacy 백필만 있으면 가장 큰 version의 filename 그대로 반환
    const legacy = db
      .query(`SELECT filename FROM _migrations ORDER BY version DESC LIMIT 1`)
      .get() as { filename: string } | undefined;
    return legacy?.filename ?? null;
  } catch {
    return null;
  }
}

/**
 * `package.json#version` 조회 — `_migrations.app_version` 컬럼 주입용.
 * 환경 변수(`SPYGLASS_APP_VERSION`)가 있으면 우선 사용 (테스트·CI 주입).
 *
 * 실패 시 null 반환 — 메타테이블은 NULL 허용.
 */
function readAppVersion(): string | null {
  if (process.env.SPYGLASS_APP_VERSION) {
    return process.env.SPYGLASS_APP_VERSION;
  }
  try {
    // packages/storage/src/migrator.ts → 프로젝트 루트 package.json
    const pkgPath = join(import.meta.dir, '..', '..', '..', 'package.json');
    const raw = readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

/**
 * SQL 문을 statement 단위로 분리.
 *
 * 단순 `split(';')`은 `CREATE TRIGGER ... BEGIN ... END;` 같은 복합문
 * 내부 세미콜론까지 분리해 SQL을 깨뜨린다. 본 함수는 `BEGIN ... END;`
 * 블록을 placeholder로 치환해 보존한 뒤 split하고 다시 복원한다.
 *
 *   1) 라인 주석(`--...`) 제거
 *   2) `BEGIN ... END;` 블록을 정규식으로 추출 → placeholder 치환
 *   3) 나머지 텍스트를 `split(';')`로 분리
 *   4) 각 statement에서 placeholder를 원본 블록으로 복원
 */
function splitSqlStatements(sql: string): string[] {
  const cleaned = sql.replace(/--[^\n]*/g, '');
  const triggerBlocks: string[] = [];
  const placeholderPrefix = '___SPYGLASS_TRG_';
  const placeholderSuffix = '___';

  // `;`는 placeholder 밖에 남겨야 split이 정상 분리한다. lookahead로 종료 세미콜론을
  // 매칭만 하고 캡처에는 포함하지 않는다 — placeholder는 `BEGIN…END`까지만 보존.
  const transformed = cleaned.replace(/BEGIN\s+[\s\S]*?\s+END(?=\s*;)/gi, (match) => {
    const idx = triggerBlocks.length;
    triggerBlocks.push(match);
    return `${placeholderPrefix}${idx}${placeholderSuffix}`;
  });

  const stmts = transformed
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const placeholderRe = new RegExp(`${placeholderPrefix}(\\d+)${placeholderSuffix}`, 'g');
  return stmts.map((stmt) =>
    stmt.replace(placeholderRe, (_full, idx) => triggerBlocks[parseInt(idx, 10)])
  );
}

/**
 * 마이그레이션 파일명에서 버전 번호를 파싱.
 *
 * ADR-002 가드 — 999 초과 또는 4자리 이상이면 즉시 throw.
 * `isNaN`은 호출 측에서 스킵 처리 가능하도록 null 반환 (가드 정의에 따라 분기).
 *
 * @returns 정상 파싱된 버전 번호 (1~999) 또는 null (스킵 가능한 invalid 파일명)
 * @throws {Error} 4자리 이상 padding 등 SSoT 위반 (silent overflow 차단)
 */
export function parseMigrationVersion(file: string): number | null {
  // 파일명 앞에서 연속된 숫자 prefix만 떼낸다 — 3자리를 초과하면 본 컨벤션 위반.
  const match = file.match(/^(\d+)/);
  if (!match) return null;

  const digitPrefix = match[1];
  if (digitPrefix.length > 3) {
    throw new Error(
      `[migrator] Migration version exceeds 999: "${file}" has ${digitPrefix.length}-digit prefix. ` +
      `001~999 (3-digit padding) is the SSoT limit (ADR-002). ` +
      `4-digit expansion requires a new ADR — rename all migration files and update slice(0,3) parsing.`,
    );
  }

  const version = parseInt(digitPrefix.slice(0, 3), 10);
  if (isNaN(version)) return null;

  if (version > MIGRATION_VERSION_LIMIT) {
    throw new Error(
      `[migrator] Migration version ${version} exceeds limit ${MIGRATION_VERSION_LIMIT} (ADR-002).`,
    );
  }

  return version;
}

/**
 * 부팅 마이그레이션 panic 직전 로그를 `~/.spyglass/logs/server.log`에
 * 강제 동기화 후 process 종료를 신뢰할 수 있게 만든다 (ADR-006).
 *
 * - 디렉토리 없으면 mkdirSync(recursive)
 * - appendFileSync로 한 줄 기록 → openSync(O_WRONLY) → fsyncSync → closeSync
 * - 실패해도 throw 금지 (panic 경로 이중 실패 방지)
 */
function flushPanicLog(error: unknown, file: string | null): void {
  try {
    const home = process.env.HOME || process.env.USERPROFILE || '/tmp';
    const logDir = join(home, '.spyglass', 'logs');
    const logPath = join(logDir, 'server.log');

    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    const ts = new Date().toISOString();
    const msg = (error as Error)?.stack || (error as Error)?.message || String(error);
    const line =
      `[${ts}] [migrator] PANIC during migration${file ? ` "${file}"` : ''}\n` +
      `${msg}\n` +
      `---\n`;

    appendFileSync(logPath, line, { encoding: 'utf-8' });

    // fsync로 디스크 도달 보장 — Node/Bun stderr buffer가 panic 직전 손실되는 사례 차단
    const fd = openSync(logPath, 'r+');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // panic 경로 이중 실패는 무시 — 가능한 한 원본 에러를 호출 측이 throw하도록 함
  }
}

/**
 * 파일 기반 마이그레이션 실행
 *
 * @param db Bun SQLite Database 인스턴스
 * @param debug 디버그 로깅 활성화 여부 (기본값: false)
 * @throws 마이그레이션 실행 중 SQL 오류 발생 시
 */
export function runMigrations(db: Database, debug: boolean = false): void {
  const runStartedAt = Date.now();
  const appliedFiles: string[] = [];
  let fromVersion = 0;
  let toVersion = 0;
  let currentFile: string | null = null;

  try {
    // 현재 user_version 조회
    const currentResult = db.query('PRAGMA user_version').get() as { user_version: number } | undefined;
    const currentVersion = currentResult?.user_version ?? 0;
    fromVersion = currentVersion;
    toVersion = currentVersion;

    if (debug) {
      console.log(`[migrator] Current version: ${currentVersion}`);
    }

    // migrations/ 디렉토리의 .sql 파일 목록 조회 및 정렬
    let files: string[];
    try {
      files = readdirSync(MIGRATIONS_DIR)
        .filter(f => f.endsWith('.sql'))
        .sort();
    } catch (error) {
      if (debug) {
        console.log(`[migrator] Migrations directory not found or error reading: ${error}`);
      }
      lastRunResult = {
        from: fromVersion,
        to: toVersion,
        files: appliedFiles,
        durationMs: Date.now() - runStartedAt,
      };
      return;
    }

    if (debug && files.length > 0) {
      console.log(`[migrator] Found ${files.length} migration files`);
    }

    const appVersion = readAppVersion();

    // 각 마이그레이션 파일 순차 실행
    for (const file of files) {
      currentFile = file;
      // ADR-002 가드 — 파일명에서 버전 파싱 (999 초과는 throw)
      const version = parseMigrationVersion(file);
      if (version === null) {
        if (debug) {
          console.log(`[migrator] Skipping invalid filename: ${file}`);
        }
        continue;
      }

      // 현재 버전보다 낮거나 같은 마이그레이션은 스킵
      if (version <= currentVersion) {
        if (debug) {
          console.log(`[migrator] Skipping ${file} (version ${version} <= current ${currentVersion})`);
        }
        continue;
      }

      const filePath = join(MIGRATIONS_DIR, file);

      try {
        // SQL 파일 읽기
        const sql = readFileSync(filePath, 'utf8');

        if (debug) {
          console.log(`[migrator] Applying ${file}...`);
        }

        // 파일 내용 실행 (트리거 BEGIN…END; 블록을 보존하며 분리)
        const stmts = splitSqlStatements(sql);

        // PRAGMA가 아닌 DDL/DML은 트랜잭션으로 감싸기
        const nonPragmaStmts = stmts.filter(s => !s.toUpperCase().startsWith('PRAGMA'));
        const pragmaStmts = stmts.filter(s => s.toUpperCase().startsWith('PRAGMA'));

        const fileStartedAt = Date.now();

        // user_version을 트랜잭션 안에서 설정하여 DDL과 버전 갱신을 원자적으로 처리
        // (트랜잭션 커밋 후 프로세스 종료 시 버전 불일치 방지)
        db.transaction(() => {
          for (const stmt of nonPragmaStmts) {
            try {
              db.prepare(stmt).run();
            } catch (e: unknown) {
              const msg: string = (e as Error)?.message ?? '';
              // 이미 적용된 DDL/DML은 건너뜀 — 비정상 종료(PRAGMA 후퇴)로 인한 버전 불일치 복구.
              //   - 'duplicate column name' / 'already exists': ADD COLUMN·CREATE 재실행.
              //   - 'no such column': DROP COLUMN(063: requests.payload/payload_algo) 또는 이미 DROP된
              //     컬럼을 참조하는 후속 DML(056의 `UPDATE requests SET payload_algo=NULL`) 재실행.
              //     SQLite는 DROP COLUMN에 IF EXISTS를 미지원하므로, 이미 적용된 DROP의 재실행은
              //     "no such column"으로 실패한다 → 이미-적용으로 간주해 skip(063 멱등성 SSoT).
              if (
                msg.includes('duplicate column name') ||
                msg.includes('already exists') ||
                msg.includes('no such column')
              ) {
                if (debug) {
                  console.log(`[migrator] Skipping already-applied statement in ${file}: ${stmt.slice(0, 60)}`);
                }
                continue;
              }
              throw e;
            }
          }
          db.prepare(`PRAGMA user_version = ${version}`).run();

          // ADR-001: 메타테이블이 존재할 때 적용 히스토리 INSERT (동일 트랜잭션 — 원자성 보장).
          //   - v35(메타테이블 생성 자체) 마이그레이션은 위 nonPragmaStmts 실행으로 _migrations가
          //     생성된 직후 본 분기로 진입 — 자기 자신 행을 INSERT 가능.
          //   - v35 미만 마이그레이션이 적용되는 동안에는 메타테이블이 아직 없어 hasMigrationsMetaTable
          //     이 false → INSERT 스킵. v35 적용 시 legacy 백필이 1..34 행을 일괄 채움.
          if (version >= META_TABLE_INTRODUCED_AT && hasMigrationsMetaTable(db)) {
            const durationMs = Date.now() - fileStartedAt;
            const appliedAt = Math.floor(Date.now() / 1000); // unix epoch seconds
            db.prepare(
              `INSERT OR REPLACE INTO _migrations (version, filename, applied_at, app_version, duration_ms)
               VALUES (?, ?, ?, ?, ?)`,
            ).run(version, file, appliedAt, appVersion, durationMs);
          }
        })();

        // 파일에 명시된 다른 PRAGMA는 트랜잭션 밖에서 실행
        for (const stmt of pragmaStmts) {
          db.prepare(stmt).run();
        }

        const elapsed = Date.now() - fileStartedAt;
        appliedFiles.push(file);
        toVersion = version;

        if (debug) {
          console.log(`[migrator] Applied ${file} (version ${version}, ${elapsed}ms)`);
        }
      } catch (error) {
        console.error(`[migrator] Error applying ${file}: ${error}`);
        flushPanicLog(error, file);
        throw error;
      }
    }

    if (debug) {
      const finalResult = db.query('PRAGMA user_version').get() as { user_version: number } | undefined;
      console.log(`[migrator] Migration complete. Final version: ${finalResult?.user_version ?? 'unknown'}`);
    }

    // 모듈 상태 갱신 — `/api/update` 응답이 본 결과를 회수
    lastRunResult = {
      from: fromVersion,
      to: toVersion,
      files: appliedFiles,
      durationMs: Date.now() - runStartedAt,
    };
  } catch (error) {
    console.error(`[migrator] Fatal error during migrations: ${error}`);
    flushPanicLog(error, currentFile);
    // 실패 시점 상태도 lastRunResult에 기록 — 진단 가능성 보존
    lastRunResult = {
      from: fromVersion,
      to: toVersion,
      files: appliedFiles,
      durationMs: Date.now() - runStartedAt,
    };
    throw error;
  }
}
