/**
 * proxy_requests preview 컬럼 암호화 round-trip — 서버측 복호 + 혼재 (R3 확장, ⓝ1)
 *
 * @description
 *   request_preview / response_preview / system_preview 3 컬럼을 단일 preview_algo로 추적한다.
 *   쓰기(createProxyRequest)·읽기(getProxyRequestById, getLatestProxyResponseBefore,
 *   getProxyResponseByApiRequestId)를 ON/OFF·혼재로 고정한다. events.ts가 response_preview를
 *   응답 본문으로 재사용하므로 그 read 출구는 반드시 평문이어야 한다.
 *
 * @see packages/storage/src/queries/proxy.ts
 * @see packages/storage/migrations/057-preview-encryption.sql
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';
import { generateKey } from '../crypto';
import { resetEncryptionRuntime } from '../runtime/encryption';
import {
  createProxyRequest,
  getProxyRequestById,
  getLatestProxyResponseBefore,
  getProxyResponseByApiRequestId,
} from '../queries/proxy';

let db: Database;

function enableEncryption(): void {
  process.env.SPYGLASS_ENCRYPTION = '1';
  process.env.SPYGLASS_ENCRYPTION_KEY = generateKey().toString('base64');
  resetEncryptionRuntime();
}
function disableEncryption(): void {
  delete process.env.SPYGLASS_ENCRYPTION;
  delete process.env.SPYGLASS_ENCRYPTION_KEY;
  resetEncryptionRuntime();
}

beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
  disableEncryption();
});
afterEach(() => {
  db.close();
  disableEncryption();
});

const REQ_PREV = 'user 메시지 미리보기 🙂 secret-req';
const RESP_PREV = 'assistant 응답 미리보기 secret-resp';
const SYS_PREV = 'system 본문 미리보기 secret-sys';

function mkProxy(id: string, extra: Record<string, unknown> = {}): void {
  createProxyRequest(db, {
    id, timestamp: Date.now(), method: 'POST', path: '/v1/messages',
    request_preview: REQ_PREV, response_preview: RESP_PREV, system_preview: SYS_PREV,
    ...extra,
  } as Parameters<typeof createProxyRequest>[1]);
}

describe('proxy preview write/read (ⓝ1)', () => {
  test('OFF: 평문 저장(preview_algo NULL) + getProxyRequestById 복원', () => {
    mkProxy('p1');
    const raw = db.query(
      'SELECT request_preview, response_preview, system_preview, preview_algo FROM proxy_requests WHERE id = ?',
    ).get('p1') as { request_preview: string; response_preview: string; system_preview: string; preview_algo: string | null };
    expect(raw.preview_algo).toBeNull();
    expect(raw.request_preview).toBe(REQ_PREV);
    const row = getProxyRequestById(db, 'p1')!;
    expect(row.request_preview).toBe(REQ_PREV);
    expect(row.response_preview).toBe(RESP_PREV);
    expect(row.system_preview).toBe(SYS_PREV);
  });

  test('ON: 3컬럼 암호문 저장(평문 비노출, 단일 algo) + getProxyRequestById 복호', () => {
    enableEncryption();
    mkProxy('p2');
    const raw = db.query(
      'SELECT request_preview, response_preview, system_preview, preview_algo FROM proxy_requests WHERE id = ?',
    ).get('p2') as { request_preview: string; response_preview: string; system_preview: string; preview_algo: string | null };
    expect(raw.preview_algo).toBe('aes256gcm');
    expect(raw.request_preview).not.toContain('secret-req');
    expect(raw.response_preview).not.toContain('secret-resp');
    expect(raw.system_preview).not.toContain('secret-sys');
    const row = getProxyRequestById(db, 'p2')!;
    expect(row.request_preview).toBe(REQ_PREV);
    expect(row.response_preview).toBe(RESP_PREV);
    expect(row.system_preview).toBe(SYS_PREV);
  });

  test('일부 preview NULL: 평문 유지(암호화 시 "null" 문자열 암호화 안 함)', () => {
    enableEncryption();
    createProxyRequest(db, {
      id: 'p3', timestamp: Date.now(), method: 'POST', path: '/v1/messages',
      response_preview: RESP_PREV, // request/system은 미지정(undefined)
    } as Parameters<typeof createProxyRequest>[1]);
    const raw = db.query(
      'SELECT request_preview, response_preview, system_preview, preview_algo FROM proxy_requests WHERE id = ?',
    ).get('p3') as { request_preview: string | null; response_preview: string; system_preview: string | null; preview_algo: string | null };
    expect(raw.request_preview).toBeNull();
    expect(raw.system_preview).toBeNull();
    expect(raw.preview_algo).toBe('aes256gcm');
    expect(raw.response_preview).not.toContain('secret-resp');
    const row = getProxyRequestById(db, 'p3')!;
    expect(row.request_preview).toBeNull();
    expect(row.response_preview).toBe(RESP_PREV);
    expect(row.system_preview).toBeNull();
  });

  test('혼재: 평문 행 + 암호문 행 동시 조회 복원', () => {
    db.run(
      `INSERT INTO proxy_requests (id, timestamp, method, path, response_preview)
       VALUES (?, ?, 'POST', '/v1/messages', ?)`,
      ['plain', Date.now(), RESP_PREV],
    );
    enableEncryption();
    mkProxy('enc');
    expect(getProxyRequestById(db, 'plain')!.response_preview).toBe(RESP_PREV);
    expect(getProxyRequestById(db, 'enc')!.response_preview).toBe(RESP_PREV);
  });
});

describe('response_preview read 출구 — events.ts fallback 계약', () => {
  test('getLatestProxyResponseBefore: 암호문 response_preview 평문 복원', () => {
    enableEncryption();
    const sid = 'sess-latest';
    mkProxy('p-latest', { session_id: sid, timestamp: 1_000_000 });
    const got = getLatestProxyResponseBefore(db, sid, 1_000_500, 120_000);
    expect(got).not.toBeNull();
    expect(got!.response_preview).toBe(RESP_PREV);
  });

  test('getProxyResponseByApiRequestId: 암호문 response_preview 평문 복원', () => {
    enableEncryption();
    mkProxy('p-api', { api_request_id: 'msg_abc123' });
    const got = getProxyResponseByApiRequestId(db, 'msg_abc123');
    expect(got).not.toBeNull();
    expect(got!.response_preview).toBe(RESP_PREV);
  });

  test('혼재(평문+암호문): getLatestProxyResponseBefore가 최신 암호문 행을 평문 복원', () => {
    const sid = 'sess-mix';
    db.run(
      `INSERT INTO proxy_requests (id, timestamp, method, path, session_id, response_preview)
       VALUES (?, ?, 'POST', '/v1/messages', ?, ?)`,
      ['old-plain', 1_000_000, sid, RESP_PREV],
    );
    enableEncryption();
    mkProxy('new-enc', { session_id: sid, timestamp: 1_000_100 });
    const got = getLatestProxyResponseBefore(db, sid, 1_000_500, 120_000);
    expect(got!.response_preview).toBe(RESP_PREV); // 최신(암호문) 행 복원
  });
});
