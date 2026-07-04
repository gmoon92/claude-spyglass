/**
 * backfillProxyPayloadToCas — 레거시→CAS 대량 백필 회귀 가드 (정공법 C)
 *
 * @description
 *   비가역 백필의 안전성을 회귀 가드로 고정한다. 안전 축은 round-trip 검증(Bun.deepEquals):
 *   재조립이 원본과 의미상 다르면 payload를 절대 NULL로 만들지 않는다.
 *   또 system_hash 동시 백필(payload NULL 이전)로 순서 트랩을 해소하고, 배치 트랜잭션 원자성을
 *   보장한다.
 *
 * @see packages/storage/src/queries/proxy-payload.ts (backfillProxyPayloadToCas)
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';
import { createProxyRequest, getProxyRequestById } from '../queries/proxy';
import {
  backfillProxyPayloadToCas,
  reconstructProxyPayloadText,
} from '../queries/proxy-payload';
import { encodeBlob } from '../payload-codec';
import { splitConversation } from '../artifacts';

const enc = new TextEncoder();
const BODY = JSON.stringify({
  system: '조수 system 본문',
  messages: [{ role: 'user', content: '안녕' }, { role: 'assistant', content: '반가워' }],
  tools: [{ name: 'Read' }],
  model: 'claude',
});

/** 결정적 normalizeSystem 스텁 (server 역의존 회피 — 주입). */
const normStub = (system: unknown) =>
  system == null
    ? null
    : { hash: 'HASH_' + String(system).length, normalized: String(system), byteSize: enc.encode(String(system)).byteLength, segmentCount: 1 };

let db: Database;
beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
});
afterEach(() => db.close());

function seedLegacy(id: string, body: string, ts = 1000): void {
  const e = encodeBlob(enc.encode(body), null);
  createProxyRequest(db, {
    id, timestamp: ts, method: 'POST', path: '/v1/messages',
    payload: e.value, payload_algo: e.algo ?? null, payload_raw_size: enc.encode(body).byteLength,
  });
}
function rawRow(id: string) {
  return db.query('SELECT id, payload, payload_algo, payload_manifest_algo, system_hash FROM proxy_requests WHERE id = ?').get(id) as {
    payload: Uint8Array | null; payload_algo: string | null; payload_manifest_algo: string | null; system_hash: string | null;
  };
}
function artifactCount(): number {
  return (db.query('SELECT COUNT(*) AS n FROM artifacts').get() as { n: number }).n;
}

describe('backfillProxyPayloadToCas — 정상 전환', () => {
  test('레거시 conversation 행 → CAS 전환, reconstruct == 원본', () => {
    seedLegacy('p1', BODY);
    const r = backfillProxyPayloadToCas(db, {});
    expect(r.converted).toBe(1);
    expect(r.skippedRoundtripMismatch).toBe(0);

    const row = rawRow('p1');
    expect(row.payload).toBeNull();
    expect(row.payload_algo).toBeNull();
    expect(row.payload_manifest_algo).toBe('chunks/v1');
    expect(artifactCount()).toBeGreaterThan(0);

    const rec = reconstructProxyPayloadText(db, getProxyRequestById(db, 'p1')!);
    expect(rec.error).toBeNull();
    expect(JSON.parse(rec.text!)).toEqual(JSON.parse(BODY));
  });
});

describe('backfillProxyPayloadToCas — 안전(비가역) 가드', () => {
  test('round-trip 불일치(_join 손상 주입) → payload 보존 + skip, 전환 안 함', () => {
    seedLegacy('p1', BODY);
    const r = backfillProxyPayloadToCas(db, { _join: () => '{"tampered":true}' });
    expect(r.skippedRoundtripMismatch).toBe(1);
    expect(r.converted).toBe(0);
    const row = rawRow('p1');
    expect(row.payload).not.toBeNull();          // payload 보존
    expect(row.payload_manifest_algo).toBeNull(); // 전환 안 됨
    expect(artifactCount()).toBe(0);              // artifact 미적재
  });

  test('비-conversation payload → skip, payload 유지', () => {
    seedLegacy('arr', JSON.stringify([1, 2, 3]));
    const r = backfillProxyPayloadToCas(db, {});
    expect(r.skippedNonConversation).toBe(1);
    expect(r.converted).toBe(0);
    expect(rawRow('arr').payload).not.toBeNull();
  });

  test('배치 원자성 — 배치 중간 throw 시 그 배치 전체 롤백', () => {
    seedLegacy('a', BODY, 1000);
    seedLegacy('b', BODY, 2000);
    let n = 0;
    // 첫 행 정상 split, 둘째 행에서 throw → 같은 배치 롤백
    const flakySplit = (text: string) => {
      n++;
      if (n === 2) throw new Error('boom');
      return splitConversation(text); // 첫 행은 실제 분해
    };
    expect(() => backfillProxyPayloadToCas(db, { batchSize: 10, _split: flakySplit })).toThrow('boom');
    // 두 행 모두 미전환(첫 행도 롤백), artifacts 0
    expect(rawRow('a').payload).not.toBeNull();
    expect(rawRow('b').payload).not.toBeNull();
    expect(artifactCount()).toBe(0);
  });
});

describe('backfillProxyPayloadToCas — 멱등 / dry-run', () => {
  test('멱등 — 2회차 scanned=0, converted=0', () => {
    seedLegacy('p1', BODY);
    backfillProxyPayloadToCas(db, {});
    const r2 = backfillProxyPayloadToCas(db, {});
    expect(r2.scanned).toBe(0);
    expect(r2.converted).toBe(0);
  });

  test('dry-run — DB 무변경(payload/manifest/artifacts 그대로)', () => {
    seedLegacy('p1', BODY);
    const r = backfillProxyPayloadToCas(db, { dryRun: true });
    expect(r.converted).toBe(1); // 추정
    const row = rawRow('p1');
    expect(row.payload).not.toBeNull();
    expect(row.payload_manifest_algo).toBeNull();
    expect(artifactCount()).toBe(0);
  });
});

describe('backfillProxyPayloadToCas — system_hash 동시 백필(순서 트랩 해소)', () => {
  test('system_hash NULL 행 → 전환 후에도 system_hash 채워짐(payload NULL 이전에 처리된 증거)', () => {
    seedLegacy('p1', BODY);
    expect(rawRow('p1').system_hash).toBeNull();
    const r = backfillProxyPayloadToCas(db, { normalizeSystem: normStub });
    expect(r.converted).toBe(1);
    expect(r.systemBackfilled).toBe(1);
    const row = rawRow('p1');
    expect(row.payload).toBeNull();                       // CAS 전환됨
    expect(row.system_hash).toBe(normStub(JSON.parse(BODY).system)!.hash); // payload NULL 후에도 system_hash 존재
    // system_prompts에 upsert됨
    expect((db.query('SELECT COUNT(*) AS n FROM system_prompts WHERE hash = ?').get(row.system_hash) as { n: number }).n).toBe(1);
  });

  test('normalizeSystem 미주입 시 system_hash 백필 생략(전환은 정상)', () => {
    seedLegacy('p1', BODY);
    const r = backfillProxyPayloadToCas(db, {});
    expect(r.converted).toBe(1);
    expect(r.systemBackfilled).toBe(0);
    expect(rawRow('p1').system_hash).toBeNull();
  });
});
