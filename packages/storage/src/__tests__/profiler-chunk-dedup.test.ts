/**
 * profiler chunk-dedup — 측정 단위 = CAS 실제 저장 단위 정합 (정공법 A)
 *
 * @description
 *   profiler의 conversation dedup 측정이 CAS가 실제 저장하는 청크(chunker.splitConversation)와
 *   동일 단위임을 회귀 가드로 고정한다. 측정 청크 집합/바이트가 artifacts 저장분과 정합해야
 *   profiler 수치가 "실제 CAS 절감"을 정직하게 반영한다. hook 측정은 무변경(회귀 가드).
 *
 * @see packages/storage/src/profiler/collectors/chunk-dedup.ts
 * @see packages/storage/src/artifacts/chunker.ts (splitConversation — 측정 기준)
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';
import { createProxyRequest } from '../queries/proxy';
import { storeProxyPayloadChunks } from '../queries/proxy-payload';
import { splitConversation, sha256HexBytes } from '../artifacts';
import { encodeBlob } from '../payload-codec';
import { collectChunkDedup } from '../profiler/collectors/chunk-dedup';

const enc = new TextEncoder();
// 한 요청 내 중복 없는 conversation (단일 행 측정 시 chunkCount==uniqueChunkCount).
const BODY = JSON.stringify({
  system: '유능한 조수 system 본문',
  messages: [
    { role: 'user', content: '첫 질문' },
    { role: 'assistant', content: '첫 답변' },
  ],
  tools: [{ name: 'Read' }],
  model: 'claude',
});

let db: Database;
beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
});
afterEach(() => db.close());

/** 레거시 zstd BLOB proxy_requests 행 (profiler conversation 측정 대상). */
function seedLegacyProxy(id: string, body: string, ts = 1000): void {
  const e = encodeBlob(enc.encode(body), null);
  createProxyRequest(db, {
    id, timestamp: ts, method: 'POST', path: '/v1/messages',
    payload: e.value, payload_algo: e.algo ?? null, payload_raw_size: enc.encode(body).byteLength,
  });
}

function conv(result: ReturnType<typeof collectChunkDedup>) {
  return result.find((m) => m.table === 'proxy_requests')!;
}
function hook(result: ReturnType<typeof collectChunkDedup>) {
  return result.find((m) => m.table === 'request_payloads')!;
}

describe('profiler conversation 측정 = splitConversation 단위 (정공법 A)', () => {
  test('(i-a) chunkCount/totalChunkBytes가 splitConversation 청크와 정확히 일치', () => {
    seedLegacyProxy('p1', BODY);
    const expectedChunks = splitConversation(BODY)!.chunks; // [envelope, system, msg×2, tool] = 5
    const expectedBytes = expectedChunks.reduce((s, c) => s + enc.encode(c).byteLength, 0);

    const m = conv(collectChunkDedup(db, null, null));
    expect(m.chunkCount).toBe(expectedChunks.length); // envelope 포함
    expect(m.totalChunkBytes).toBe(expectedBytes);
    expect(m.uniqueChunkCount).toBe(expectedChunks.length); // 단일 요청 내 중복 없음
    expect(m.measuredRows).toBe(1);
  });

  test('(i-b) 측정 바이트/청크수 = 같은 BODY의 CAS 저장분(artifacts)과 정합', () => {
    seedLegacyProxy('p1', BODY); // profiler 측정 대상(레거시)
    // 같은 BODY를 별도 CAS 행으로 실제 저장 → artifacts에 청크 적재
    storeProxyPayloadChunks(db, 'cas1', splitConversation(BODY)!.chunks, 2000);

    const m = conv(collectChunkDedup(db, null, null));
    const artRows = db.query('SELECT COUNT(*) AS n, COALESCE(SUM(raw_size),0) AS b FROM artifacts').get() as { n: number; b: number };
    // profiler가 센 고유 청크 수/바이트 == CAS가 실제 저장한 artifacts 수/raw_size 합
    expect(m.uniqueChunkCount).toBe(artRows.n);
    expect(m.totalChunkBytes).toBe(artRows.b);
    // hash 집합 동일성: splitConversation 각 청크 해시 == artifacts.hash
    const expectedHashes = new Set(splitConversation(BODY)!.chunks.map((c) => sha256HexBytes(enc.encode(c))));
    const artHashes = new Set((db.query('SELECT hash FROM artifacts').all() as { hash: string }[]).map((r) => r.hash));
    expect(artHashes).toEqual(expectedHashes);
  });

  test('(i-c) 비-conversation payload는 parseFailed로 집계(measuredRows 제외)', () => {
    seedLegacyProxy('arr', JSON.stringify([1, 2, 3])); // splitConversation → null
    const m = conv(collectChunkDedup(db, null, null));
    expect(m.parseFailedRows).toBe(1);
    expect(m.measuredRows).toBe(0);
  });
});

