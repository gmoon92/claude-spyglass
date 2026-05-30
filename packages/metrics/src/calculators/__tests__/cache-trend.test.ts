/**
 * cache-trend.test.ts — computeCacheTrend 특성화 테스트 (T01).
 *
 * @description
 *   현재 프로덕션 동작 고정용 characterization test. 동작 변경 금지.
 *
 *   데이터 소스: storage `getCacheTrendBuckets` → stats_hourly(트리거 사전집계, type='prompt')에서
 *   1h 버킷 hit_rate = cache_read / (tokens_input + cache_read), savings_tokens = cache_read.
 *   stats_hourly.hour_ts는 sec → 응답에서 ×1000(ms)로 변환.
 *   계산기는 (1) fillHourSlots 빈슬롯 null/0 채움 (2) 끝에서부터 마지막 valid hit_rate 추출
 *   (3) savings_tokens 합.
 *
 *   stats_hourly는 createRequest INSERT 시 AFTER INSERT 트리거가 자동 누적한다.
 *   결정성을 위해 window.from/to를 명시한다.
 *
 * @see packages/server/src/metrics/calculators/cache-trend.ts
 * @see packages/storage/src/queries/metrics/timeseries.ts getCacheTrendBuckets
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { SpyglassDatabase, closeDatabase, createSession, createRequest } from '@spyglass/storage';
import { computeCacheTrend } from '../cache-trend';
import type { TimeWindow } from '../../_shared';

const TEST_DB_PATH = `/tmp/spyglass-cache-trend-${Date.now()}.db`;
const HOUR = 3_600_000;
const T0 = 1778904000000; // 2026-05-16 04:00:00 UTC, hour-aligned
const SESSION = 'cache-sess';

let db: SpyglassDatabase;

beforeEach(() => {
  db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
  createSession(db.instance, { id: SESSION, project_name: 'cache', started_at: T0 - 48 * HOUR });
});

afterEach(() => {
  closeDatabase();
  for (const ext of ['', '-wal', '-shm']) {
    try { require('fs').unlinkSync(TEST_DB_PATH + ext); } catch {}
  }
});

/** stats_hourly에 누적될 prompt 행 삽입 (트리거 경유) */
function insertPrompt(
  id: string,
  timestamp: number,
  fields: { tokens_input?: number; cache_read?: number; cache_create?: number },
): void {
  createRequest(db.instance, {
    id,
    session_id: SESSION,
    timestamp,
    type: 'prompt',
    model: 'fx',
    tokens_input: fields.tokens_input ?? 0,
    cache_read_tokens: fields.cache_read ?? 0,
    cache_creation_tokens: fields.cache_create ?? 0,
  });
}

// =============================================================================
// 엣지 / 경계
// =============================================================================

describe('computeCacheTrend — 엣지/경계', () => {
  it('데이터 0건 — 모든 슬롯 hit_rate=null/savings=0, hit_rate_now=null', () => {
    const window: TimeWindow = { from: T0, to: T0 + 2 * HOUR, label: 'custom' };
    const r = computeCacheTrend(db.instance, window);

    expect(r.buckets).toHaveLength(3); // T0, T0+H, T0+2H
    for (const b of r.buckets) {
      expect(b.hit_rate).toBeNull();
      expect(b.savings_tokens).toBe(0);
    }
    expect(r.hit_rate_now).toBeNull();
    expect(r.savings_tokens_total).toBe(0);
  });

  it('cache_read=0, input>0 — denom>0 이므로 hit_rate=0 (null 아님)', () => {
    const window: TimeWindow = { from: T0, to: T0 + HOUR, label: 'custom' };
    insertPrompt('p1', T0 + 1000, { tokens_input: 1000, cache_read: 0 });
    const r = computeCacheTrend(db.instance, window);

    // denom = 1000 + 0 = 1000 > 0 → hit_rate = 0/1000 = 0
    expect(r.buckets[0].hit_rate).toBe(0);
    expect(r.hit_rate_now).toBe(0);
    expect(r.savings_tokens_total).toBe(0);
  });

  it('input=0, cache_read=0 — denom=0 → hit_rate=null (현재 동작 고정)', () => {
    const window: TimeWindow = { from: T0, to: T0 + HOUR, label: 'custom' };
    // cache_creation만 있고 input/cache_read 둘 다 0 → stats_hourly에 행은 생기나 denom=0
    insertPrompt('p1', T0 + 1000, { tokens_input: 0, cache_read: 0, cache_create: 500 });
    const r = computeCacheTrend(db.instance, window);

    // getCacheTrendBuckets: denom>0일 때만 hit_rate, 아니면 null → 빈슬롯과 동일하게 null 유지
    expect(r.buckets[0].hit_rate).toBeNull();
    expect(r.buckets[0].savings_tokens).toBe(0);
    expect(r.hit_rate_now).toBeNull();
  });
});

