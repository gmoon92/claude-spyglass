/**
 * stats_proxy_hourly 집계 SQL — 백필(032)과 rebuild-stats-proxy 스크립트 공유.
 *
 * stats-aggregation의 build-aggregate.ts와 동일 패턴. 차원·필터·산식이 트리거(032)와
 * 1:1 매칭되어야 한다.
 *
 * 차원: hour_ts + model
 * 버킷 산식: (timestamp / 1000 / 3600) * 3600
 * 측정값: request_count, error_count, stream_count, tokens_*, cache_*,
 *         response_time_ms_sum/count, first_token_ms_sum/count, cost_usd_sum
 */
import type { Database } from 'bun:sqlite';

export const STATS_PROXY_HOURLY_AGGREGATE_SELECT = `
  SELECT
    (timestamp / 1000 / 3600) * 3600               AS hour_ts,
    COALESCE(model, '')                             AS model,
    COUNT(*)                                        AS request_count,
    SUM(CASE WHEN (status_code >= 400 OR error_type IS NOT NULL) THEN 1 ELSE 0 END) AS error_count,
    SUM(CASE WHEN is_stream = 1 THEN 1 ELSE 0 END) AS stream_count,
    SUM(COALESCE(tokens_input, 0))                  AS tokens_input,
    SUM(COALESCE(tokens_output, 0))                 AS tokens_output,
    SUM(COALESCE(cache_creation_tokens, 0))         AS cache_creation_tokens,
    SUM(COALESCE(cache_read_tokens, 0))             AS cache_read_tokens,
    SUM(CASE WHEN response_time_ms IS NOT NULL THEN response_time_ms ELSE 0 END) AS response_time_ms_sum,
    SUM(CASE WHEN response_time_ms IS NOT NULL THEN 1 ELSE 0 END)                AS response_time_ms_count,
    SUM(CASE WHEN first_token_ms   IS NOT NULL THEN first_token_ms   ELSE 0 END) AS first_token_ms_sum,
    SUM(CASE WHEN first_token_ms   IS NOT NULL THEN 1 ELSE 0 END)                AS first_token_ms_count,
    SUM(COALESCE(cost_usd, 0.0))                    AS cost_usd_sum
  FROM proxy_requests
`;

export const STATS_PROXY_HOURLY_INSERT_COLUMNS = `
  hour_ts, model,
  request_count, error_count, stream_count,
  tokens_input, tokens_output,
  cache_creation_tokens, cache_read_tokens,
  response_time_ms_sum, response_time_ms_count,
  first_token_ms_sum,   first_token_ms_count,
  cost_usd_sum
`;

export interface BuildProxyAggregateOptions {
  sinceTs?: number;
  truncate?: boolean;
}

export function rebuildStatsProxyHourly(
  db: Database,
  options: BuildProxyAggregateOptions = {}
): { rowsInserted: number } {
  const sinceTs = options.sinceTs;
  const truncate = options.truncate ?? false;

  if (truncate) {
    if (sinceTs === undefined) {
      db.prepare('DELETE FROM stats_proxy_hourly').run();
    } else {
      db.prepare('DELETE FROM stats_proxy_hourly WHERE hour_ts >= ?').run(sinceTs);
    }
  }

  const whereSinceFragment =
    sinceTs === undefined ? '' : ` WHERE timestamp >= ${sinceTs * 1000}`;

  const sql = `
    INSERT INTO stats_proxy_hourly (${STATS_PROXY_HOURLY_INSERT_COLUMNS})
    ${STATS_PROXY_HOURLY_AGGREGATE_SELECT}${whereSinceFragment}
    GROUP BY hour_ts, model
    ON CONFLICT(hour_ts, model) DO NOTHING
  `;
  const result = db.prepare(sql).run();
  return { rowsInserted: Number(result.changes ?? 0) };
}