describe('profiler 공유 청크 dedup 산식 (append 구조)', () => {
  test('(iii) 공유 message 2요청 → savedPct/uniqueChunkCount 손계산 일치', () => {
    const m1 = { role: 'user', content: '공유 턴' };
    const bodyA = JSON.stringify({ system: 'S', messages: [m1], tools: [{ name: 'T' }] });
    const bodyB = JSON.stringify({ system: 'S', messages: [m1, { role: 'assistant', content: 'B 고유' }], tools: [{ name: 'T' }] });
    seedLegacyProxy('a', bodyA, 1000);
    seedLegacyProxy('b', bodyB, 2000);

    // 손계산: 모든 청크를 해시로 모아 고유 집합/바이트 계산
    const all = [...splitConversation(bodyA)!.chunks, ...splitConversation(bodyB)!.chunks];
    const uniq = new Map<string, number>();
    for (const c of all) uniq.set(sha256HexBytes(enc.encode(c)), enc.encode(c).byteLength);
    const totalBytes = all.reduce((s, c) => s + enc.encode(c).byteLength, 0);
    const uniqBytes = [...uniq.values()].reduce((s, n) => s + n, 0);

    const m = conv(collectChunkDedup(db, null, null));
    expect(m.chunkCount).toBe(all.length);
    expect(m.uniqueChunkCount).toBe(uniq.size);
    expect(m.totalChunkBytes).toBe(totalBytes);
    expect(m.savedBytes).toBe(totalBytes - uniqBytes);
    expect(m.savedPct).toBeCloseTo(((totalBytes - uniqBytes) / totalBytes) * 100, 5);
  });
});

describe('profiler hook 측정 무변경 (회귀 가드)', () => {
  function seedHook(id: string, payloadText: string): void {
    db.run('INSERT INTO request_payloads (request_id, payload, payload_algo) VALUES (?, ?, ?)', [id, payloadText, null]);
  }

  test('(ii) 배열 payload는 원소별, 객체 payload는 top-level 값별 청킹(기존 로직)', () => {
    seedHook('arr', JSON.stringify(['a', 'b', 'c']));       // 3 청크
    seedHook('obj', JSON.stringify({ x: 1, y: 2 }));         // 2 청크
    const m = hook(collectChunkDedup(db, null, null));
    expect(m.measuredRows).toBe(2);
    expect(m.chunkCount).toBe(5); // 3 + 2
  });
});

describe('profiler 암호화 skip (회귀 가드)', () => {
  test('(iv) zstd+aes256gcm 행은 key 없으면 encryptedRowsSkipped(측정 제외)', () => {
    // 실제 암호화 불필요 — isEncrypted는 algo 문자열만 판정
    const e = encodeBlob(enc.encode(BODY), null);
    createProxyRequest(db, {
      id: 'encd', timestamp: 1000, method: 'POST', path: '/v1/messages',
      payload: e.value, payload_algo: 'zstd+aes256gcm', payload_raw_size: enc.encode(BODY).byteLength,
    });
    const m = conv(collectChunkDedup(db, null, null)); // key=null
    expect(m.encryptedRowsSkipped).toBe(1);
    expect(m.measuredRows).toBe(0);
  });
});
