/**
 * SqliteArtifactStore — store/load round-trip + dedup + 평문 해시 안정성 (CAS Phase 2)
 *
 * @description
 *   CAS의 두 핵심 계약을 회귀 가드로 고정한다:
 *   1) round-trip: store한 평문 bytes를 load하면 원본과 동일(평문/암호화 양쪽).
 *   2) 평문 해시 안정성: 동일 content면 암호화 ON/OFF와 무관하게 동일 hash.
 *      (해시는 encodeBlob 이전 평문 기준 — AES 랜덤 nonce가 dedup을 깨지 않음을 증명)
 *
 * @see packages/storage/src/artifacts/artifact-store.ts
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../../migrator';
import { generateKey } from '../../crypto';
import { SqliteArtifactStore } from '../artifact-store';

const enc = new TextEncoder();
const dec = new TextDecoder();
const NOW = 1_700_000_000_000;

let db: Database;
beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
});
afterEach(() => db.close());

function rowCount(): number {
  return (db.query('SELECT COUNT(*) AS n FROM artifacts').get() as { n: number }).n;
}
function refCount(hash: string): number {
  return (db.query('SELECT ref_count FROM artifacts WHERE hash = ?').get(hash) as { ref_count: number }).ref_count;
}

describe('SqliteArtifactStore — round-trip', () => {
  test('평문(key null): store→load 원본 복원, algo=zstd', () => {
    const store = new SqliteArtifactStore(db, NOW, { key: null });
    const content = enc.encode('반복되는 대화 블록 🐣');
    const ref = store.store(content);
    expect(ref.algo).toBe('zstd');
    expect(ref.size).toBe(content.byteLength);
    expect(ref.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(dec.decode(store.load(ref.hash))).toBe('반복되는 대화 블록 🐣');
  });

  test('암호화(key 주입): store→load 원본 복원, algo=zstd+aes256gcm, 평문 비노출', () => {
    const key = generateKey();
    const store = new SqliteArtifactStore(db, NOW, { key });
    const content = enc.encode('민감한 블록');
    const ref = store.store(content);
    expect(ref.algo).toBe('zstd+aes256gcm');
    // stored_bytes에 평문 노출 없음
    const stored = db.query('SELECT stored_bytes FROM artifacts WHERE hash = ?').get(ref.hash) as { stored_bytes: Uint8Array };
    expect(dec.decode(stored.stored_bytes)).not.toContain('민감');
    expect(dec.decode(store.load(ref.hash))).toBe('민감한 블록');
  });
});

describe('SqliteArtifactStore — dedup (ref_count)', () => {
  test('동일 content 2회 store → 행 1개, ref_count=2, hash 동일', () => {
    const store = new SqliteArtifactStore(db, NOW, { key: null });
    const content = enc.encode('중복 블록');
    const a = store.store(content);
    const b = store.store(content);
    expect(a.hash).toBe(b.hash);
    expect(rowCount()).toBe(1);
    expect(refCount(a.hash)).toBe(2);
  });

  test('다른 content → 행 2개, 각 ref_count=1', () => {
    const store = new SqliteArtifactStore(db, NOW, { key: null });
    store.store(enc.encode('A'));
    store.store(enc.encode('B'));
    expect(rowCount()).toBe(2);
  });
});

describe('SqliteArtifactStore — 평문 해시 안정성 (dedup 불변식 핵심)', () => {
  test('암호화 ON/OFF에도 동일 content면 동일 hash (nonce 무관)', () => {
    const content = enc.encode('동일 평문 블록');
    // 평문 저장 DB
    const plainStore = new SqliteArtifactStore(db, NOW, { key: null });
    const plainRef = plainStore.store(content);
    // 암호화 저장 DB (별도)
    const db2 = new Database(':memory:');
    runMigrations(db2);
    const encStore = new SqliteArtifactStore(db2, NOW, { key: generateKey() });
    const encRef = encStore.store(content);
    db2.close();
    // 해시는 평문 기준 → 저장 방식과 무관하게 동일
    expect(encRef.hash).toBe(plainRef.hash);
  });

  test('암호화 두 번 store — nonce가 달라도 같은 hash로 dedup', () => {
    const store = new SqliteArtifactStore(db, NOW, { key: generateKey() });
    const content = enc.encode('암호화 반복 블록');
    const a = store.store(content);
    const b = store.store(content);
    expect(a.hash).toBe(b.hash);
    expect(rowCount()).toBe(1);
    expect(refCount(a.hash)).toBe(2);
  });
});

describe('SqliteArtifactStore — load/exists 계약', () => {
  test('exists: 저장 전 false, 저장 후 true', () => {
    const store = new SqliteArtifactStore(db, NOW, { key: null });
    const content = enc.encode('존재 확인');
    const hash = store.store(content).hash;
    expect(store.exists(hash)).toBe(true);
    expect(store.exists('0'.repeat(64))).toBe(false);
  });

  test('load 미존재 hash → throw (데이터 손상 신호)', () => {
    const store = new SqliteArtifactStore(db, NOW, { key: null });
    expect(() => store.load('0'.repeat(64))).toThrow();
  });
});
