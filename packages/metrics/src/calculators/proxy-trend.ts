/**
 * Proxy Trend 계산기 — 24h × 1h 버킷 응답시간 / 에러율 / 비용 (proxy-hourly).
 *
 * 데이터 소스: stats_proxy_hourly (사전 집계 SSoT).
 *
 * 응답:
 *   - buckets: 24개 (1h 단위), 빈 버킷은 0/null로 채움
 *   - avg_response_time_ms_now: 최신 valid 버킷의 응답시간
 *   - total_cost_usd: 24h 누적 비용
 *   - error_rate_now: 최신 valid 버킷의 에러율
 */
import type { Database } from 'bun:sqlite';
import { fillHourSlots, type TimeWindow } from '../_shared';

export interface ProxyTrendBucket {
  hour_ts: number;        // ms (cache-trend와 동일 단위)
  avg_response_time_ms: number | null;
  avg_first_token_ms: number | null;
  error_rate: number | null;
  request_count: number;
  cost_usd: number;
}

export interface ProxyTrendPayload {
  buckets: ProxyTrendBucket[];
  avg_response_time_ms_now: number | null;
  error_rate_now: number | null;
  total_cost_usd: number;
  total_requests: number;
}

interface RawBucket {
  hour_ts_sec: number;
  request_count: number;
  error_count: number;
  response_time_ms_sum: number;
  response_time_ms_count: number;
  first_token_ms_sum: number;
  first_token_ms_count: number;
  cost_usd_sum: number;
}

function getProxyTrendBuckets(db: Database, fromMs: number, toMs: number): ProxyTrendBucket[] {
  const fromBucket = Math.floor(fromMs / 1000 / 3600) * 3600;
  const toBucket = Math.floor(toMs / 1000 / 3600) * 3600;

  const rows = db
    .query(
      `SELECT
         hour_ts                        AS hour_ts_sec,
         SUM(request_count)             AS request_count,
         SUM(error_count)               AS error_count,
         SUM(response_time_ms_sum)      AS response_time_ms_sum,
         SUM(response_time_ms_count)    AS response_time_ms_count,
         SUM(first_token_ms_sum)        AS first_token_ms_sum,
         SUM(first_token_ms_count)      AS first_token_ms_count,
         SUM(cost_usd_sum)              AS cost_usd_sum
       FROM stats_proxy_hourly
       WHERE hour_ts >= ? AND hour_ts <= ?
       GROUP BY hour_ts
       ORDER BY hour_ts ASC`
    )
    .all(fromBucket, toBucket) as RawBucket[];

  return rows.map((r) => {
    const avgResponse =
      r.response_time_ms_count > 0
        ? Math.round((r.response_time_ms_sum / r.response_time_ms_count) * 100) / 100
        : null;
    const avgFirstToken =
      r.first_token_ms_count > 0
        ? Math.round((r.first_token_ms_sum / r.first_token_ms_count) * 100) / 100
        : null;
    const errorRate =
      r.request_count > 0
        ? Math.round((r.error_count / r.request_count) * 10_000) / 10_000
        : null;
    return {
      hour_ts: r.hour_ts_sec * 1000,
      avg_response_time_ms: avgResponse,
      avg_first_token_ms: avgFirstToken,
      error_rate: errorRate,
      request_count: r.request_count,
      cost_usd: Math.round(r.cost_usd_sum * 1_000_000) / 1_000_000,
    };
  });
}

export function computeProxyTrend(db: Database, window: TimeWindow): ProxyTrendPayload {
  const now = Date.now();
  const toMs = window.to ?? now;
  const fromMs = window.from ?? toMs - 24 * 3_600_000;

  const raw = getProxyTrendBuckets(db, fromMs, toMs);
  const buckets: ProxyTrendBucket[] = fillHourSlots(raw, fromMs, toMs, (hour_ts, r) => ({
    hour_ts,
    avg_response_time_ms: r?.avg_response_time_ms ?? null,
    avg_first_token_ms: r?.avg_first_token_ms ?? null,
    error_rate: r?.error_rate ?? null,
    request_count: r?.request_count ?? 0,
    cost_usd: r?.cost_usd ?? 0,
  }));

  // 최신 valid 값을 끝에서부터 탐색
  let avg_response_time_ms_now: number | null = null;
  let error_rate_now: number | null = null;
  for (let i = buckets.length - 1; i >= 0; i--) {
    if (avg_response_time_ms_now === null && buckets[i].avg_response_time_ms !== null) {
      avg_response_time_ms_now = buckets[i].avg_response_time_ms;
    }
    if (error_rate_now === null && buckets[i].error_rate !== null) {
      error_rate_now = buckets[i].error_rate;
    }
    if (avg_response_time_ms_now !== null && error_rate_now !== null) break;
  }

  const total_cost_usd = Math.round(
    buckets.reduce((s, b) => s + b.cost_usd, 0) * 1_000_000
  ) / 1_000_000;
  const total_requests = buckets.reduce((s, b) => s + b.request_count, 0);

  return {
    buckets,
    avg_response_time_ms_now,
    error_rate_now,
    total_cost_usd,
    total_requests,
  };
}
