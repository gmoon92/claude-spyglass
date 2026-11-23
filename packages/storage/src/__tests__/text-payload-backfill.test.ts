/**
 * backfillTextPayloads — 기존 TEXT payload zstd 압축 백필 회귀 가드 (Phase 4 후속)
 *
 * @description
 *   백필은 본문 컬럼을 덮어쓰는 작업이라 "원본 평문이 보존되는가" 를 고정한다.
 *   - 대상 3테이블(request_payloads·claude_events·system_prompts) 모두 압축 전환 + decode == 원본
 *   - 레거시 평문 마커(021 죽은 DEFAULT 'zstd')도 평문으로 취급해 전환
 *   - 512B 미만/압축 이득 없음은 원본 유지(skippedNoGain)
 *   - key 없으면 암호문 행은 건드리지 않고, key 있으면 aes256gcm → zstd-b64+aes256gcm 로 전환
 *   - dry-run 은 UPDATE 없음, 재실행 멱등, limit·작은 batch 에서도 keyset 커서가 끝까지 전진
 *
 * @see packages/storage/src/queries/backfill-text-payloads.ts
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';
import { backfillTextPayloads } from '../queries/backfill-text-payloads';
import { decodeText } from '../payload-codec';
import { encryptBytes, generateKey } from '../crypto';

const BIG = JSON.stringify({ messages: Array.from({ length: 40 }, (_, i) => ({ role: 'user', content: `반복 본문 ${i} `.repeat(5) })) });
const SMALL = '{"short":true}';

let db: Database;
beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
});
afterEach(() => db.close());

function seedRequestPayload(id: string, value: string, algo: string | null): void {
  db.run('INSERT INTO request_payloads (request_id, payload, payload_algo) VALUES (?, ?, ?)', [id, value, algo]);
}
function seedEvent(id: string, value: string, algo: string | null): void {
  db.run(
    "INSERT INTO claude_events (event_id, event_type, session_id, timestamp, payload, payload_algo) VALUES (?, 'Stop', 's1', 1000, ?, ?)",
    [id, value, algo],
  );
}
function seedSystemPrompt(hash: string, value: string, algo: string | null): void {
  db.run(
    'INSERT INTO system_prompts (hash, content, content_algo, byte_size, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, 1, 1)',
    [hash, value, algo, value.length],
  );
}
function row(table: string, idCol: string, valueCol: string, algoCol: string, id: string) {
  return db.query(`SELECT ${valueCol} AS value, ${algoCol} AS algo FROM ${table} WHERE ${idCol} = ?`).get(id) as {
    value: string; algo: string | null;
  };
}
const rp = (id: string) => row('request_payloads', 'request_id', 'payload', 'payload_algo', id);
const ev = (id: string) => row('claude_events', 'event_id', 'payload', 'payload_algo', id);
const sp = (h: string) => row('system_prompts', 'hash', 'content', 'content_algo', h);

/** 코덱 도입 이전 형태의 '암호화만' 된 값(압축 없음). */
function legacyEncrypted(plain: string, key: Buffer): string {
  return Buffer.from(encryptBytes(new TextEncoder().encode(plain), key)).toString('base64');
}

