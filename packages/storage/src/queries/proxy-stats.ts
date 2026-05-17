/**
 * proxy_requests 사전 집계 기반 통계 함수 (proxy-hourly ADR-001~005).
 *
 * 데이터 소스: stats_proxy_hourly (사전 집계 SSoT)
 * 책임: 응답 시간·비용·에러·스트리밍 비율을 단일 호출로 제공
 */
import type { Database } from 'bun:sqlite';

export interface ProxyHourlyStats {
  /** 전체 proxy 요청 수 */
  total_requests: number;
  /** 에러 응답 수 (status >= 400 또는 error_type 채워짐) */
  error_count: number;
  /** 스트리밍 응답 수 (is_stream=1) */
  stream_count: number;
  /** 에러율 0~1 */
  error_rate: number;
  /** 스트리밍 비율 0~1 */
  stream_rate: number;
  /** 토큰 합계 */
  total_tokens_input: number;
  total_tokens_output: number;
  total_cache_creation_tokens: number;
  total_cache_read_tokens: number;
  /** 평균 응답시간 ms (NULL 제외 모든 행) */
  avg_response_time_ms: number;
  /** 평균 TTFT ms (NULL 제외 모든 행) */
  avg_first_token_ms: number;
  /** 누적 비용 USD (소수점 6자리 반올림) */
  total_cost_usd: number;
}

export interface ProxyHourlyStatsByModel {
  model: string;
  request_count: number;
  error_count: number;
  stream_count: number;
  total_tokens_input: number;
  total_tokens_output: number;
  avg_response_time_ms: number;
  avg_first_token_ms: number;
  total_cost_usd: number;
}

interface RawProxyAgg {
  total_requests: number;
  error_count: number;
  stream_count: number;
  total_tokens_input: number;
  total_tokens_output: number;
  total_cache_creation_tokens: number;
  total_cache_read_tokens: number;
  response_time_ms_sum: number;
  response_time_ms_count: number;
  first_token_ms_sum: number;
  first_token_ms_count: number;
  cost_usd_sum: number;
}

function applyTimeWindow(
  conditions: string[],
  params: number[],
  fromTs?: number,
  toTs?: number
): void {
  if (fromTs !== undefined) {
    conditions.push('hour_ts >= ?');
    params.push(Math.floor(fromTs / 1000 / 3600) * 3600);
  }
  if (toTs !== undefined) {
    conditions.push('hour_ts <= ?');
    params.push(Math.floor(toTs / 1000 / 3600) * 3600);
  }
}

/**
 * 프록시 요청 전체 통계 (대시보드 헤더용).
 * fromTs/toTs 미지정 시 전체 기간.
 */
export function getProxyHourlyStats(db: Database, fromTs?: number, toTs?: number): ProxyHourlyStats {
  const conditions: string[] = [];
  const params: number[] = [];
  applyTimeWindow(conditions, params, fromTs, toTs);
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const row = db.query(`
    SELECT
      COALESCE(SUM(request_count), 0)           AS total_requests,
      COALESCE(SUM(error_count), 0)             AS error_count,
      COALESCE(SUM(stream_count), 0)            AS stream_count,
      COALESCE(SUM(tokens_input), 0)            AS total_tokens_input,
      COALESCE(SUM(tokens_output), 0)           AS total_tokens_output,
      COALESCE(SUM(cache_creation_tokens), 0)   AS total_cache_creation_tokens,
      COALESCE(SUM(cache_read_tokens), 0)       AS total_cache_read_tokens,
      COALESCE(SUM(response_time_ms_sum), 0)    AS response_time_ms_sum,
      COALESCE(SUM(response_time_ms_count), 0)  AS response_time_ms_count,
      COALESCE(SUM(first_token_ms_sum), 0)      AS first_token_ms_sum,
      COALESCE(SUM(first_token_ms_count), 0)    AS first_token_ms_count,
      COALESCE(SUM(cost_usd_sum), 0.0)          AS cost_usd_sum
    FROM stats_proxy_hourly
    ${whereClause}
  `).get(...params) as RawProxyAgg;

  const errorRate = row.total_requests > 0 ? row.error_count / row.total_requests : 0;
  const streamRate = row.total_requests > 0 ? row.stream_count / row.total_requests : 0;
  const avgResponseTime = row.response_time_ms_count > 0
    ? row.response_time_ms_sum / row.response_time_ms_count
    : 0;
  const avgFirstToken = row.first_token_ms_count > 0
    ? row.first_token_ms_sum / row.first_token_ms_count
    : 0;

  return {
    total_requests: row.total_requests,
    error_count: row.error_count,
    stream_count: row.stream_count,
    error_rate: Math.round(errorRate * 10_000) / 10_000,
    stream_rate: Math.round(streamRate * 10_000) / 10_000,
    total_tokens_input: row.total_tokens_input,
    total_tokens_output: row.total_tokens_output,
    total_cache_creation_tokens: row.total_cache_creation_tokens,
    total_cache_read_tokens: row.total_cache_read_tokens,
    avg_response_time_ms: Math.round(avgResponseTime * 100) / 100,
    avg_first_token_ms: Math.round(avgFirstToken * 100) / 100,
    total_cost_usd: Math.round(row.cost_usd_sum * 1_000_000) / 1_000_000,
  };
}

/**
 * 모델별 프록시 통계 (GROUP BY model).
 */
export function getProxyHourlyStatsByModel(
  db: Database,
  fromTs?: number,
  toTs?: number
): ProxyHourlyStatsByModel[] {
  const conditions: string[] = [];
  const params: number[] = [];
  applyTimeWindow(conditions, params, fromTs, toTs);
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  type Raw = RawProxyAgg & { model: string; request_count: number };
  const rows = db.query(`
    SELECT
      model,
      SUM(request_count)           AS request_count,
      SUM(error_count)             AS error_count,
      SUM(stream_count)            AS stream_count,
      SUM(tokens_input)            AS total_tokens_input,
      SUM(tokens_output)           AS total_tokens_output,
      SUM(response_time_ms_sum)    AS response_time_ms_sum,
      SUM(response_time_ms_count)  AS response_time_ms_count,
      SUM(first_token_ms_sum)      AS first_token_ms_sum,
      SUM(first_token_ms_count)    AS first_token_ms_count,
      SUM(cost_usd_sum)            AS cost_usd_sum
    FROM stats_proxy_hourly
    ${whereClause}
    GROUP BY model
    ORDER BY request_count DESC
  `).all(...params) as Raw[];

  return rows.map((r) => ({
    model: r.model,
    request_count: r.request_count,
    error_count: r.error_count,
    stream_count: r.stream_count,
    total_tokens_input: r.total_tokens_input,
    total_tokens_output: r.total_tokens_output,
    avg_response_time_ms:
      r.response_time_ms_count > 0
        ? Math.round((r.response_time_ms_sum / r.response_time_ms_count) * 100) / 100
        : 0,
    avg_first_token_ms:
      r.first_token_ms_count > 0
        ? Math.round((r.first_token_ms_sum / r.first_token_ms_count) * 100) / 100
        : 0,
    total_cost_usd: Math.round(r.cost_usd_sum * 1_000_000) / 1_000_000,
  }));
}
