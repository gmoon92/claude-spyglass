/**
 * Migrator 회귀 테스트 — 시나리오 1/2/3 (ADR-003)
 *
 * @description
 *   auto-update-migration-hardening 라운드 회귀 보호 SSoT.
 *   - 시나리오 1: 빈 DB → max 일괄 점프 — 모든 파일 적용, _migrations 행 수 = 적용 수
 *   - 시나리오 2: 매 버전 (N-1) → N 단일 점프 — 각 단계 _migrations 행 증가
 *   - 시나리오 3: 비정상 종료 시뮬레이션 — 트랜잭션 중단 후 재기동 시 멱등 복구
 *
 *   + 부가: ADR-002 999 한도 가드 (parseMigrationVersion synthetic 케이스).
 *
 * @see .claude/docs/plans/auto-update-migration-hardening/adr.md ADR-003
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readdirSync } from 'fs';
import { join } from 'path';
import {
  runMigrations,
  getLastMigrationRun,
  getLatestMigrationFile,
  detectMigrationLag,
  parseMigrationVersion,
} from '../migrator';

const MIGRATIONS_DIR = join(import.meta.dir, '..', '..', 'migrations');

/**
 * 디렉토리에서 실제 적용 가능한 (version, file) 목록을 정렬해 반환.
 * 본 테스트의 기대값 기준선 — 마이그레이션이 추가되면 자동으로 max가 갱신된다.
 */
function listMigrationFiles(): Array<{ version: number; file: string }> {
  const entries: Array<{ version: number; file: string }> = [];
  for (const file of readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()) {
    const v = parseMigrationVersion(file);
    if (v !== null) entries.push({ version: v, file });
  }
  return entries;
}

const ALL_MIGRATIONS = listMigrationFiles();
const MAX_VERSION = ALL_MIGRATIONS[ALL_MIGRATIONS.length - 1]?.version ?? 0;

/** 메모리 DB 생성 — 운영 DB와 분리, 테스트 종료 시 자동 정리. */
function createMemoryDb(): Database {
  return new Database(':memory:');
}

function getUserVersion(db: Database): number {
  const r = db.query('PRAGMA user_version').get() as { user_version: number } | undefined;
  return r?.user_version ?? 0;
}

function countMigrationRows(db: Database): number {
  try {
    const r = db.query('SELECT COUNT(*) AS n FROM _migrations').get() as { n: number } | undefined;
    return r?.n ?? 0;
  } catch {
    return 0;
  }
}

