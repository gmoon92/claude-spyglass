/**
 * analyze backfillSystemByteSize — CAS 행 포함 system_hash 백필 회귀 가드 (정공법 B)
 *
 * @description
 *   WHERE를 (payload IS NOT NULL OR payload_manifest_algo IS NOT NULL)로 확대한 뒤,
 *   CAS 행(payload NULL, manifest='chunks/v1')도 system_hash 백필 대상에 포함되고,
 *   reconstructProxyPayloadText 경유로 system을 복원해 system_hash를 채우는지 고정한다.
 *   레거시 행 동작은 무변경이어야 한다(회귀 가드).
 *
 * @see packages/server/src/cli/analyze.ts (backfillSystemByteSize)
 * @see packages/storage/src/queries/proxy-payload.ts (reconstructProxyPayloadText)
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  runMigrations,
  createProxyRequest,
  storeProxyPayloadChunks,
  splitConversation,
  encodeBlob,
  MANIFEST_CHUNKS_V1,
} from '@spyglass/storage';
import { normalizeSystem } from '../../proxy/system-hash';
import { backfillSystemByteSize } from '../analyze';

const enc = new TextEncoder();
const BODY = JSON.stringify({
  system: '너는 유능한 조수다. 정규화 대상 system 본문.',
  messages: [{ role: 'user', content: '안녕' }],
  tools: [{ name: 'Read' }],
  model: 'claude-opus-4-8',
});
const FULL_RANGE = { fromMs: 0, toMs: Number.MAX_SAFE_INTEGER };
const EXPECTED_HASH = normalizeSystem(JSON.parse(BODY).system)!.hash;

let db: Database;
beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
});
afterEach(() => db.close());

/** 레거시 행(통짜 zstd BLOB, system_hash NULL). */
function seedLegacy(id: string): void {
  const e = encodeBlob(enc.encode(BODY), null);
  createProxyRequest(db, {
    id, timestamp: 1000, method: 'POST', path: '/v1/messages',
    payload: e.value, payload_algo: e.algo ?? null, payload_raw_size: enc.encode(BODY).byteLength,
  });
}

/** CAS 행(payload NULL, manifest='chunks/v1', system_hash NULL). */
function seedCas(id: string): void {
  const chunks = splitConversation(BODY)!.chunks;
  db.transaction(() => {
    createProxyRequest(db, {
      id, timestamp: 2000, method: 'POST', path: '/v1/messages',
      payload_manifest_algo: MANIFEST_CHUNKS_V1,
    });
    storeProxyPayloadChunks(db, id, chunks, 2000);
  })();
}

function systemHashOf(id: string): string | null {
  return (db.query('SELECT system_hash FROM proxy_requests WHERE id = ?').get(id) as { system_hash: string | null }).system_hash;
}

describe('backfillSystemByteSize — WHERE 확대(정공법 B)', () => {
  test('[핵심] CAS 행 + system_hash NULL → reconstruct 경유로 system_hash 채움', () => {
    seedCas('cas');
    const r = backfillSystemByteSize(db, FULL_RANGE, false);
    expect(r.eligible).toBe(1);
    expect(r.updated).toBe(1);
    expect(r.decodeError).toBe(0);
    expect(systemHashOf('cas')).toBe(EXPECTED_HASH);
    // system_prompts에도 upsert됨
    expect((db.query('SELECT COUNT(*) AS n FROM system_prompts WHERE hash = ?').get(EXPECTED_HASH) as { n: number }).n).toBe(1);
  });

  test('레거시 행 동작 무변경 (회귀 가드)', () => {
    seedLegacy('legacy');
    const r = backfillSystemByteSize(db, FULL_RANGE, false);
    expect(r.updated).toBe(1);
    expect(systemHashOf('legacy')).toBe(EXPECTED_HASH);
  });

  test('혼재 DB — CAS + 레거시 둘 다 백필', () => {
    seedLegacy('L');
    seedCas('C');
    const r = backfillSystemByteSize(db, FULL_RANGE, false);
    expect(r.eligible).toBe(2);
    expect(r.updated).toBe(2);
    expect(systemHashOf('L')).toBe(EXPECTED_HASH);
    expect(systemHashOf('C')).toBe(EXPECTED_HASH);
  });

  test('멱등 — 이미 system_hash 있는 행은 대상 제외', () => {
    seedCas('done');
    backfillSystemByteSize(db, FULL_RANGE, false); // 1회차: 채움
    const r = backfillSystemByteSize(db, FULL_RANGE, false); // 2회차
    expect(r.eligible).toBe(0);
    expect(r.updated).toBe(0);
  });

  test('artifact 누락 CAS 행 → graceful(decodeError++), 다른 행은 계속 처리', () => {
    // 손상 CAS 행: manifest 신호만 있고 proxy_request_chunks/artifacts 없음
    createProxyRequest(db, { id: 'broken', timestamp: 500, method: 'POST', path: '/v1/messages', payload_manifest_algo: MANIFEST_CHUNKS_V1 });
    seedCas('ok');
    const r = backfillSystemByteSize(db, FULL_RANGE, false);
    expect(r.eligible).toBe(2);
    expect(r.decodeError).toBe(1);       // broken 행
    expect(systemHashOf('ok')).toBe(EXPECTED_HASH); // 정상 행은 채워짐
    expect(systemHashOf('broken')).toBeNull();
  });

  test('dry-run — DB 무변경', () => {
    seedCas('dry');
    const r = backfillSystemByteSize(db, FULL_RANGE, true);
    expect(r.updated).toBe(1); // 추정 카운트
    expect(systemHashOf('dry')).toBeNull(); // 실제 UPDATE 안 됨
    expect((db.query('SELECT COUNT(*) AS n FROM system_prompts').get() as { n: number }).n).toBe(0);
  });
});
