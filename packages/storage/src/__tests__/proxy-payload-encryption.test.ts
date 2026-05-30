/**
 * proxy_requests.payload 암호화 round-trip — zstd/암호문 혼재 (R3 Stage A)
 *
 * @description
 *   createProxyRequest(쓰기) + getProxyRequestById + decodeBlob(읽기)의 계약을 고정한다.
 *   routes/proxy.ts·cli/analyze.ts·backfill-system-prompts.ts가 모두 decodeBlob을 경유하므로
 *   본 round-trip이 그 디코드 정합성의 회귀 가드다.
 *
 * @see packages/storage/src/payload-codec.ts
 * @see packages/server/src/routes/proxy.ts
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';
import { createProxyRequest, getProxyRequestById } from '../queries/proxy';
import { encodeBlob, decodeBlob } from '../payload-codec';
import { generateKey } from '../crypto';

const enc = new TextEncoder();
const dec = new TextDecoder();
const BODY = JSON.stringify({ messages: [{ role: 'user', content: '민감 대화 🙂' }], system: 'sys' });

let db: Database;
beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
});
afterEach(() => db.close());

function insert(id: string, payload: Uint8Array, algo: string | null): void {
  createProxyRequest(db, {
    id,
    timestamp: Date.now(),
    method: 'POST',
    path: '/v1/messages',
    payload,
    payload_raw_size: enc.encode(BODY).byteLength,
    payload_algo: algo,
  });
}

describe('proxy payload round-trip (Stage A)', () => {
  test('zstd 행: 디코드 시 원문 복원', () => {
    const e = encodeBlob(enc.encode(BODY), null);
    expect(e.algo).toBe('zstd');
    insert('p-zstd', e.value, e.algo ?? null);
    const row = getProxyRequestById(db, 'p-zstd')!;
    expect(row.payload_algo).toBe('zstd');
    const raw = decodeBlob(row.payload, row.payload_algo, null);
    expect(dec.decode(raw!)).toBe(BODY);
  });

  test('암호문 행: 평문 비노출 + 키로 디코드 시 원문 복원', () => {
    const key = generateKey();
    const e = encodeBlob(enc.encode(BODY), key);
    expect(e.algo).toBe('zstd+aes256gcm');
    insert('p-enc', e.value, e.algo ?? null);
    const row = getProxyRequestById(db, 'p-enc')!;
    expect(row.payload_algo).toBe('zstd+aes256gcm');
    // 저장 BLOB에 평문 문자열이 노출되지 않음
    expect(dec.decode(row.payload!)).not.toContain('민감');
    const raw = decodeBlob(row.payload, row.payload_algo, key);
    expect(dec.decode(raw!)).toBe(BODY);
  });

  test('zstd/암호문 혼재 동시 조회 — 둘 다 원문 복원', () => {
    const key = generateKey();
    const z = encodeBlob(enc.encode(BODY), null);
    const c = encodeBlob(enc.encode(BODY), key);
    insert('mix-z', z.value, z.algo ?? null);
    insert('mix-c', c.value, c.algo ?? null);
    const rz = getProxyRequestById(db, 'mix-z')!;
    const rc = getProxyRequestById(db, 'mix-c')!;
    expect(dec.decode(decodeBlob(rz.payload, rz.payload_algo, key)!)).toBe(BODY);
    expect(dec.decode(decodeBlob(rc.payload, rc.payload_algo, key)!)).toBe(BODY);
  });

  test('암호문 행을 키 없이 디코드하면 예외(silent corruption 방지)', () => {
    const key = generateKey();
    const c = encodeBlob(enc.encode(BODY), key);
    insert('no-key', c.value, c.algo ?? null);
    const row = getProxyRequestById(db, 'no-key')!;
    expect(() => decodeBlob(row.payload, row.payload_algo, null)).toThrow();
  });
});
