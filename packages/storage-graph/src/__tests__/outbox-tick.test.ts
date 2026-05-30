/**
 * outbox-tick.test.ts — runOutboxTick 의 systemic vs poison 구분 검증 (P1 보강 엣지케이스)
 *
 * 핵심 불변식:
 *   1) **전량 실패(시스템 장애)** — Ladybug 연결 단절 등으로 batch 의 모든 row 가 실패하면,
 *      attempts/dead 를 *건드리지 않고* cursor 동결 + 회로 failure 만 보고한다. 일시 장애에
 *      멀쩡한 row 가 대량 오격리(DLQ)되는 것을 막는다. 장애 복구 후 batch 전체 재시도.
 *   2) **healthy 중 일부 실패(진짜 독성)** — 1건 이상 성공하면 시스템이 정상임이 증명되므로
 *      실패 row 만 attempts++/dead 격리하고 cursor 는 미해결 실패 직전까지 전진, 회로 success.
 *
 * 실제 migration DB + 실제 enrich/mergeOps 를 쓰고, Ladybug client/cursor/breaker 만 fake.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { unlinkSync } from 'fs';
import { SpyglassDatabase, closeDatabase, createSession, createRequest } from '@spyglass/storage';
import { runOutboxTick, MAX_OUTBOX_ATTEMPTS } from '../sync/worker';
import type { LadybugClient } from '../client';

const TEST_DB_PATH = `/tmp/spyglass-outbox-tick-${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}.db`;
const NOW = 1778904000000;

/** fake cursor — 파일 I/O 없이 메모리 상태만. */
function fakeCursor(start = 0) {
  return { current: start, advance(id: number) { this.current = id; } };
}
/** fake circuit breaker — success/failure 호출 횟수만 카운트. */
function fakeBreaker() {
  return {
    successes: 0,
    failures: 0,
    recordSuccess() { this.successes++; },
    recordFailure() { this.failures++; },
  };
}

/**
 * fake Ladybug client.
 *  - mode 'healthy': 모든 query 성공.
 *  - mode 'systemic': 모든 query throw (연결 단절 모사).
 *  - mode 'poison': params 값에 poison reqId 가 있으면 throw, 그 외 성공.
 */
function fakeClient(mode: 'healthy' | 'systemic', poison: Set<string> = new Set()): LadybugClient {
  const client = {
    async query(_cypher: string, params?: Record<string, unknown>) {
      if (mode === 'systemic') throw new Error('ladybug connection lost');
      if (params && Object.values(params).some((v) => typeof v === 'string' && poison.has(v))) {
        throw new Error('poison op');
      }
      return { rows: [], durationMs: 0 };
    },
    async transaction<T>(work: () => Promise<T>): Promise<T> { return work(); },
  };
  return client as unknown as LadybugClient;
}

