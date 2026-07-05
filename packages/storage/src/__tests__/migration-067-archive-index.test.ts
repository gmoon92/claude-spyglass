/**
 * Migration 067 — Archive/ELK 구조 (roadmap Phase 5-6)
 *
 * @description
 *   archive_index + archive_stats_hourly + archive_stats_proxy_hourly가 additive로 생성되고,
 *   재실행 멱등하며, archive_stats_*가 Hot stats_*와 '동일 컬럼'(UNION 가능)임을 고정한다.
 *
 * @see packages/storage/migrations/067-archive-index.sql
 * @see packages/storage/docs/storage-evolution-adr-archive.md (A5·A6)
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';

function cols(db: Database, table: string): Set<string> {
  const rows = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}
function hasObject(db: Database, type: 'table' | 'index', name: string): boolean {
  return db.query(`SELECT name FROM sqlite_master WHERE type = ? AND name = ?`).get(type, name) != null;
}

let db: Database;
beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
});
afterEach(() => db.close());

describe('migration 067 — Archive 구조', () => {
  it('user_version이 67 이상으로 적용된다', () => {
    const v = (db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
    expect(v).toBeGreaterThanOrEqual(67);
  });

  it('archive_index 테이블 + (src_table,row_id) PK + 3 인덱스', () => {
    expect(hasObject(db, 'table', 'archive_index')).toBe(true);
    const info = db.query(`PRAGMA table_info(archive_index)`).all() as Array<{ name: string; pk: number }>;
    expect(info.filter((r) => r.pk > 0).map((r) => r.name).sort()).toEqual(['row_id', 'src_table']);
    for (const c of ['src_table', 'row_id', 'session_id', 'timestamp', 'type', 'archive_file']) {
      expect(cols(db, 'archive_index').has(c)).toBe(true);
    }
    expect(hasObject(db, 'index', 'idx_archive_index_ts')).toBe(true);
    expect(hasObject(db, 'index', 'idx_archive_index_session')).toBe(true);
    expect(hasObject(db, 'index', 'idx_archive_index_file')).toBe(true);
  });

  it('archive_stats_hourly가 stats_hourly와 동일 컬럼 + duration_ms_sketch (UNION 가법성 전제)', () => {
    const hot = cols(db, 'stats_hourly');
    const arc = cols(db, 'archive_stats_hourly');
    // stats_hourly의 집계 컬럼(id 제외)이 archive에도 모두 존재 → UNION ALL 가능
    for (const c of hot) {
      if (c === 'id') continue; // archive는 AUTOINCREMENT id 없음(PK가 hour_ts,model,type)
      expect(arc.has(c)).toBe(true);
    }
    expect(arc.has('duration_ms_sketch')).toBe(true); // P95 스케치 컬럼(비가법 예외)
  });

  it('archive_stats_proxy_hourly가 stats_proxy_hourly와 동일 컬럼', () => {
    const hot = cols(db, 'stats_proxy_hourly');
    const arc = cols(db, 'archive_stats_proxy_hourly');
    for (const c of hot) {
      if (c === 'id') continue;
      expect(arc.has(c)).toBe(true);
    }
  });

  it('재실행(runMigrations 재호출) 멱등 — 오류 없음', () => {
    expect(() => runMigrations(db)).not.toThrow();
  });

  it('archive_stats_hourly ↔ stats_hourly UNION ALL이 스키마상 성립(집계 가법성)', () => {
    // 동일 컬럼 집합이라 UNION ALL 쿼리가 파싱·실행됨(런타임 검증)
    const q = `
      SELECT SUM(request_count) AS rc FROM (
        SELECT request_count FROM stats_hourly
        UNION ALL
        SELECT request_count FROM archive_stats_hourly
      )`;
    expect(() => db.query(q).get()).not.toThrow();
    expect((db.query(q).get() as { rc: number | null }).rc ?? 0).toBe(0); // 둘 다 비어 0
  });
});
