/**
 * CAS retention GC — 참조 청크 ref_count 차감 + 고아 회수 + 공유 청크 보존 (CAS Phase 3)
 *
 * @description
 *   deleteOldData가 오래된 proxy_requests를 지울 때, 그 요청이 참조하던 artifact의 ref_count를
 *   정확히 차감하고 0이 된 것만 삭제하며, 아직 살아있는 요청이 참조하는 공유 청크는 보존함을
 *   회귀 가드로 고정한다(system_prompts GC와 대칭).
 *
 * @see packages/storage/src/queries/session/retention.ts
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
import { deleteOldData } from '../queries/session/retention';
import { splitConversation, sha256HexBytes } from '../artifacts';

const enc = new TextEncoder();
const bodyOf = (messages: unknown[]) =>
  JSON.stringify({ system: '공통 시스템', messages, tools: [{ name: 'Read' }], model: 'claude' });

let db: Database;
beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
});
afterEach(() => db.close());

function writeCasRow(id: string, body: string, timestamp: number): void {
  const chunks = splitConversation(body)!.chunks;
  db.transaction(() => {
    createProxyRequest(db, {
      id,
      timestamp,
      method: 'POST',
      path: '/v1/messages',
      payload_manifest_algo: MANIFEST_CHUNKS_V1,
    });
    storeProxyPayloadChunks(db, id, chunks, timestamp);
  })();
}

function artifactRef(hash: string): number | null {
  const row = db.query('SELECT ref_count FROM artifacts WHERE hash = ?').get(hash) as { ref_count: number } | null;
  return row ? row.ref_count : null;
}

describe('CAS retention GC', () => {
  test('오래된 CAS 행 삭제: 고유 청크 회수, 공유 청크 보존, 살아있는 행 정상 복원', () => {
    const shared = { role: 'user', content: '공유 메시지' };
    const bodyOld = bodyOf([shared, { role: 'assistant', content: 'OLD 고유' }]);
    const bodyNew = bodyOf([shared, { role: 'assistant', content: 'NEW 고유' }]);

    writeCasRow('old', bodyOld, 1000); // cutoff 이전
    writeCasRow('new', bodyNew, 5000); // cutoff 이후

    // 청크 해시 계산 (envelope0, system1, msg[0]=shared2, msg[1]=unique3, tools4)
    const oldChunks = splitConversation(bodyOld)!.chunks;
    const sharedMsgHash = sha256HexBytes(enc.encode(oldChunks[2])); // 공유 메시지
    const oldUniqueHash = sha256HexBytes(enc.encode(oldChunks[3])); // OLD 고유 메시지

    // 사전: 공유 청크 ref_count=2, OLD 고유 ref_count=1
    expect(artifactRef(sharedMsgHash)).toBe(2);
    expect(artifactRef(oldUniqueHash)).toBe(1);

    // cutoff=3000: old만 삭제 대상
    deleteOldData(db, 3000);

    // old 행/매니페스트 소멸
    expect(getProxyRequestById(db, 'old')).toBeNull();
    expect((db.query("SELECT COUNT(*) AS n FROM proxy_request_chunks WHERE request_id='old'").get() as { n: number }).n).toBe(0);

    // OLD 고유 청크는 ref_count 0 → 삭제(고아 회수)
    expect(artifactRef(oldUniqueHash)).toBeNull();
    // 공유 청크는 new가 여전히 참조 → ref_count 1로 감소하며 보존
    expect(artifactRef(sharedMsgHash)).toBe(1);
    // ref_count<=0 잔존 없음
    expect((db.query('SELECT COUNT(*) AS n FROM artifacts WHERE ref_count <= 0').get() as { n: number }).n).toBe(0);

    // 살아있는 new 행은 원본으로 정상 복원
    const r = reconstructProxyPayloadText(db, getProxyRequestById(db, 'new')!);
    expect(r.error).toBeNull();
    expect(JSON.parse(r.text!)).toEqual(JSON.parse(bodyNew));
  });

  test('레거시(non-CAS) proxy_requests 삭제는 artifacts에 영향 없음 (회귀 가드)', () => {
    // CAS 행 하나 + 레거시 행 하나. 레거시만 오래됨.
    writeCasRow('cas-new', bodyOf([{ role: 'user', content: '유지' }]), 5000);
    createProxyRequest(db, { id: 'legacy-old', timestamp: 1000, method: 'POST', path: '/v1/messages' });

    const before = (db.query('SELECT COUNT(*) AS n FROM artifacts').get() as { n: number }).n;
    deleteOldData(db, 3000);
    const after = (db.query('SELECT COUNT(*) AS n FROM artifacts').get() as { n: number }).n;

    expect(getProxyRequestById(db, 'legacy-old')).toBeNull();
    expect(getProxyRequestById(db, 'cas-new')).not.toBeNull();
    expect(after).toBe(before); // CAS 행이 살아있으므로 artifact 회수 없음
  });
});
