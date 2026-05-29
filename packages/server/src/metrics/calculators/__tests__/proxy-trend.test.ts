/**
 * proxy-trend.test.ts — computeProxyTrend 특성화 테스트 (T01).
 *
 * @description
 *   현재 프로덕션 동작 고정용 characterization test. 동작 변경 금지.
 *
 *   데이터 소스: stats_proxy_hourly (proxy_requests INSERT 시 AFTER INSERT 트리거가 사전 집계).
 *   계산기 내부 SQL(getProxyTrendBuckets)이 hour_ts(sec) 기준 합산 후:
 *     - avg_response_time_ms = response_time_ms_sum / response_time_ms_count (count>0, round2)
 *     - avg_first_token_ms   = first_token_ms_sum   / first_token_ms_count   (count>0, round2)
 *     - error_rate           = error_count / request_count (request_count>0, round4)
 *     - cost_usd             = round6
 *   계산기는 (1) fillHourSlots 빈슬롯 null/0 채움 (2) 끝에서부터 마지막 valid
 *   avg_response_time/error_rate 추출 (3) total_cost_usd/total_requests 합.
 *
 *   트리거 error_count: status_code>=400 OR error_type IS NOT NULL.
 *   hour_ts(sec) 윈도우 필터: floor(fromMs/1000/3600)*3600 .. floor(toMs/1000/3600)*3600.
 *
 * @see packages/server/src/metrics/calculators/proxy-trend.ts
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { SpyglassDatabase, closeDatabase } from '@spyglass/storage';
import { computeProxyTrend } from '../proxy-trend';
import type { TimeWindow } from '../../_shared';

const TEST_DB_PATH = `/tmp/spyglass-proxy-trend-${Date.now()}.db`;
const HOUR = 3_600_000;
const T0 = 1778904000000; // 2026-05-16 04:00:00 UTC, hour-aligned (sec bucket = 1778904000)

let db: SpyglassDatabase;

beforeEach(() => {
  db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
});

afterEach(() => {
  closeDatabase();
  for (const ext of ['', '-wal', '-shm']) {
    try { require('fs').unlinkSync(TEST_DB_PATH + ext); } catch {}
  }
});

/** proxy_requests 삽입 → stats_proxy_hourly 트리거 자동 누적 */
function insertProxy(
  id: string,
  fields: Partial<{
    timestamp: number;
    status_code: number | null;
    response_time_ms: number | null;
    first_token_ms: number | null;
    model: string | null;
    cost_usd: number;
    is_stream: number;
    error_type: string | null;
  }>,
): void {
  db.instance
    .prepare(
      `INSERT INTO proxy_requests (
        id, timestamp, method, path, status_code, response_time_ms, first_token_ms,
        model, tokens_input, tokens_output, cache_creation_tokens, cache_read_tokens,
        cost_usd, is_stream, error_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      fields.timestamp ?? T0,
      'POST',
      '/v1/messages',
      fields.status_code ?? 200,
      fields.response_time_ms ?? null,
      fields.first_token_ms ?? null,
      fields.model ?? 'mx',
      0,
      0,
      0,
      0,
      fields.cost_usd ?? 0,
      fields.is_stream ?? 0,
      fields.error_type ?? null,
    );
}

// =============================================================================
// 엣지 / 경계
// =============================================================================

describe('computeProxyTrend — 엣지/경계', () => {
  it('데이터 0건 — 빈슬롯만, now값 null, 합계 0', () => {
    const window: TimeWindow = { from: T0, to: T0 + 2 * HOUR, label: 'custom' };
    const r = computeProxyTrend(db.instance, window);

    expect(r.buckets).toHaveLength(3); // T0, T0+H, T0+2H
    for (const b of r.buckets) {
      expect(b.avg_response_time_ms).toBeNull();
      expect(b.avg_first_token_ms).toBeNull();
      expect(b.error_rate).toBeNull();
      expect(b.request_count).toBe(0);
      expect(b.cost_usd).toBe(0);
    }
    expect(r.avg_response_time_ms_now).toBeNull();
    expect(r.error_rate_now).toBeNull();
    expect(r.total_cost_usd).toBe(0);
    expect(r.total_requests).toBe(0);
  });

  it('response_time_ms=null인 요청만 — avg_response_time_ms=null이나 request_count는 집계', () => {
    const window: TimeWindow = { from: T0, to: T0 + HOUR, label: 'custom' };
    insertProxy('p1', { response_time_ms: null, first_token_ms: null, status_code: 200 });
    const r = computeProxyTrend(db.instance, window);

    expect(r.buckets[0].request_count).toBe(1);
    // response_time_ms_count=0 → avg null
    expect(r.buckets[0].avg_response_time_ms).toBeNull();
    expect(r.buckets[0].avg_first_token_ms).toBeNull();
    // error_rate: request_count>0, error_count=0 → 0 (null 아님)
    expect(r.buckets[0].error_rate).toBe(0);
    expect(r.error_rate_now).toBe(0);
    // avg_response_time_ms_now: 어떤 버킷도 valid 없음 → null (현재 동작 고정)
    expect(r.avg_response_time_ms_now).toBeNull();
  });

  it('에러 판정: status_code>=400 또는 error_type 존재', () => {
    const window: TimeWindow = { from: T0, to: T0 + HOUR, label: 'custom' };
    insertProxy('ok',  { status_code: 200, response_time_ms: 100 });
    insertProxy('e4',  { status_code: 400, response_time_ms: 100 });
    insertProxy('e5',  { status_code: 500, response_time_ms: 100 });
    insertProxy('et',  { status_code: 200, error_type: 'overloaded', response_time_ms: 100 });
    const r = computeProxyTrend(db.instance, window);

    expect(r.buckets[0].request_count).toBe(4);
    // error_count = 3 (400,500,error_type) → 3/4 = 0.75
    expect(r.buckets[0].error_rate).toBe(0.75);
    expect(r.error_rate_now).toBe(0.75);
  });
});

// =============================================================================
// 성공 케이스
// =============================================================================

describe('computeProxyTrend — 집계/최신값', () => {
  it('단일 버킷 평균/비용 산출 (round 정책)', () => {
    const window: TimeWindow = { from: T0, to: T0 + HOUR, label: 'custom' };
    insertProxy('a', { status_code: 200, response_time_ms: 1000, first_token_ms: 100, cost_usd: 0.001 });
    insertProxy('b', { status_code: 200, response_time_ms: 2000, first_token_ms: 300, cost_usd: 0.002 });
    const r = computeProxyTrend(db.instance, window);

    // avg_response = (1000+2000)/2 = 1500
    expect(r.buckets[0].avg_response_time_ms).toBe(1500);
    // avg_first_token = (100+300)/2 = 200
    expect(r.buckets[0].avg_first_token_ms).toBe(200);
    expect(r.buckets[0].request_count).toBe(2);
    expect(r.buckets[0].error_rate).toBe(0);
    // cost = 0.003 (round6)
    expect(r.buckets[0].cost_usd).toBeCloseTo(0.003, 6);
    expect(r.avg_response_time_ms_now).toBe(1500);
    expect(r.error_rate_now).toBe(0);
    expect(r.total_cost_usd).toBeCloseTo(0.003, 6);
    expect(r.total_requests).toBe(2);
  });

  it('now값은 끝에서부터 마지막 valid 버킷 — 뒤쪽 빈 버킷 무시', () => {
    const window: TimeWindow = { from: T0, to: T0 + 3 * HOUR, label: 'custom' };
    insertProxy('a', { timestamp: T0 + 100, response_time_ms: 500, status_code: 200 });
    insertProxy('b', { timestamp: T0 + HOUR + 100, response_time_ms: 800, status_code: 500 });
    // T0+2H, T0+3H 비움
    const r = computeProxyTrend(db.instance, window);

    expect(r.buckets).toHaveLength(4);
    // 마지막 valid avg_response_time → T0+H 버킷의 800
    expect(r.avg_response_time_ms_now).toBe(800);
    // 마지막 valid error_rate → T0+H 버킷 (1/1 = 1)
    expect(r.error_rate_now).toBe(1);
    expect(r.total_requests).toBe(2);
  });

  it('여러 버킷 total_cost_usd/total_requests 합 + 빈 버킷 0채움', () => {
    const window: TimeWindow = { from: T0, to: T0 + 2 * HOUR, label: 'custom' };
    insertProxy('a', { timestamp: T0 + 100, cost_usd: 0.01, response_time_ms: 100 });
    insertProxy('b', { timestamp: T0 + 2 * HOUR + 100, cost_usd: 0.02, response_time_ms: 200 });
    const r = computeProxyTrend(db.instance, window);

    // 슬롯: T0, T0+H(빈), T0+2H
    expect(r.buckets).toHaveLength(3);
    expect(r.buckets[1].request_count).toBe(0);
    expect(r.buckets[1].cost_usd).toBe(0);
    expect(r.total_cost_usd).toBeCloseTo(0.03, 6);
    expect(r.total_requests).toBe(2);
  });

  it('window.from/to 미지정 — Date.now() 기반 24h 윈도우 형태', () => {
    const r = computeProxyTrend(db.instance, { label: 'all' });
    expect(r.buckets.length).toBeGreaterThanOrEqual(24);
    expect(r.buckets.length).toBeLessThanOrEqual(25);
    expect(r.total_requests).toBe(0);
    expect(r.avg_response_time_ms_now).toBeNull();
  });
});
