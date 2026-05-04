/**
 * Observability Metrics — 공통 row 타입.
 *
 * 변경 이유: 새 지표 추가 시 row 모양 변경. SQL 작성과 분리.
 */

export interface ModelUsageRow {
  model: string;
  request_count: number;
  total_tokens: number;
  avg_tokens: number;
}

export interface ModelCacheMatrixRow {
  model: string;
  total_input: number;
  cache_read: number;
  cache_create: number;
}

export interface SessionContextUsageRow {
  session_id: string;
  model: string | null;
  final_tokens: number;
}

export interface ActivityHeatmapRow {
  weekday: number; // 0=Sun ~ 6=Sat (SQLite strftime('%w'))
  hour: number;   // 0~23
  count: number;
}

export interface TurnsPerSessionRow {
  session_id: string;
  turn_count: number;
}

export interface ToolCategoryRawRow {
  tool_name: string;
  request_count: number;
}

/** Burn Rate 1시간 버킷 (left-panel-observability-revamp ADR-003) */
export interface BurnRateBucketRow {
  /** 버킷 시작 ms (UTC, 1h 정렬) */
  hour_ts: number;
  /** prompt 레코드 tokens_total 합 (tokens_confidence='high' 한정) */
  tokens: number;
  /** prompt 레코드 수 */
  requests: number;
}

/** Cache Trend 1시간 버킷 (left-panel-observability-revamp ADR-003) */
export interface CacheTrendBucketRow {
  hour_ts: number;
  /** cache_read / (tokens_input + cache_read), denom=0이면 null */
  hit_rate: number | null;
  /** cache_read_tokens (절감 토큰 = 캐시로 재사용된 input) */
  savings_tokens: number;
}

export interface AnomalyInputRow {
  id: string;
  session_id: string;
  turn_id: string | null;
  type: string;
  tool_name: string | null;
  timestamp: number;
  tokens_input: number;
  duration_ms: number;
}
