/**
 * CAS 쓰기 경로 — storeProxyPayloadChunks + createProxyRequest + reconstruct 왕복 (CAS Phase 3)
 *
 * @description
 *   실제 쓰기 헬퍼(storeProxyPayloadChunks)로 저장한 CAS 행이 reconstructProxyPayloadText로
 *   원본과 동일하게 복원되는지, dedup(ref_count)이 성립하는지, 트랜잭션 원자성(중간 throw 시
 *   artifacts/manifest/proxy_requests 미적재)이 지켜지는지를 회귀 가드로 고정한다.
 *
 * @see packages/storage/src/queries/proxy-payload.ts
 * @see packages/server/src/proxy/handler/persist.ts (실제 트랜잭션 호출부)
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';
import { createProxyRequest, getProxyRequestById } from '../queries/proxy';
import {
  storeProxyPayloadChunks,
  reconstructProxyPayloadText,
  MANIFEST_CHUNKS_V1,
} from '../queries/proxy-payload';
import { splitConversation } from '../artifacts';

const enc = new TextEncoder();
const bodyOf = (messages: unknown[]) =>
  JSON.stringify({ system: '공통 시스템', messages, tools: [{ name: 'Read' }], model: 'claude' });

let db: Database;
beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
});
afterEach(() => db.close());

/** persist.ts 트랜잭션을 축약 재현: createProxyRequest(manifest 신호) + storeProxyPayloadChunks. */
function writeCasRow(id: string, body: string, nowMs = Date.now()): void {
  const chunks = splitConversation(body)!.chunks;
  db.transaction(() => {
    createProxyRequest(db, {
      id,
      timestamp: nowMs,
      method: 'POST',
      path: '/v1/messages',
      payload: null,
      payload_algo: null,
      payload_manifest_algo: MANIFEST_CHUNKS_V1,
      payload_raw_size: enc.encode(body).byteLength,
    });
    storeProxyPayloadChunks(db, id, chunks, nowMs);
  })();
}

function artifactCount(): number {
  return (db.query('SELECT COUNT(*) AS n FROM artifacts').get() as { n: number }).n;
}

describe('CAS 쓰기 왕복', () => {
  test('storeProxyPayloadChunks로 쓴 CAS 행이 reconstruct로 원본 복원', () => {
    const body = bodyOf([{ role: 'user', content: '안녕' }, { role: 'assistant', content: '반가워' }]);
    writeCasRow('cas1', body);

    const row = getProxyRequestById(db, 'cas1')!;
    expect(row.payload_manifest_algo).toBe(MANIFEST_CHUNKS_V1);
    expect(row.payload).toBeNull(); // 통짜 payload 미저장

    const r = reconstructProxyPayloadText(db, row);
    expect(r.error).toBeNull();
    expect(JSON.parse(r.text!)).toEqual(JSON.parse(body));
  });

  test('createProxyRequest가 payload_manifest_algo를 영속한다', () => {
    writeCasRow('cas2', bodyOf([{ role: 'user', content: 'x' }]));
    const row = db.query('SELECT payload_manifest_algo FROM proxy_requests WHERE id = ?').get('cas2') as {
      payload_manifest_algo: string | null;
    };
    expect(row.payload_manifest_algo).toBe(MANIFEST_CHUNKS_V1);
  });
});

describe('CAS dedup — 요청 간 공유 청크', () => {
  test('동일 body 두 요청 → artifacts는 청크 1벌만, 공유 청크 ref_count=2', () => {
    const body = bodyOf([{ role: 'user', content: '반복 턴' }]);
    const chunkCount = splitConversation(body)!.chunks.length;
    writeCasRow('a', body);
    writeCasRow('b', body);
    // 두 요청이 동일 청크를 참조 → artifacts 행은 1벌(chunkCount)만
    expect(artifactCount()).toBe(chunkCount);
    // 모든 청크 ref_count=2
    const min = (db.query('SELECT MIN(ref_count) AS m FROM artifacts').get() as { m: number }).m;
    expect(min).toBe(2);
    // 각 요청은 독립적으로 원본 복원
    expect(JSON.parse(reconstructProxyPayloadText(db, getProxyRequestById(db, 'a')!).text!)).toEqual(JSON.parse(body));
    expect(JSON.parse(reconstructProxyPayloadText(db, getProxyRequestById(db, 'b')!).text!)).toEqual(JSON.parse(body));
  });

  test('일부만 겹치는 두 요청 → 공유 청크만 ref_count=2, 고유 청크는 1', () => {
    const shared = { role: 'user', content: '공유 메시지' };
    writeCasRow('x', bodyOf([shared, { role: 'assistant', content: 'X 고유' }]));
    writeCasRow('y', bodyOf([shared, { role: 'assistant', content: 'Y 고유' }]));
    // system·tools·shared message·envelope 일부가 공유됨 → ref_count=2인 청크가 존재
    const shareds = (db.query('SELECT COUNT(*) AS n FROM artifacts WHERE ref_count = 2').get() as { n: number }).n;
    expect(shareds).toBeGreaterThan(0);
  });
});

describe('CAS 쓰기 원자성', () => {
  test('트랜잭션 중간 throw → artifacts/manifest/proxy_requests 모두 미적재', () => {
    const body = bodyOf([{ role: 'user', content: 'atomic' }]);
    const chunks = splitConversation(body)!.chunks;
    expect(() =>
      db.transaction(() => {
        createProxyRequest(db, {
          id: 'boom',
          timestamp: Date.now(),
          method: 'POST',
          path: '/v1/messages',
          payload_manifest_algo: MANIFEST_CHUNKS_V1,
        });
        storeProxyPayloadChunks(db, 'boom', chunks, Date.now());
        throw new Error('boom'); // 롤백 유발
      })(),
    ).toThrow('boom');

    expect(artifactCount()).toBe(0);
    expect((db.query('SELECT COUNT(*) AS n FROM proxy_request_chunks').get() as { n: number }).n).toBe(0);
    expect(getProxyRequestById(db, 'boom')).toBeNull();
  });
});
