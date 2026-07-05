/**
 * flush-gate — graph flush 정합 게이트 (ADR A3) + UTC일 floor (A4)
 *
 * @see packages/storage/src/archive/flush-gate.ts
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';
import { getOldestUnflushedTs, floorToUtcDay, computeSafeArchiveTs } from '../archive/flush-gate';

let db: Database;
beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
});
afterEach(() => db.close());

function seedOutbox(id: number, ts: number, dead = 0): void {
  db.run(`INSERT INTO kuzu_outbox (id, source, event_id, op, ts, dead) VALUES (?, 'requests', ?, 'insert', ?, ?)`, [id, 'e' + id, ts, dead]);
}

describe('getOldestUnflushedTs', () => {
  test('미처리 없음 → null (전부 flush됨)', () => {
    expect(getOldestUnflushedTs(db, 0)).toBeNull();
  });

  test('cursor 초과 최소 id의 ts 반환', () => {
    seedOutbox(1, 1000);
    seedOutbox(2, 2000);
    seedOutbox(3, 3000);
    expect(getOldestUnflushedTs(db, 0)).toBe(1000); // 전부 미처리
    expect(getOldestUnflushedTs(db, 1)).toBe(2000); // id>1
    expect(getOldestUnflushedTs(db, 3)).toBeNull(); // 전부 처리
  });

  test('dead(DLQ) 행은 미-flush 계산에서 제외', () => {
    seedOutbox(1, 1000, 1); // dead
    seedOutbox(2, 2000, 0);
    expect(getOldestUnflushedTs(db, 0)).toBe(2000); // dead 1은 스킵
  });
});

describe('floorToUtcDay / computeSafeArchiveTs', () => {
  const DAY = 86400_000;

  test('floorToUtcDay — 하루 경계로 내림', () => {
    expect(floorToUtcDay(DAY * 100 + 12345)).toBe(DAY * 100);
    expect(floorToUtcDay(DAY * 100)).toBe(DAY * 100);
  });

  test('미-flush 없으면 archive 경계를 UTC일로 내림', () => {
    const cutoff = DAY * 100 + 5000;
    expect(computeSafeArchiveTs(cutoff, null)).toBe(DAY * 100);
  });

  test('미-flush가 더 이르면 그쪽으로 상한 제한 (flush 정합)', () => {
    const cutoff = DAY * 100 + 5000;      // 경계
    const unflushed = DAY * 98 + 3000;    // 더 과거에 미-flush 존재
    // min(cutoff, unflushed) = unflushed → UTC일 floor
    expect(computeSafeArchiveTs(cutoff, unflushed)).toBe(DAY * 98);
  });

  test('미-flush가 경계보다 미래면 경계 유지', () => {
    const cutoff = DAY * 100 + 5000;
    const unflushed = DAY * 102;
    expect(computeSafeArchiveTs(cutoff, unflushed)).toBe(DAY * 100);
  });

  test('결과는 항상 UTC일 경계(hour 버킷 무분할 불변식)', () => {
    expect(computeSafeArchiveTs(DAY * 50 + 99999, DAY * 49 + 77777) % DAY).toBe(0);
  });
});
