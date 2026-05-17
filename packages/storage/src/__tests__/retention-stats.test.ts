/**
 * retention(deleteOldData) 직후 stats_hourly 보정 검증 (ADR-004).
 *
 * 시나리오:
 *  - cutoff 이전 requests를 대량 삭제 → stats_hourly의 옛 bucket이 사라져야 함
 *  - cutoff 시각이 걸친 hour 버킷에서 일부만 삭제될 때, 남은 행으로 stats가 재집계됨
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  SpyglassDatabase,
  closeDatabase,
  createSession,
  createRequest,
} from '../index';
import { deleteOldData } from '../queries/session/retention';

const TEST_DB_PATH = `/tmp/spyglass-retention-stats-${Date.now()}.db`;

// 2026-05-13 00:00 UTC, +1h, +2h, +3h
const HOUR_MS = 3600 * 1000;
const T0 = 1778630400000;
const T1 = T0 + HOUR_MS;
const T2 = T0 + HOUR_MS * 2;
const T3 = T0 + HOUR_MS * 3;

describe('retention → stats_hourly 보정', () => {
  let db: SpyglassDatabase;
  let sessionId: string;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
    sessionId = crypto.randomUUID();
    createSession(db.instance, {
      id: sessionId,
      project_name: 'retention-test',
      started_at: T0,
    });
    // 4개 bucket에 각 1행씩
    createRequest(db.instance, { id: 'r0', session_id: sessionId, timestamp: T0, type: 'response', model: 'm', tokens_input: 10 });
    createRequest(db.instance, { id: 'r1', session_id: sessionId, timestamp: T1, type: 'response', model: 'm', tokens_input: 20 });
    createRequest(db.instance, { id: 'r2', session_id: sessionId, timestamp: T2, type: 'response', model: 'm', tokens_input: 30 });
    createRequest(db.instance, { id: 'r3', session_id: sessionId, timestamp: T3, type: 'response', model: 'm', tokens_input: 40 });
  });

  afterEach(() => {
    closeDatabase();
    for (const ext of ['', '-wal', '-shm']) {
      try { require('fs').unlinkSync(TEST_DB_PATH + ext); } catch {}
    }
  });

  it('cutoff 이전 bucket의 stats 행이 삭제됨', () => {
    const beforeRows = db.instance
      .query('SELECT COUNT(*) AS n FROM stats_hourly')
      .get() as { n: number };
    expect(beforeRows.n).toBe(4); // T0, T1, T2, T3 각각 1행

    // cutoff = T2 → T0, T1 bucket 삭제 대상
    deleteOldData(db.instance, T2);

    const afterStats = db.instance
      .query('SELECT hour_ts FROM stats_hourly ORDER BY hour_ts')
      .all() as { hour_ts: number }[];
    const remainingBuckets = afterStats.map((r) => r.hour_ts);

    // T2/3 bucket만 남아야 함
    expect(remainingBuckets).toEqual([T2 / 1000, T3 / 1000]);
  });

  it('cutoff와 같은 hour bucket이 정확히 보정됨 (잔여 행 기준 재집계)', () => {
    // 동일 hour bucket(T2)에 행 하나 더 추가 — T2와 같은 hour에 들어가도록 +1초
    createRequest(db.instance, {
      id: 'r2b', session_id: sessionId, timestamp: T2 + 1000 /* T2 hour 내 두 번째 행 */,
      type: 'response', model: 'm', tokens_input: 100,
    });

    // 트리거로 T2 bucket request_count = 2, tokens_input = 130 누적된 상태
    const t2Bucket = T2 / 1000;
    const before = db.instance
      .query('SELECT request_count, tokens_input FROM stats_hourly WHERE hour_ts = ?')
      .get(t2Bucket) as { request_count: number; tokens_input: number };
    expect(before.request_count).toBe(2);
    expect(before.tokens_input).toBe(130);

    // cutoff = T2 + 500: r2(T2)는 < cutoff라 삭제, r2b(T2+1000)는 >= cutoff라 남음
    deleteOldData(db.instance, T2 + 500);

    // stats_hourly의 T2 bucket이 남은 r2b(tokens_input=100)만 반영해야 함
    const after = db.instance
      .query('SELECT request_count, tokens_input FROM stats_hourly WHERE hour_ts = ?')
      .get(t2Bucket) as { request_count: number; tokens_input: number };
    expect(after.request_count).toBe(1);
    expect(after.tokens_input).toBe(100);
  });

  it('모든 데이터를 retention하면 stats_hourly가 비어짐', () => {
    deleteOldData(db.instance, T3 + HOUR_MS); // T3 이후가 cutoff → 모두 삭제

    const after = db.instance
      .query('SELECT COUNT(*) AS n FROM stats_hourly')
      .get() as { n: number };
    expect(after.n).toBe(0);
  });
});
