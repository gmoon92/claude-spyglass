/**
 * rebuild-stats 스크립트 핵심 함수(rebuildStatsHourly) 단위 테스트.
 *
 * 검증:
 *  - 빈 stats_hourly에서 idempotent 재구축
 *  - --since 범위 필터 동작
 *  - 두 번 실행해도 결과 동일
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  SpyglassDatabase,
  closeDatabase,
  createSession,
  createRequest,
} from '../index';
import { rebuildStatsHourly } from '../queries/stats/build-aggregate';

const TEST_DB_PATH = `/tmp/spyglass-rebuild-stats-${Date.now()}.db`;
const T1 = 1778904000000; // bucket 1778904000
const T2 = T1 + 3600 * 1000; // 1시간 후, bucket 1778907600

interface CountRow { n: number; t: number }

function counts(db: SpyglassDatabase): { stats: CountRow; reqs: CountRow } {
  const stats = db.instance
    .query(
      `SELECT SUM(request_count) AS n,
              SUM(tokens_input + tokens_output) AS t
         FROM stats_hourly`
    )
    .get() as CountRow;
  const reqs = db.instance
    .query(
      `SELECT COUNT(*) AS n,
              SUM(COALESCE(tokens_input, 0) + COALESCE(tokens_output, 0)) AS t
         FROM requests
         WHERE event_type IS NULL OR event_type != 'pre_tool'`
    )
    .get() as CountRow;
  return {
    stats: { n: stats.n ?? 0, t: stats.t ?? 0 },
    reqs: { n: reqs.n ?? 0, t: reqs.t ?? 0 },
  };
}

describe('rebuildStatsHourly', () => {
  let db: SpyglassDatabase;
  let sessionId: string;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
    sessionId = crypto.randomUUID();
    createSession(db.instance, {
      id: sessionId,
      project_name: 'rebuild-test',
      started_at: T1,
    });
    // 같은 hour: response 1, prompt 1 / 다음 hour: tool_call 1
    createRequest(db.instance, {
      id: 'a', session_id: sessionId, timestamp: T1, type: 'response',
      model: 'm', tokens_input: 100, tokens_output: 200,
    });
    createRequest(db.instance, {
      id: 'b', session_id: sessionId, timestamp: T1, type: 'prompt',
      model: 'm', tokens_input: 50,
    });
    createRequest(db.instance, {
      id: 'c', session_id: sessionId, timestamp: T2, type: 'tool_call',
      event_type: 'tool', model: 'm', tokens_input: 10, tokens_output: 20,
    });
  });

  afterEach(() => {
    closeDatabase();
    for (const ext of ['', '-wal', '-shm']) {
      try { require('fs').unlinkSync(TEST_DB_PATH + ext); } catch {}
    }
  });

  it('truncate 전체 재집계 — requests 합산과 정확히 일치', () => {
    const { stats: before, reqs } = counts(db);
    expect(before.n).toBe(reqs.n); // 트리거로 이미 일치

    const r = rebuildStatsHourly(db.instance, { truncate: true });
    expect(r.rowsInserted).toBeGreaterThan(0);

    const { stats: after, reqs: r2 } = counts(db);
    expect(after.n).toBe(r2.n);
    expect(after.t).toBe(r2.t);
  });

  it('idempotent — 두 번 호출해도 결과 동일', () => {
    rebuildStatsHourly(db.instance, { truncate: true });
    const first = counts(db).stats;

    rebuildStatsHourly(db.instance, { truncate: true });
    const second = counts(db).stats;

    expect(second).toEqual(first);
  });

  it('--since: 지정 hour_ts 이후만 재집계', () => {
    // T1 bucket과 T2 bucket 둘 다 채워진 상태
    rebuildStatsHourly(db.instance, { truncate: true });
    const before = counts(db).stats;

    // T2 bucket만 재집계: T1 bucket은 그대로
    const sinceTs = Math.floor(T2 / 1000 / 3600) * 3600;
    rebuildStatsHourly(db.instance, { truncate: true, sinceTs });

    const after = counts(db).stats;
    expect(after.n).toBe(before.n); // 전체 합은 동일
    // T1 bucket 데이터 유지 확인
    const t1Row = db.instance
      .query('SELECT SUM(request_count) AS n FROM stats_hourly WHERE hour_ts < ?')
      .get(sinceTs) as { n: number };
    expect(t1Row.n).toBe(2); // a, b
  });

  it('빈 requests에서 재집계 → stats_hourly 비어있음', () => {
    db.instance.run("DELETE FROM requests");
    rebuildStatsHourly(db.instance, { truncate: true });
    const stats = counts(db).stats;
    expect(stats.n).toBe(0);
  });
});
