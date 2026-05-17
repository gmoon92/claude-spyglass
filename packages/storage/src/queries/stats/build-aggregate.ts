/**
 * stats_hourly 집계 SQL — 백필(029, 030)과 rebuild-stats 스크립트가 공유.
 *
 * 단일 책임: stats_hourly에 누적할 행을 requests에서 SELECT하는 식과 INSERT 절을 한
 * 군데로 모은다. 트리거(030)와는 동일 버킷 산식·동일 WHERE 필터·동일 차원을
 * 공유해야 하며, 산식이 바뀌면 본 모듈만 수정하면 된다 (ADR-005).
 *
 * 버킷 산식: (timestamp / 1000 / 3600) * 3600
 * WHERE 필터: event_type IS NULL OR event_type != 'pre_tool'
 * 차원: hour_ts + model + type + event_type (stats-event-type-dim ADR-001)
 * tokens_high 컬럼: tokens_confidence='high' 필터 재현용 (stats-event-type-dim ADR-003)
 */
import type { Database } from 'bun:sqlite';

/**
 * stats_hourly의 행 단위 집계 SELECT SQL. `since`가 주어지면 hour_ts 범위를 한정한다.
 * INSERT INTO stats_hourly(...) <이 SELECT>로 호출되어야 한다.
 */
export const STATS_HOURLY_AGGREGATE_SELECT = `
  SELECT
    (timestamp / 1000 / 3600) * 3600              AS hour_ts,
    COALESCE(model, '')                            AS model,
    type                                            AS type,
    COALESCE(event_type, '')                       AS event_type,
    COUNT(*)                                       AS request_count,
    SUM(COALESCE(tokens_input, 0))                 AS tokens_input,
    SUM(COALESCE(tokens_output, 0))                AS tokens_output,
    SUM(COALESCE(tokens_total, 0))                 AS tokens_total,
    SUM(COALESCE(cache_creation_tokens, 0))        AS cache_creation_tokens,
    SUM(COALESCE(cache_read_tokens, 0))            AS cache_read_tokens,
    SUM(CASE WHEN duration_ms IS NOT NULL THEN duration_ms ELSE 0 END) AS duration_ms_sum,
    SUM(CASE WHEN duration_ms IS NOT NULL THEN 1 ELSE 0 END)           AS duration_ms_count,
    SUM(CASE WHEN tokens_confidence = 'high' THEN COALESCE(tokens_input, 0)  ELSE 0 END) AS tokens_input_high_sum,
    SUM(CASE WHEN tokens_confidence = 'high' THEN COALESCE(tokens_output, 0) ELSE 0 END) AS tokens_output_high_sum,
    SUM(CASE WHEN tokens_confidence = 'high' THEN COALESCE(tokens_total, 0)  ELSE 0 END) AS tokens_total_high_sum,
    SUM(CASE WHEN tokens_confidence = 'high' THEN 1 ELSE 0 END)                          AS tokens_high_count
  FROM requests
  WHERE (event_type IS NULL OR event_type != 'pre_tool')
`;

export const STATS_HOURLY_INSERT_COLUMNS = `
  hour_ts, model, type, event_type,
  request_count,
  tokens_input, tokens_output, tokens_total,
  cache_creation_tokens, cache_read_tokens,
  duration_ms_sum, duration_ms_count,
  tokens_input_high_sum, tokens_output_high_sum,
  tokens_total_high_sum, tokens_high_count
`;

/**
 * 백필/재집계 옵션.
 *  - `sinceTs`: 지정 시 hour_ts >= sinceTs 범위만 재집계. 미지정 시 전체.
 *  - `truncate`: true면 대상 범위의 stats_hourly 행을 먼저 삭제 (재계산 시).
 *                false면 ON CONFLICT DO NOTHING으로 멱등성만 보장.
 */
export interface BuildAggregateOptions {
  sinceTs?: number;
  truncate?: boolean;
}

/**
 * stats_hourly를 requests로부터 집계해 다시 채운다.
 *
 * 호출자 책임:
 *  - 마이그레이션 적용 중에는 외부 hook insert가 없도록 보장 (서버 중단).
 *  - rebuild-stats 스크립트 안에서 호출 시 db.transaction()으로 감싸 DELETE+INSERT를
 *    같은 트랜잭션에 묶을 것.
 */
export function rebuildStatsHourly(db: Database, options: BuildAggregateOptions = {}): { rowsInserted: number } {
  const sinceTs = options.sinceTs;
  const truncate = options.truncate ?? false;

  if (truncate) {
    if (sinceTs === undefined) {
      db.prepare('DELETE FROM stats_hourly').run();
    } else {
      db.prepare('DELETE FROM stats_hourly WHERE hour_ts >= ?').run(sinceTs);
    }
  }

  const whereSinceFragment =
    sinceTs === undefined ? '' : ` AND timestamp >= ${sinceTs * 1000}`;

  const sql = `
    INSERT INTO stats_hourly (${STATS_HOURLY_INSERT_COLUMNS})
    ${STATS_HOURLY_AGGREGATE_SELECT}${whereSinceFragment}
    GROUP BY hour_ts, model, type, event_type
    ON CONFLICT(hour_ts, model, type, event_type) DO NOTHING
  `;
  const result = db.prepare(sql).run();
  return { rowsInserted: Number(result.changes ?? 0) };
}