describe('backfillTextPayloads — 평문 경로(key 없음)', () => {
  test('3개 테이블의 큰 평문 행을 zstd-b64 로 전환하고 decode 결과는 원본과 같다', () => {
    seedRequestPayload('r1', BIG, null);
    seedEvent('e1', BIG, null);
    seedSystemPrompt('h1', BIG, null);

    const r = backfillTextPayloads(db, {});
    expect(r.byTable.request_payloads.compressed).toBe(1);
    expect(r.byTable.claude_events.compressed).toBe(1);
    expect(r.byTable.system_prompts.compressed).toBe(1);

    for (const x of [rp('r1'), ev('e1'), sp('h1')]) {
      expect(x.algo).toBe('zstd-b64');
      expect(x.value.length).toBeLessThan(BIG.length);
      expect(decodeText(x.value, x.algo, null)).toBe(BIG);
    }
  });

  test("레거시 평문 마커 'zstd'(021 죽은 DEFAULT) 행도 평문으로 보고 전환한다", () => {
    seedRequestPayload('r1', BIG, 'zstd');
    const r = backfillTextPayloads(db, {});
    expect(r.byTable.request_payloads.compressed).toBe(1);
    expect(rp('r1').algo).toBe('zstd-b64');
    expect(decodeText(rp('r1').value, rp('r1').algo, null)).toBe(BIG);
  });

  test('512B 미만 행은 원본을 그대로 둔다(skippedNoGain)', () => {
    seedRequestPayload('r1', SMALL, null);
    const r = backfillTextPayloads(db, {});
    expect(r.byTable.request_payloads).toEqual({ scanned: 1, compressed: 0, skippedNoGain: 1, skippedRoundtrip: 0 });
    expect(rp('r1')).toEqual({ value: SMALL, algo: null });
  });

  test('key 가 없으면 암호문 행은 후보에서 빠지고 값도 바뀌지 않는다', () => {
    const key = generateKey();
    const enc = legacyEncrypted(BIG, key);
    seedRequestPayload('r1', enc, 'aes256gcm');
    const r = backfillTextPayloads(db, {});
    expect(r.byTable.request_payloads.scanned).toBe(0);
    expect(rp('r1')).toEqual({ value: enc, algo: 'aes256gcm' });
  });

  test('dry-run 은 계측만 하고 UPDATE 하지 않는다', () => {
    seedRequestPayload('r1', BIG, null);
    const r = backfillTextPayloads(db, { dryRun: true });
    expect(r.byTable.request_payloads.compressed).toBe(1);
    expect(rp('r1')).toEqual({ value: BIG, algo: null });
  });

  test('재실행은 멱등이다 — 이미 압축된 행은 다시 스캔하지 않는다', () => {
    seedRequestPayload('r1', BIG, null);
    backfillTextPayloads(db, {});
    const after = rp('r1');
    const r2 = backfillTextPayloads(db, {});
    expect(r2.byTable.request_payloads.scanned).toBe(0);
    expect(rp('r1')).toEqual(after);
  });

  test('작은 batch 와 skip 행이 섞여도 keyset 커서가 끝까지 전진하고, limit 은 테이블별 상한이다', () => {
    for (let i = 0; i < 7; i++) seedRequestPayload(`r${i}`, i % 2 === 0 ? BIG : SMALL, null);

    const limited = backfillTextPayloads(db, { batchSize: 2, limit: 3 });
    expect(limited.byTable.request_payloads.scanned).toBe(3);

    const rest = backfillTextPayloads(db, { batchSize: 2 });
    // 압축 안 된(SMALL) 행은 계속 후보로 남으므로 전체를 다시 훑는다 — 무한루프 없이 종료해야 한다.
    const total = (db.query("SELECT COUNT(*) AS n FROM request_payloads WHERE payload_algo = 'zstd-b64'").get() as { n: number }).n;
    expect(total).toBe(4);
    expect(rest.byTable.request_payloads.skippedNoGain).toBe(3);
    for (let i = 0; i < 7; i++) {
      const x = rp(`r${i}`);
      expect(decodeText(x.value, x.algo, null)).toBe(i % 2 === 0 ? BIG : SMALL);
    }
  });
});

describe('backfillTextPayloads — 암호화 경로(key 있음)', () => {
  test('암호화만 된 레거시 행(aes256gcm)은 zstd-b64+aes256gcm 로 전환되고 원본이 보존된다', () => {
    const key = generateKey();
    seedEvent('e1', legacyEncrypted(BIG, key), 'aes256gcm');
    seedSystemPrompt('h1', BIG, null);

    const r = backfillTextPayloads(db, { key });
    expect(r.byTable.claude_events.compressed).toBe(1);
    expect(r.byTable.system_prompts.compressed).toBe(1);

    for (const x of [ev('e1'), sp('h1')]) {
      expect(x.algo).toBe('zstd-b64+aes256gcm');
      expect(decodeText(x.value, x.algo, key)).toBe(BIG);
    }
  });
});
