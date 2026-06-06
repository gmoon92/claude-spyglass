/**
 * Migration 057 — preview 미러 컬럼 at-rest 암호화 algo 마커 (R3 확장, ⓝ1)
 *
 * @description
 *   057이 requests.preview_algo / proxy_requests.preview_algo를 additive로 추가하고,
 *   기존 행(algo=NULL=평문)이 무손실 유지됨을 고정한다. 멱등성(재실행해도 user_version 안정)도 확인.
 *
 * @see packages/storage/migrations/057-preview-encryption.sql
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

describe('migration 057', () => {
  it('user_version이 57 이상으로 적용된다', () => {
    const v = (db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
    expect(v).toBeGreaterThanOrEqual(57);
  });

  it('requests에 preview_algo 컬럼이 추가된다', () => {
    expect(cols(db, 'requests').has('preview_algo')).toBe(true);
  });

  it('proxy_requests에 preview_algo 컬럼이 추가된다', () => {
    expect(cols(db, 'proxy_requests').has('preview_algo')).toBe(true);
  });

  it('payload_algo 암호화 자산은 보존된다(063: requests→request_payloads 분리 이동, 056 자산 무영향)', () => {
    // storage-payload-detach 단계 C(Migration 063): requests.payload_algo 는 payload 와 함께
    //   request_payloads 로 이동. 056 자산("암호화 algo 마커 보존") 은 request_payloads.payload_algo
    //   기준으로 유지 — 057 의 preview_algo 추가와 무관하게 보존된다.
    expect(cols(db, 'requests').has('payload_algo')).toBe(false);
    expect(cols(db, 'request_payloads').has('payload_algo')).toBe(true);
    expect(cols(db, 'proxy_requests').has('payload_algo')).toBe(true);
  });

  it('기존 평문 행(preview_algo=NULL)은 무손실 — requests preview round-trip', () => {
    db.run(
      `INSERT INTO requests (id, session_id, timestamp, type, preview)
       VALUES (?, ?, ?, 'prompt', ?)`,
      ['r-plain', 's1', Date.now(), '평문 미리보기'],
    );
    const row = db.query('SELECT preview, preview_algo FROM requests WHERE id = ?')
      .get('r-plain') as { preview: string; preview_algo: string | null };
    expect(row.preview).toBe('평문 미리보기');
    expect(row.preview_algo).toBeNull();
  });

  it('기존 평문 행(preview_algo=NULL)은 무손실 — proxy_requests preview round-trip', () => {
    db.run(
      `INSERT INTO proxy_requests (id, timestamp, method, path, request_preview, response_preview, system_preview)
       VALUES (?, ?, 'POST', '/v1/messages', ?, ?, ?)`,
      ['p-plain', Date.now(), 'req 미리보기', 'resp 미리보기', 'sys 미리보기'],
    );
    const row = db.query(
      'SELECT request_preview, response_preview, system_preview, preview_algo FROM proxy_requests WHERE id = ?',
    ).get('p-plain') as {
      request_preview: string; response_preview: string; system_preview: string; preview_algo: string | null;
    };
    expect(row.request_preview).toBe('req 미리보기');
    expect(row.response_preview).toBe('resp 미리보기');
    expect(row.system_preview).toBe('sys 미리보기');
    expect(row.preview_algo).toBeNull();
  });

  it('멱등성 — runMigrations 재실행해도 user_version 안정 + 컬럼 유지', () => {
    const before = (db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
    runMigrations(db); // 재실행: 이미 적용된 마이그레이션은 skip
    const after = (db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
    expect(after).toBe(before);
    expect(cols(db, 'requests').has('preview_algo')).toBe(true);
    expect(cols(db, 'proxy_requests').has('preview_algo')).toBe(true);
  });
});