// =============================================================================
// 성공 케이스
// =============================================================================

describe('computeCacheTrend — 집계/최신값', () => {
  it('단일 버킷 hit_rate + savings 산출', () => {
    const window: TimeWindow = { from: T0, to: T0 + HOUR, label: 'custom' };
    insertPrompt('p1', T0 + 1000, { tokens_input: 100, cache_read: 200 });
    insertPrompt('p2', T0 + 2000, { tokens_input: 80, cache_read: 150 });
    const r = computeCacheTrend(db.instance, window);

    // 합산: input=180, cache_read=350 → hit_rate=350/530=0.6604(round 4) , savings=350
    expect(r.buckets[0].savings_tokens).toBe(350);
    expect(r.buckets[0].hit_rate).toBeCloseTo(0.6604, 4);
    expect(r.hit_rate_now).toBeCloseTo(0.6604, 4);
    expect(r.savings_tokens_total).toBe(350);
  });

  it('hit_rate_now는 마지막 valid 버킷에서 추출 (뒤쪽 빈 버킷 무시)', () => {
    const window: TimeWindow = { from: T0, to: T0 + 3 * HOUR, label: 'custom' };
    insertPrompt('a', T0 + 100, { tokens_input: 100, cache_read: 100 });       // bucket T0: 0.5
    insertPrompt('b', T0 + HOUR + 100, { tokens_input: 100, cache_read: 300 }); // bucket T0+H: 0.75
    // T0+2H, T0+3H 버킷은 비움 (hit_rate=null)
    const r = computeCacheTrend(db.instance, window);

    expect(r.buckets.map(b => b.hit_rate)).toEqual([0.5, 0.75, null, null]);
    // 끝에서부터 첫 non-null → T0+H 버킷의 0.75
    expect(r.hit_rate_now).toBe(0.75);
    expect(r.savings_tokens_total).toBe(400); // 100 + 300
  });

  it('여러 버킷 savings_tokens 합산', () => {
    const window: TimeWindow = { from: T0, to: T0 + 2 * HOUR, label: 'custom' };
    insertPrompt('a', T0 + 100, { tokens_input: 50, cache_read: 50 });
    insertPrompt('b', T0 + HOUR + 100, { tokens_input: 50, cache_read: 70 });
    insertPrompt('c', T0 + 2 * HOUR, { tokens_input: 50, cache_read: 30 });
    const r = computeCacheTrend(db.instance, window);

    expect(r.savings_tokens_total).toBe(150); // 50+70+30
    expect(r.buckets).toHaveLength(3);
  });

  it('window.from/to 미지정 — Date.now() 기반 24h 윈도우 형태', () => {
    const r = computeCacheTrend(db.instance, { label: 'all' });
    expect(r.buckets.length).toBeGreaterThanOrEqual(24);
    expect(r.buckets.length).toBeLessThanOrEqual(25);
    expect(r.hit_rate_now).toBeNull();
    expect(r.savings_tokens_total).toBe(0);
  });
});
