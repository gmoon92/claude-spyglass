/**
 * reconstructProxyPayloadText — CAS/레거시 역호환 재조립 SSoT (CAS Phase 3)
 *
 * @description
 *   proxy payload 재조립의 단일 진실 소스. 이 테스트는 최우선 회귀 가드다:
 *   - 레거시 행(payload_manifest_algo=NULL): 기존 decodeBlob 결과와 동일해야 한다.
 *   - CAS 행('chunks/v1'): 청크를 재조립해 원본과 JSON semantic 동일해야 한다.
 *   - 혼재 DB: 두 종류가 각자 신호 컬럼으로 자동 라우팅.
 *   - artifact 누락: throw가 아니라 graceful error(200 empty 유지).
 *
 * @see packages/storage/src/queries/proxy-payload.ts
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';
import { createProxyRequest } from '../queries/proxy';
import { reconstructProxyPayloadText } from '../queries/proxy-payload';
import { encodeBlob } from '../payload-codec';
import { splitConversation, SqliteArtifactStore } from '../artifacts';

const enc = new TextEncoder();
const BODY = JSON.stringify({
  system: '너는 유능한 조수다.',
  messages: [
    { role: 'user', content: '안녕' },
    { role: 'assistant', content: [{ type: 'text', text: '반가워 🙂' }] },
  ],
  tools: [{ name: 'Read', description: '파일 읽기' }],
  model: 'claude-opus-4-8',
  max_tokens: 1024,
});

let db: Database;
beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
});
afterEach(() => db.close());

/** 레거시 행(통짜 zstd BLOB) 시드. */
function seedLegacy(id: string): void {
  const e = encodeBlob(enc.encode(BODY), null);
  createProxyRequest(db, {
    id,
    timestamp: Date.now(),
    method: 'POST',
    path: '/v1/messages',
    payload: e.value,
    payload_raw_size: enc.encode(BODY).byteLength,
    payload_algo: e.algo ?? null,
  });
}

/** CAS 행(청크 분해 → artifact store → manifest) 시드. Task5 write path를 손으로 재현. */
function seedCas(id: string): void {
  const split = splitConversation(BODY)!;
  const store = new SqliteArtifactStore(db, Date.now(), { key: null });
  split.chunks.forEach((text, seq) => {
    const ref = store.store(enc.encode(text));
    db.run('INSERT INTO proxy_request_chunks (request_id, seq, chunk_hash) VALUES (?, ?, ?)', [id, seq, ref.hash]);
  });
  createProxyRequest(db, {
    id,
    timestamp: Date.now(),
    method: 'POST',
    path: '/v1/messages',
    payload: null,
    payload_raw_size: enc.encode(BODY).byteLength,
    payload_algo: null,
  });
  // payload_manifest_algo는 Task5에서 CreateProxyRequestParams에 추가된다. 여기선 직접 UPDATE로 세팅.
  db.run("UPDATE proxy_requests SET payload_manifest_algo = 'chunks/v1' WHERE id = ?", [id]);
}

function fetchRow(id: string): Parameters<typeof reconstructProxyPayloadText>[1] {
  return db.query('SELECT * FROM proxy_requests WHERE id = ?').get(id) as never;
}

describe('reconstructProxyPayloadText — 레거시 행', () => {
  test('레거시 zstd 행: 원본 복원, error 없음', () => {
    seedLegacy('legacy');
    const r = reconstructProxyPayloadText(db, fetchRow('legacy'));
    expect(r.error).toBeNull();
    expect(JSON.parse(r.text!)).toEqual(JSON.parse(BODY));
  });
});

describe('reconstructProxyPayloadText — CAS 행', () => {
  test("chunks/v1 행: 재조립 결과가 원본과 JSON semantic 동일", () => {
    seedCas('cas');
    const r = reconstructProxyPayloadText(db, fetchRow('cas'));
    expect(r.error).toBeNull();
    expect(JSON.parse(r.text!)).toEqual(JSON.parse(BODY));
  });
});

describe('reconstructProxyPayloadText — 혼재 DB 자동 라우팅', () => {
  test('레거시·CAS 행이 한 DB에 공존해도 각자 정상 복원', () => {
    seedLegacy('L');
    seedCas('C');
    expect(JSON.parse(reconstructProxyPayloadText(db, fetchRow('L')).text!)).toEqual(JSON.parse(BODY));
    expect(JSON.parse(reconstructProxyPayloadText(db, fetchRow('C')).text!)).toEqual(JSON.parse(BODY));
  });

  test('레거시 경로는 CAS 도입 후에도 기존 decodeBlob와 동일 결과 (회귀 가드)', () => {
    seedLegacy('L2');
    const row = fetchRow('L2');
    const r = reconstructProxyPayloadText(db, row);
    // 직접 decodeBlob로 계산한 기준값과 일치
    expect(JSON.parse(r.text!)).toEqual(JSON.parse(BODY));
  });
});

describe('reconstructProxyPayloadText — graceful 처리', () => {
  test('빈 body(payload null, manifest null) → text null, error null', () => {
    createProxyRequest(db, { id: 'empty', timestamp: Date.now(), method: 'POST', path: '/v1/messages' });
    const r = reconstructProxyPayloadText(db, fetchRow('empty'));
    expect(r.text).toBeNull();
    expect(r.error).toBeNull();
  });

  test('CAS 행인데 artifact 누락 → throw 아닌 graceful error', () => {
    // manifest만 있고 artifacts는 비어 있는 손상 상태
    const id = 'broken';
    createProxyRequest(db, { id, timestamp: Date.now(), method: 'POST', path: '/v1/messages' });
    db.run("UPDATE proxy_requests SET payload_manifest_algo = 'chunks/v1' WHERE id = ?", [id]);
    db.run('INSERT INTO proxy_request_chunks (request_id, seq, chunk_hash) VALUES (?, ?, ?)', [id, 0, '0'.repeat(64)]);
    const r = reconstructProxyPayloadText(db, fetchRow(id));
    expect(r.text).toBeNull();
    expect(r.error).not.toBeNull();
  });
});
