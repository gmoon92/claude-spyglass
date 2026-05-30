/**
 * feed-store.test.ts — 특성화 테스트 for FeedStore.
 *
 * FeedStore는 microtask(queueMicrotask)로 flush하므로,
 * 각 테스트는 await Promise.resolve() 또는 Bun의 microtask drain을 통해
 * flush를 강제한 뒤 상태를 검증한다.
 *
 * 주의: feedStore는 module-level singleton이므로 각 테스트 전에
 * reset([]) 으로 초기화한다.
 */

import { describe, expect, test, beforeEach } from 'bun:test';
import { feedStore } from '../stores/feed-store';
import type { Request } from '../types';

/** microtask queue가 모두 소진될 때까지 대기 */
async function drainMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function makeRow(over: Partial<Request> = {}): Request {
  return {
    id: 'r-default',
    session_id: 'sess-0',
    timestamp: Date.now(),
    tool_name: 'Read',
    tool_detail: '/file.ts',
    status: 'ok',
    event_type: 'tool',
    ...over,
  };
}

beforeEach(() => {
  feedStore.reset([]);
  feedStore.setFreeze(false);
});

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------
describe('FeedStore.reset', () => {
  test('replaces contents synchronously', () => {
    const rows = [makeRow({ id: 'a' }), makeRow({ id: 'b' })];
    feedStore.reset(rows);
    const snap = feedStore.getSnapshot();
    expect(snap.length).toBe(2);
    expect(snap[0]!.id).toBe('a');
    expect(snap[1]!.id).toBe('b');
  });

  test('empty reset clears store', () => {
    feedStore.reset([makeRow({ id: 'x' })]);
    feedStore.reset([]);
    expect(feedStore.getSnapshot().length).toBe(0);
  });

  test('notifies listeners', () => {
    let callCount = 0;
    const unsub = feedStore.subscribe(() => { callCount++; });
    feedStore.reset([makeRow()]);
    unsub();
    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  test('getSnapshot === getServerSnapshot after reset', () => {
    feedStore.reset([makeRow()]);
    expect(feedStore.getSnapshot()).toBe(feedStore.getServerSnapshot());
  });
});

// ---------------------------------------------------------------------------
// push / flush
// ---------------------------------------------------------------------------
describe('FeedStore.push', () => {
  test('new row appears in snapshot after microtask flush', async () => {
    feedStore.push(makeRow({ id: 'new-1' }));
    await drainMicrotasks();
    const snap = feedStore.getSnapshot();
    expect(snap.some((r) => r.id === 'new-1')).toBe(true);
  });

  test('newest rows are prepended (newest first)', async () => {
    feedStore.push(makeRow({ id: 'first' }));
    await drainMicrotasks();
    feedStore.push(makeRow({ id: 'second' }));
    await drainMicrotasks();
    const snap = feedStore.getSnapshot();
    expect(snap[0]!.id).toBe('second');
    expect(snap[1]!.id).toBe('first');
  });

  test('in-place update by tool_use_id preserves position', async () => {
    feedStore.push(makeRow({ id: 'a', tool_use_id: 'tuid-1', tool_name: 'Read' }));
    feedStore.push(makeRow({ id: 'b', tool_use_id: 'tuid-2', tool_name: 'Edit' }));
    await drainMicrotasks();

    // Update tuid-1 in-place
    feedStore.push(makeRow({ id: 'a', tool_use_id: 'tuid-1', tool_name: 'Write', duration_ms: 200 }));
    await drainMicrotasks();

    const snap = feedStore.getSnapshot();
    // Should still be 2 rows, not 3
    expect(snap.length).toBe(2);
    // tuid-1 row should be updated
    const updated = snap.find((r) => r.tool_use_id === 'tuid-1');
    expect(updated?.tool_name).toBe('Write');
    expect(updated?.duration_ms).toBe(200);
  });

  test('in-place update by id (no tool_use_id)', async () => {
    feedStore.push(makeRow({ id: 'plain-id', tool_name: 'Read' }));
    await drainMicrotasks();

    feedStore.push(makeRow({ id: 'plain-id', tool_name: 'Bash' }));
    await drainMicrotasks();

    const snap = feedStore.getSnapshot();
    expect(snap.length).toBe(1);
    expect(snap[0]!.tool_name).toBe('Bash');
  });

  test('rows capped at CAPACITY (500)', async () => {
    // Reset and push 510 rows
    const rows: Request[] = [];
    for (let i = 0; i < 510; i++) {
      rows.push(makeRow({ id: `row-${i}`, tool_use_id: undefined }));
    }
    feedStore.reset(rows);
    const snap = feedStore.getSnapshot();
    expect(snap.length).toBeLessThanOrEqual(500);
  });

  test('arrivedAt is set on new row', async () => {
    const before = Date.now();
    feedStore.push(makeRow({ id: 'ts-row', arrivedAt: undefined }));
    await drainMicrotasks();
    const after = Date.now();

    const row = feedStore.getSnapshot().find((r) => r.id === 'ts-row');
    expect(row).toBeDefined();
    expect(row!.arrivedAt).toBeGreaterThanOrEqual(before);
    expect(row!.arrivedAt).toBeLessThanOrEqual(after);
  });

  test('push notifies listeners after flush', async () => {
    let calls = 0;
    const unsub = feedStore.subscribe(() => { calls++; });
    feedStore.push(makeRow({ id: 'notify-test' }));
    await drainMicrotasks();
    unsub();
    expect(calls).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// freeze
// ---------------------------------------------------------------------------
describe('FeedStore.freeze', () => {
  test('isFrozen() reflects setFreeze', () => {
    expect(feedStore.isFrozen()).toBe(false);
    feedStore.setFreeze(true);
    expect(feedStore.isFrozen()).toBe(true);
    feedStore.setFreeze(false);
    expect(feedStore.isFrozen()).toBe(false);
  });

  test('push while frozen is dropped — snapshot unchanged after flush', async () => {
    feedStore.reset([makeRow({ id: 'existing' })]);
    feedStore.setFreeze(true);
    feedStore.push(makeRow({ id: 'dropped' }));
    await drainMicrotasks();
    feedStore.setFreeze(false);
    await drainMicrotasks();

    const snap = feedStore.getSnapshot();
    // 'dropped' should not appear
    expect(snap.some((r) => r.id === 'dropped')).toBe(false);
  });

  test('droppedCount() increments per dropped push', () => {
    feedStore.setFreeze(true);
    feedStore.push(makeRow({ id: 'd1' }));
    feedStore.push(makeRow({ id: 'd2' }));
    expect(feedStore.droppedCount()).toBe(2);
  });

  test('setFreeze(false) returns dropped count and resets it', () => {
    feedStore.setFreeze(true);
    feedStore.push(makeRow({ id: 'x' }));
    feedStore.push(makeRow({ id: 'y' }));
    const dropped = feedStore.setFreeze(false);
    expect(dropped).toBe(2);
    expect(feedStore.droppedCount()).toBe(0);
  });

  test('setFreeze(true) returns 0', () => {
    const result = feedStore.setFreeze(true);
    feedStore.setFreeze(false);
    expect(result).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// subscribe / unsubscribe
// ---------------------------------------------------------------------------
describe('FeedStore.subscribe', () => {
  test('unsubscribe stops notifications', async () => {
    let calls = 0;
    const unsub = feedStore.subscribe(() => { calls++; });
    unsub();
    feedStore.push(makeRow({ id: 'post-unsub' }));
    await drainMicrotasks();
    expect(calls).toBe(0);
  });

  test('multiple subscribers all notified', async () => {
    let a = 0;
    let b = 0;
    const ua = feedStore.subscribe(() => { a++; });
    const ub = feedStore.subscribe(() => { b++; });
    feedStore.reset([makeRow()]);
    ua();
    ub();
    expect(a).toBeGreaterThanOrEqual(1);
    expect(b).toBeGreaterThanOrEqual(1);
  });
});