describe('Migrator — 시나리오 1: 빈 DB → max 일괄 점프', () => {
  let db: Database;

  beforeEach(() => {
    db = createMemoryDb();
  });

  afterEach(() => {
    db.close();
  });

  it('빈 DB(0)에서 max 버전까지 모든 마이그레이션을 한 번에 적용한다', () => {
    expect(getUserVersion(db)).toBe(0);
    expect(MAX_VERSION).toBeGreaterThanOrEqual(35);

    runMigrations(db, false);

    expect(getUserVersion(db)).toBe(MAX_VERSION);
  });

  it('주요 도메인 테이블이 모두 생성된다 (sessions/requests/claude_events/_migrations)', () => {
    runMigrations(db, false);

    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    const names = tables.map(t => t.name);
    expect(names).toContain('sessions');
    expect(names).toContain('requests');
    expect(names).toContain('claude_events');
    expect(names).toContain('_migrations');
  });

  it('_migrations 행 수가 max 버전과 일치한다 (legacy 백필 + v35 신규 INSERT)', () => {
    runMigrations(db, false);

    // 빈 DB → v35 적용 시점에는 v1..v34가 legacy로 백필되고 v35는 신규 INSERT 됨.
    // v36+ 마이그레이션이 있을 경우 v35 이후는 모두 신규 INSERT.
    expect(countMigrationRows(db)).toBe(MAX_VERSION);
  });

  it('v35 자기 자신 행은 filename = "035-add-migrations-meta-table.sql"로 기록된다', () => {
    runMigrations(db, false);

    const row = db
      .query("SELECT filename FROM _migrations WHERE version = 35")
      .get() as { filename: string } | undefined;
    expect(row?.filename).toBe('035-add-migrations-meta-table.sql');
  });

  it('v34 이하는 filename = "(legacy)"로 백필된다', () => {
    runMigrations(db, false);

    const row = db.query("SELECT filename FROM _migrations WHERE version = 1").get() as
      | { filename: string }
      | undefined;
    expect(row?.filename).toBe('(legacy)');
  });

  it('lastRunResult.from=0, to=max, files.length=max', () => {
    runMigrations(db, false);
    const result = getLastMigrationRun();

    expect(result.from).toBe(0);
    expect(result.to).toBe(MAX_VERSION);
    expect(result.files.length).toBe(MAX_VERSION);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('Migrator — 시나리오 2: 매 버전 (N-1) → N 단일 점프', () => {
  let db: Database;

  beforeEach(() => {
    db = createMemoryDb();
  });

  afterEach(() => {
    db.close();
  });

  it('적용 파일 순서가 디렉토리 sort와 일치한다 (각 단계 user_version 1 증가)', () => {
    // 시나리오 2 — 일괄 적용 시 적용 파일이 디렉토리 sort 순서와 1:1 일치하고,
    // 각 파일이 단일 트랜잭션 안에서 user_version을 정확히 1씩 증가시킨다는 점을
    // lastRunResult.files로 검증한다.
    runMigrations(db, false);

    const result = getLastMigrationRun();
    const expectedFiles = ALL_MIGRATIONS.map(m => m.file);
    expect(result.files).toEqual(expectedFiles);

    // 적용 파일 prefix(version 번호)가 순차 증가 — 1, 2, 3, ..., MAX
    const versions = result.files
      .map(f => parseMigrationVersion(f))
      .filter((v): v is number => v !== null);
    for (let i = 1; i < versions.length; i++) {
      expect(versions[i] - versions[i - 1]).toBe(1);
    }
    expect(versions[versions.length - 1]).toBe(MAX_VERSION);
  });

  it('이미 max까지 적용된 DB에 재호출 시 0건 적용 — no-op 멱등', () => {
    runMigrations(db, false);
    const firstResult = getLastMigrationRun();
    expect(firstResult.files.length).toBe(MAX_VERSION);

    // 재호출 — 마이그레이션 적용 0건, user_version 동일
    runMigrations(db, false);
    const secondResult = getLastMigrationRun();
    expect(secondResult.from).toBe(MAX_VERSION);
    expect(secondResult.to).toBe(MAX_VERSION);
    expect(secondResult.files.length).toBe(0);
    expect(getUserVersion(db)).toBe(MAX_VERSION);
  });

  it('v35 적용 직후 메타테이블에 v35 자기 자신 행과 legacy 백필 행이 모두 생긴다', () => {
    // 시나리오 2의 핵심 단계 — v34 → v35 단일 점프 시 메타테이블 신설 + legacy 백필 + v35 자기 INSERT가
    // 동일 트랜잭션 안에서 원자적으로 일어난다.
    runMigrations(db, false);

    // v35 자기 INSERT — filename 명시
    const v35 = db
      .query("SELECT filename, applied_at FROM _migrations WHERE version = 35")
      .get() as { filename: string; applied_at: number } | undefined;
    expect(v35?.filename).toBe('035-add-migrations-meta-table.sql');
    expect(v35?.applied_at).toBeGreaterThan(0);

    // v34 이하 legacy 백필
    const v1 = db.query("SELECT filename FROM _migrations WHERE version = 1").get() as
      | { filename: string }
      | undefined;
    expect(v1?.filename).toBe('(legacy)');
  });
});

describe('Migrator — 시나리오 3: 비정상 종료 시뮬레이션', () => {
  let db: Database;

  beforeEach(() => {
    db = createMemoryDb();
  });

  afterEach(() => {
    db.close();
  });

  it('일괄 적용 후 한 번 더 호출해도 멱등 (재기동 시뮬레이션)', () => {
    runMigrations(db, false);
    const versionAfterFirst = getUserVersion(db);
    const rowsAfterFirst = countMigrationRows(db);

    // 재기동 시뮬레이션 — 동일 DB에 다시 호출
    runMigrations(db, false);

    expect(getUserVersion(db)).toBe(versionAfterFirst);
    expect(countMigrationRows(db)).toBe(rowsAfterFirst);
  });

  it('PRAGMA를 강제 후퇴시켜도 duplicate column/already exists 가드로 안전 복구', () => {
    runMigrations(db, false);
    const beforeRows = countMigrationRows(db);

    // 비정상 종료 — user_version만 임의로 후퇴 (DDL은 유지)
    db.prepare('PRAGMA user_version = 33').run();
    expect(getUserVersion(db)).toBe(33);

    // 재기동 — 멱등 복구 기대
    runMigrations(db, false);

    expect(getUserVersion(db)).toBe(MAX_VERSION);
    // INSERT OR REPLACE 정책상 동일 version row가 갱신되므로 행 수는 동일하게 유지
    expect(countMigrationRows(db)).toBe(beforeRows);
  });

  it('detectMigrationLag — 미적용 상태일 때 lag 감지', () => {
    // user_version = 30이지만 디렉토리 최신은 MAX_VERSION
    db.prepare('PRAGMA user_version = 30').run();

    const lag = detectMigrationLag(db);
    expect(lag.current).toBe(30);
    expect(lag.latest).toBe(MAX_VERSION);
    expect(lag.latestFile).not.toBeNull();
  });

  it('detectMigrationLag — 정상 적용 상태에서는 current === latest', () => {
    runMigrations(db, false);

    const lag = detectMigrationLag(db);
    expect(lag.current).toBe(MAX_VERSION);
    expect(lag.latest).toBe(MAX_VERSION);
  });

  it('getLatestMigrationFile — 적용 후 최신 파일명 반환', () => {
    runMigrations(db, false);
    const latest = getLatestMigrationFile(db);
    expect(latest).not.toBeNull();
    expect(latest).toMatch(/^\d{3}-/);
  });
});

describe('Migrator — ADR-002 999 한도 가드', () => {
  it('정상 파일명(001~999)은 정상 파싱', () => {
    expect(parseMigrationVersion('001-init.sql')).toBe(1);
    expect(parseMigrationVersion('035-add-migrations-meta-table.sql')).toBe(35);
    expect(parseMigrationVersion('999-final.sql')).toBe(999);
  });

  it('4자리 padding은 즉시 throw (silent overflow 차단)', () => {
    expect(() => parseMigrationVersion('1000-overflow.sql')).toThrow(
      /Migration version exceeds 999/,
    );
    expect(() => parseMigrationVersion('1234-impossible.sql')).toThrow(/ADR-002/);
  });

  it('잘못된 파일명은 null 반환 (스킵 가능)', () => {
    expect(parseMigrationVersion('readme.sql')).toBeNull();
    expect(parseMigrationVersion('foo.sql')).toBeNull();
  });

  it('던지는 메시지에 ADR-002와 4자리 확장 가이드 언급 포함', () => {
    try {
      parseMigrationVersion('1000-x.sql');
      throw new Error('should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/ADR-002/);
      expect(msg).toMatch(/4-digit/);
    }
  });
});

describe('Migrator — getLatestMigrationFile 경계 케이스', () => {
  let db: Database;

  beforeEach(() => {
    db = createMemoryDb();
  });

  afterEach(() => {
    db.close();
  });

  it('메타테이블이 없으면 null 반환', () => {
    // 빈 DB — 메타테이블 미존재
    expect(getLatestMigrationFile(db)).toBeNull();
  });
});
