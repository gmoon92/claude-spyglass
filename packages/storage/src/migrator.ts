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
 * - 012-timestamp-index-and-visible-view.sql → version 12
 *
 * 실행 흐름:
 * 1. 현재 PRAGMA user_version 조회
 * 2. migrations/ 디렉토리 .sql 파일 정렬 (파일명 기준)
 * 3. 파일명에서 버전 파싱 (001, 002, ...)
 * 4. currentVersion보다 큰 파일만 트랜잭션으로 실행
 * 5. 각 파일 적용 후 PRAGMA user_version = N 자동 설정
 * 6. 실패 시 트랜잭션 롤백 + 예외 throw
 * 7. debug 옵션 켜져 있을 때만 console.log 출력
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Database } from 'bun:sqlite';

const MIGRATIONS_DIR = join(import.meta.dir, '..', 'migrations');

/**
 * 파일 기반 마이그레이션 실행
 *
 * @param db Bun SQLite Database 인스턴스
 * @param debug 디버그 로깅 활성화 여부 (기본값: false)
 * @throws 마이그레이션 실행 중 SQL 오류 발생 시
 */
export function runMigrations(db: Database, debug: boolean = false): void {
  try {
    // 현재 user_version 조회
    const currentResult = db.query('PRAGMA user_version').get() as { user_version: number } | undefined;
    const currentVersion = currentResult?.user_version ?? 0;

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
      return;
    }

    if (debug && files.length > 0) {
      console.log(`[migrator] Found ${files.length} migration files`);
    }

    // 각 마이그레이션 파일 순차 실행
    for (const file of files) {
      // 파일명에서 버전 파싱 (예: 001-init.sql → 1)
      const versionStr = file.slice(0, 3);
      const version = parseInt(versionStr, 10);

      // 유효하지 않은 파일명은 스킵
      if (isNaN(version)) {
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

        // 파일 내용 실행 (주석 제거 후 세미콜론 분리)
        const stmts = sql
          .replace(/--[^\n]*/g, '')
          .split(';')
          .map(s => s.trim())
          .filter(s => s.length > 0);

        // PRAGMA가 아닌 DDL/DML은 트랜잭션으로 감싸기
        const nonPragmaStmts = stmts.filter(s => !s.toUpperCase().startsWith('PRAGMA'));
        const pragmaStmts = stmts.filter(s => s.toUpperCase().startsWith('PRAGMA'));

        // user_version을 트랜잭션 안에서 설정하여 DDL과 버전 갱신을 원자적으로 처리
        // (트랜잭션 커밋 후 프로세스 종료 시 버전 불일치 방지)
        db.transaction(() => {
          for (const stmt of nonPragmaStmts) {
            try {
              db.prepare(stmt).run();
            } catch (e: unknown) {
              const msg: string = (e as Error)?.message ?? '';
              // 이미 적용된 DDL(컬럼/테이블 중복)은 건너뜀 — 비정상 종료로 인한 버전 불일치 복구
              if (msg.includes('duplicate column name') || msg.includes('already exists')) {
                if (debug) {
                  console.log(`[migrator] Skipping already-applied statement in ${file}: ${stmt.slice(0, 60)}`);
                }
                continue;
              }
              throw e;
            }
          }
          db.prepare(`PRAGMA user_version = ${version}`).run();
        })();

        // 파일에 명시된 다른 PRAGMA는 트랜잭션 밖에서 실행
        for (const stmt of pragmaStmts) {
          db.prepare(stmt).run();
        }

        if (debug) {
          console.log(`[migrator] Applied ${file} (version ${version})`);
        }
      } catch (error) {
        console.error(`[migrator] Error applying ${file}: ${error}`);
        throw error;
      }
    }

    if (debug) {
      const finalResult = db.query('PRAGMA user_version').get() as { user_version: number } | undefined;
      console.log(`[migrator] Migration complete. Final version: ${finalResult?.user_version ?? 'unknown'}`);
    }
  } catch (error) {
    console.error(`[migrator] Fatal error during migrations: ${error}`);
    throw error;
  }
}