describe('runOutboxTick — systemic vs poison (P1 보강)', () => {
  let db: SpyglassDatabase;
  let sessionId: string;

  /** request 행 1개 생성 → AFTER INSERT 트리거가 outbox 에 자동 적재. 그 outbox id 반환. */
  function seedRequest(reqId: string): number {
    createRequest(db.instance, {
      id: reqId,
      session_id: sessionId,
      timestamp: NOW,
      type: 'tool_call',
      tool_name: 'Bash',
      tool_detail: 'ls',
      turn_id: `${sessionId}-T1`,
      event_type: 'tool',
      tool_use_id: `tu-${reqId}`,
    });
    const row = db.instance
      .query("SELECT id FROM kuzu_outbox WHERE source='requests' AND event_id = ?")
      .get(reqId) as { id: number };
    return row.id;
  }

  function attemptsOf(reqId: string): number {
    const row = db.instance
      .query("SELECT attempts, dead FROM kuzu_outbox WHERE source='requests' AND event_id = ?")
      .get(reqId) as { attempts: number; dead: number };
    return row.attempts;
  }
  function deadOf(reqId: string): number {
    const row = db.instance
      .query("SELECT dead FROM kuzu_outbox WHERE source='requests' AND event_id = ?")
      .get(reqId) as { dead: number };
    return row.dead;
  }

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
    sessionId = crypto.randomUUID();
    createSession(db.instance, { id: sessionId, project_name: 'dlq', started_at: NOW });
  });

  afterEach(() => {
    closeDatabase();
    for (const ext of ['', '-wal', '-shm']) {
      try { unlinkSync(`${TEST_DB_PATH}${ext}`); } catch { /* ignore */ }
    }
  });

  it('전량 실패(시스템 장애): DLQ 미오염 + cursor 동결 + 회로 failure', async () => {
    seedRequest('r1');
    seedRequest('r2');
    const cursor = fakeCursor(0);
    const breaker = fakeBreaker();

    const result = await runOutboxTick(db.instance, fakeClient('systemic'), cursor, breaker);

    // 멀쩡한 row 들이 일시 장애로 격리되지 않아야 한다 — attempts 0 유지.
    expect(attemptsOf('r1')).toBe(0);
    expect(attemptsOf('r2')).toBe(0);
    expect(deadOf('r1')).toBe(0);
    expect(deadOf('r2')).toBe(0);
    // cursor 동결, 회로 failure 1회, processed 0.
    expect(cursor.current).toBe(0);
    expect(breaker.failures).toBe(1);
    expect(breaker.successes).toBe(0);
    expect(result.processed).toBe(0);
  });

  it('장애 복구: systemic 후 healthy tick 에서 정상 적재(오염 흔적 없음)', async () => {
    const o1 = seedRequest('r1');
    const o2 = seedRequest('r2');
    // 1) 장애 tick
    await runOutboxTick(db.instance, fakeClient('systemic'), fakeCursor(0), fakeBreaker());
    // 2) 복구 후 healthy tick — 같은 batch 재처리.
    const cursor = fakeCursor(0);
    const breaker = fakeBreaker();
    const result = await runOutboxTick(db.instance, fakeClient('healthy'), cursor, breaker);

    expect(attemptsOf('r1')).toBe(0);
    expect(attemptsOf('r2')).toBe(0);
    expect(breaker.successes).toBe(1);
    expect(breaker.failures).toBe(0);
    // cursor 가 마지막 outbox row 까지 전진(session row + r1 + r2 모두 성공).
    expect(cursor.current).toBeGreaterThanOrEqual(Math.max(o1, o2));
    expect(result.processed).toBeGreaterThanOrEqual(2);
  });

  it('healthy 중 독성 1개: ≤MAX tick 내 DLQ + cursor 통과, 회로 failure 0', async () => {
    seedRequest('r1');           // healthy
    const oPoison = seedRequest('poison'); // 독성
    const oLast = seedRequest('r3'); // healthy (독성 뒤)
    const cursor = fakeCursor(0);
    const breaker = fakeBreaker();
    const client = fakeClient('healthy', new Set(['poison']));

    // 독성 row 가 dead 될 때까지 tick 반복(최대 MAX+2).
    let ticks = 0;
    while (deadOf('poison') === 0 && ticks < MAX_OUTBOX_ATTEMPTS + 2) {
      await runOutboxTick(db.instance, client, cursor, breaker);
      ticks++;
    }

    // 독성은 정확히 MAX tick 만에 DLQ.
    expect(deadOf('poison')).toBe(1);
    expect(attemptsOf('poison')).toBe(MAX_OUTBOX_ATTEMPTS);
    expect(ticks).toBe(MAX_OUTBOX_ATTEMPTS);
    // 회로는 한 번도 열리지 않음(매 tick 성공 row 존재).
    expect(breaker.failures).toBe(0);
    // dead 후 한 tick 더 돌리면 cursor 가 독성·뒤 row 를 모두 통과.
    await runOutboxTick(db.instance, client, cursor, breaker);
    expect(cursor.current).toBeGreaterThanOrEqual(oLast);
    expect(oPoison).toBeLessThan(oLast); // 순서 sanity
  });
});
