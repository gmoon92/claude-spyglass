/**
 * Migration 066 — CAS Artifact Layer 구조 (roadmap Phase 2)
 *
 * @description
 *   066이 artifacts / proxy_request_chunks 테이블과 proxy_requests.payload_manifest_algo
 *   컬럼을 additive로 추가하고, 재실행해도 멱등하며, 기존 proxy_requests 행이
 *   payload_manifest_algo=NULL(레거시 신호)로 무손실 유지됨을 고정한다.
 *
 * @see packages/storage/migrations/066-artifacts.sql
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';

function cols(db: Database, table: string): Set<string> {
  const rows = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function hasObject(db: Database, type: 'table' | 'index', name: string): boolean {
  const row = db
    .query(`SELECT name FROM sqlite_master WHERE type = ? AND name = ?`)
    .get(type, name);
  return row != null;
}

let db: Database;
beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
});
afterEach(() => db.close());

describe('migration 066 — CAS 구조', () => {
  it('user_version이 66 이상으로 적용된다', () => {
    const v = (db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
    expect(v).toBeGreaterThanOrEqual(66);
  });

  it('artifacts 테이블과 필수 컬럼이 생성된다', () => {
    expect(hasObject(db, 'table', 'artifacts')).toBe(true);
    const c = cols(db, 'artifacts');
    for (const name of ['hash', 'stored_bytes', 'algo', 'raw_size', 'ref_count', 'first_seen_at', 'last_seen_at', 'created_at']) {
      expect(c.has(name)).toBe(true);
    }
  });

  it('proxy_request_chunks 테이블과 (request_id, seq) PK가 생성된다', () => {
    expect(hasObject(db, 'table', 'proxy_request_chunks')).toBe(true);
    const info = db.query(`PRAGMA table_info(proxy_request_chunks)`).all() as Array<{ name: string; pk: number }>;
    const pkCols = info.filter((r) => r.pk > 0).map((r) => r.name).sort();
    expect(pkCols).toEqual(['request_id', 'seq']);
  });

  it('proxy_requests에 payload_manifest_algo 신호 컬럼이 추가된다', () => {
    expect(cols(db, 'proxy_requests').has('payload_manifest_algo')).toBe(true);
  });

  it('CAS 인덱스 3종이 생성된다', () => {
    expect(hasObject(db, 'index', 'idx_artifacts_last_seen')).toBe(true);
    expect(hasObject(db, 'index', 'idx_artifacts_ref_count')).toBe(true);
    expect(hasObject(db, 'index', 'idx_prc_chunk_hash')).toBe(true);
  });

  it('재실행(runMigrations 재호출)해도 멱등 — 오류 없음', () => {
    expect(() => runMigrations(db)).not.toThrow();
  });

  it('기존 proxy_requests 행은 payload_manifest_algo=NULL(레거시 신호)로 무손실', () => {
    db.run(
      `INSERT INTO proxy_requests (id, timestamp, method, path) VALUES (?, ?, ?, ?)`,
      ['pr1', Date.now(), 'POST', '/v1/messages'],
    );
    const row = db
      .query('SELECT payload_manifest_algo FROM proxy_requests WHERE id = ?')
      .get('pr1') as { payload_manifest_algo: string | null };
    expect(row.payload_manifest_algo).toBeNull();
  });

  it('artifacts UPSERT round-trip — ref_count 증가 확인 (스키마 계약)', () => {
    const now = Date.now();
    const sql = `
      INSERT INTO artifacts (hash, stored_bytes, algo, raw_size, first_seen_at, last_seen_at, ref_count)
      VALUES (?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(hash) DO UPDATE SET last_seen_at = excluded.last_seen_at, ref_count = ref_count + 1
    `;
    const bytes = new Uint8Array([1, 2, 3]);
    db.run(sql, ['h1', bytes, 'zstd', 3, now, now]);
    db.run(sql, ['h1', bytes, 'zstd', 3, now + 1, now + 1]);
    const row = db.query('SELECT ref_count FROM artifacts WHERE hash = ?').get('h1') as { ref_count: number };
    expect(row.ref_count).toBe(2);
  });
});
