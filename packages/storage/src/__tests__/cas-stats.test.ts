/**
 * getCasStats — CAS 실현 절감 집계 회귀 가드 (CAS 후속 가시화)
 *
 * @description
 *   artifacts + proxy_request_chunks 로부터 "이미 실현된 CAS 절감"을 산출한다
 *   (system_prompts realized dedup과 대칭: logical = 참조별 raw_size 합, unique = 고유 청크 합).
 *   UI 저장소 패널이 이 수치로 dedup 효과를 노출한다.
 *
 * @see packages/storage/src/queries/cas-stats.ts
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';
import { createProxyRequest } from '../queries/proxy';
import { storeProxyPayloadChunks, MANIFEST_CHUNKS_V1 } from '../queries/proxy-payload';
import { splitConversation } from '../artifacts';
import { getCasStats } from '../queries/cas-stats';

const BODY = JSON.stringify({
  system: '공통 시스템',
  messages: [{ role: 'user', content: '안녕' }, { role: 'assistant', content: '반가워' }],
  tools: [{ name: 'Read' }],
  model: 'claude',
});

let db: Database;
beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
});
afterEach(() => db.close());

function seedCas(id: string, body: string): void {
  const chunks = splitConversation(body)!.chunks;
  db.transaction(() => {
    createProxyRequest(db, { id, timestamp: Date.now(), method: 'POST', path: '/v1/messages', payload_manifest_algo: MANIFEST_CHUNKS_V1 });
    storeProxyPayloadChunks(db, id, chunks, Date.now());
  })();
}

describe('getCasStats', () => {
  test('빈 DB — 전부 0, savedPct 0(0 나눗셈 방어)', () => {
    const s = getCasStats(db);
    expect(s.artifactCount).toBe(0);
    expect(s.chunkRefCount).toBe(0);
    expect(s.casRowCount).toBe(0);
    expect(s.logicalBytes).toBe(0);
    expect(s.savedPct).toBe(0);
  });

  test('동일 BODY 2요청 → 참조 2배·고유 1배, 절감 정확히 50%', () => {
    const n = splitConversation(BODY)!.chunks.length;
    seedCas('a', BODY);
    seedCas('b', BODY);
    const s = getCasStats(db);
    expect(s.casRowCount).toBe(2);
    expect(s.artifactCount).toBe(n);        // 전부 공유 → 고유 = 청크 수
    expect(s.chunkRefCount).toBe(2 * n);    // 2요청 × n 참조
    expect(s.logicalBytes).toBe(2 * s.uniqueBytes); // 참조 총 평문 = 2배 고유
    expect(s.savedBytes).toBe(s.logicalBytes - s.uniqueBytes);
    expect(s.savedPct).toBeCloseTo(50, 5);
    expect(s.storedBytes).toBeGreaterThan(0); // zstd 물리 저장(작은 청크는 프레임 오버헤드로 평문보다 클 수도)
  });

  test('단일 요청 — 절감 0%(중복 없음), 고유=참조', () => {
    seedCas('solo', BODY);
    const s = getCasStats(db);
    expect(s.chunkRefCount).toBe(s.artifactCount);
    expect(s.savedBytes).toBe(0);
    expect(s.savedPct).toBe(0);
  });
});
