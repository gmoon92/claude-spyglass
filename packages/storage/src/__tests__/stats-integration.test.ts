/**
 * stats-aggregation 통합 테스트.
 *
 * 시나리오:
 *  1) fixture 기반 절대 비교 — 고정 requests 6건 INSERT → 트리거가 stats_hourly에 정확히
 *     누적 → getCacheStats 결과가 expected 값과 일치 (ADR-006 BLOCKER 해소)
 *  2) 응답 shape 보존 — CacheStats 인터페이스 모든 키 존재 + 타입 일치
 *  3) cache-trend 응답 shape 보존
 *  4) pre→tool 머지 시나리오 — stats가 정확히 보정됨
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  SpyglassDatabase,
  closeDatabase,
  createSession,
  createRequest,
  getCacheStats,
} from '../index';
import { getCacheTrendBuckets } from '../queries/metrics/timeseries';

const TEST_DB_PATH = `/tmp/spyglass-stats-int-${Date.now()}.db`;

const HOUR_MS = 3600 * 1000;
// 2026-05-16 04:00 UTC, 같은 hour bucket 안에 fixture 데이터 6건
const T0 = 1778904000000;

describe('stats-aggregation 통합', () => {
  let db: SpyglassDatabase;
  let sessionId: string;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
    sessionId = crypto.randomUUID();
    createSession(db.instance, {
      id: sessionId,
      project_name: 'stats-int',
      started_at: T0,
    });

    // Fixture 6건 (모두 같은 hour bucket T0)
    // prompt × 2, response × 2, tool_call(event_type=tool) × 2
    createRequest(db.instance, {
      id: 'p1', session_id: sessionId, timestamp: T0, type: 'prompt',
      model: 'fx', tokens_input: 100, tokens_output: 0,
      cache_creation_tokens: 50, cache_read_tokens: 200,
    });
    createRequest(db.instance, {
      id: 'p2', session_id: sessionId, timestamp: T0 + 1000, type: 'prompt',
      model: 'fx', tokens_input: 80,
      cache_read_tokens: 150,
    });
    createRequest(db.instance, {
      id: 'r1', session_id: sessionId, timestamp: T0 + 2000, type: 'response',
      model: 'fx', tokens_input: 0, tokens_output: 300,
    });
    createRequest(db.instance, {
      id: 'r2', session_id: sessionId, timestamp: T0 + 3000, type: 'response',
      model: 'fx', tokens_input: 0, tokens_output: 500,
      cache_creation_tokens: 100,
    });
    createRequest(db.instance, {
      id: 't1', session_id: sessionId, timestamp: T0 + 4000, type: 'tool_call',
      event_type: 'tool', model: 'fx', tokens_input: 20, tokens_output: 40,
      cache_read_tokens: 60,
    });
    createRequest(db.instance, {
      id: 't2', session_id: sessionId, timestamp: T0 + 5000, type: 'tool_call',
      event_type: 'tool', model: 'fx', tokens_input: 10, tokens_output: 25,
      cache_read_tokens: 40,
    });
  });

  afterEach(() => {
    closeDatabase();
    for (const ext of ['', '-wal', '-shm']) {
      try { require('fs').unlinkSync(TEST_DB_PATH + ext); } catch {}
    }
  });

  it('getCacheStats: fixture 절대값 비교', () => {
    // 분자: cache_read = 200 + 150 + 60 + 40 = 450
    //                   (cache_creation도 분모이지만 분자 아님)
    // 분모: tokens_input + cache_read + cache_creation
    //       = (100+80+0+0+20+10) + 450 + (50+0+0+100+0+0)
    //       = 210 + 450 + 150 = 810
    // hitRate = 450/810 = 0.5556
    const stats = getCacheStats(db.instance);

    expect(stats.cacheReadTokens).toBe(450);
    expect(stats.cacheCreationTokens).toBe(150);
    expect(stats.savingsTokens).toBe(450);
    expect(stats.hitRate).toBeCloseTo(0.5556, 3);
    expect(stats.savingsRate).toBeCloseTo(0.5556, 3);
  });

  it('CacheStats 인터페이스 shape 보존', () => {
    const stats = getCacheStats(db.instance);
    const keys = Object.keys(stats).sort();
    expect(keys).toEqual([
      'cacheCreationTokens',
      'cacheReadTokens',
      'hitRate',
      'savingsRate',
      'savingsTokens',
    ]);
    // 타입 확인
    expect(typeof stats.hitRate).toBe('number');
    expect(typeof stats.cacheReadTokens).toBe('number');
    expect(typeof stats.cacheCreationTokens).toBe('number');
    expect(typeof stats.savingsTokens).toBe('number');
    expect(typeof stats.savingsRate).toBe('number');
  });

  it('cache-trend 버킷 응답 shape 보존', () => {
    const fromMs = T0 - HOUR_MS;
    const toMs = T0 + HOUR_MS;
    const buckets = getCacheTrendBuckets(db.instance, fromMs, toMs);

    expect(buckets.length).toBeGreaterThan(0);
    const bucket = buckets[0];
    expect(Object.keys(bucket).sort()).toEqual(['hit_rate', 'hour_ts', 'savings_tokens']);
    // hour_ts는 ms 단위 보존
    expect(bucket.hour_ts).toBeGreaterThan(1_000_000_000_000);
  });

  it('cache-trend: type=prompt만 합산', () => {
    const buckets = getCacheTrendBuckets(db.instance, T0 - HOUR_MS, T0 + HOUR_MS);
    const target = buckets.find((b) => b.hour_ts === T0);

    expect(target).toBeDefined();
    // prompt 두 건만 합산: cache_read = 200 + 150 = 350, input = 100 + 80 = 180
    // hit_rate = 350 / (180 + 350) = 350/530 = 0.6604
    expect(target!.savings_tokens).toBe(350);
    expect(target!.hit_rate).toBeCloseTo(0.6604, 3);
  });

  it('pre→tool 머지: 트리거가 stats를 정확히 보정', () => {
    // 새 pre_tool INSERT → 트리거 skip
    createRequest(db.instance, {
      id: 'merge-x', session_id: sessionId, timestamp: T0 + 6000,
      type: 'tool_call', event_type: 'pre_tool', model: 'fx',
    });
    const beforeMerge = getCacheStats(db.instance);

    // pre_tool → tool UPDATE
    db.instance.prepare(
      `UPDATE requests SET event_type='tool', tokens_input=?, tokens_output=?, cache_read_tokens=? WHERE id=?`
    ).run(15, 30, 25, 'merge-x');

    const afterMerge = getCacheStats(db.instance);
    // merge로 cache_read +25, input +15
    expect(afterMerge.cacheReadTokens - beforeMerge.cacheReadTokens).toBe(25);
  });

  it('rebuild-stats가 트리거 누적 결과와 동일', () => {
    const beforeRebuild = getCacheStats(db.instance);

    // rebuild-stats 효과: stats_hourly 절단 후 재집계
    const { rebuildStatsHourly } = require('../queries/stats/build-aggregate');
    db.instance.transaction(() => {
      rebuildStatsHourly(db.instance, { truncate: true });
    })();

    const afterRebuild = getCacheStats(db.instance);
    // 트리거로 만든 결과와 백필 결과가 정확히 일치해야 함
    expect(afterRebuild).toEqual(beforeRebuild);
  });
});
