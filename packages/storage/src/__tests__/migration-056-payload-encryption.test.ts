/**
 * Migration 056 — at-rest 암호화 algo 마커 컬럼 (R3)
 *
 * @description
 *   056이 claude_events.payload_algo / system_prompts.content_algo를 additive로 추가하고,
 *   requests/proxy_requests의 기존 payload_algo는 보존하며, 기존 행(algo=NULL=평문)이
 *   무손실 유지됨을 고정한다.
 *
 * @see packages/storage/migrations/056-payload-encryption.sql
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';

function cols(db: Database, table: string): Set<string> {
  const rows = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

let db: Database;
beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
});
afterEach(() => db.close());

describe('migration 056', () => {
  it('user_version이 56 이상으로 적용된다', () => {
    const v = (db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
    expect(v).toBeGreaterThanOrEqual(56);
  });

  it('claude_events에 payload_algo 컬럼이 추가된다', () => {
    expect(cols(db, 'claude_events').has('payload_algo')).toBe(true);
  });

  it('system_prompts에 content_algo 컬럼이 추가된다', () => {
    expect(cols(db, 'system_prompts').has('content_algo')).toBe(true);
  });

  it('requests/proxy_requests의 기존 payload_algo는 보존된다', () => {
    expect(cols(db, 'requests').has('payload_algo')).toBe(true);
    expect(cols(db, 'proxy_requests').has('payload_algo')).toBe(true);
  });

  it('기존 평문 행(algo=NULL)은 무손실 — claude_events round-trip', () => {
    db.run(
      `INSERT INTO claude_events (event_id, event_type, session_id, timestamp, payload)
       VALUES (?, ?, ?, ?, ?)`,
      ['ev1', 'PreToolUse', 's1', Date.now(), '{"k":"평문"}'],
    );
    const row = db.query('SELECT payload, payload_algo FROM claude_events WHERE event_id = ?')
      .get('ev1') as { payload: string; payload_algo: string | null };
    expect(row.payload).toBe('{"k":"평문"}');
    expect(row.payload_algo).toBeNull(); // 평문 마커
  });

  it('system_prompts content_algo 기본 NULL — 평문 보존', () => {
    db.run(
      `INSERT INTO system_prompts (hash, content, byte_size, first_seen_at, last_seen_at, ref_count)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['h1', 'system 본문', 11, Date.now(), Date.now(), 1],
    );
    const row = db.query('SELECT content, content_algo FROM system_prompts WHERE hash = ?')
      .get('h1') as { content: string; content_algo: string | null };
    expect(row.content).toBe('system 본문');
    expect(row.content_algo).toBeNull();
  });
});
