/**
 * Request 집계 (Aggregate) — 통계·집계 SQL 전용.
 *
 * @description
 *   srp-redesign Phase 1A: storage/queries/request.ts(1165줄)를 변경 이유별로 분해한 결과.
 *   이 파일의 변경 이유: "통계 지표 정의 변경 (count/sum/avg/percentile 등)".
 *
 *   같은 모듈로 응집해야 할 동기:
 *   - RequestStats / TypeStats / ToolStats / HourlyStats / StripStats / CacheStats 인터페이스가
 *     모두 동일한 통계 정책(tokens_confidence='high' 필터, post_tool 필터 등)을 공유
 *   - 새 지표 추가 시 인터페이스 + SQL이 한 곳에 응집되어 변경 범위 단일
 *
 *   read.ts와 분리한 이유:
 *   - 조회 정책 변경(필터·정렬)과 통계 정책 변경(집계 함수·신뢰도 필터)은 변경 사유가 다름
 *   - 조회는 ACTIVE_REQUEST_FILTER_SQL을 일관 사용, 집계는 별도 필터 정책
 *
 * 외부 시그니처(`@spyglass/storage` barrel)는 그대로 유지 — 이 파일을 통해 re-export.
 */

import type { Database } from 'bun:sqlite';
import type { RequestType } from '../../schema';

// =============================================================================
// 집계 (Aggregate)
// =============================================================================

/** 요청 통계 결과 */
export interface RequestStats {
  total_requests: number;
  total_tokens_input: number;
  total_tokens_output: number;
  total_tokens: number;
  avg_tokens_per_request: number;
  avg_duration_ms: number;
}

/**
 * tool_call PostToolUse 레코드 기준 평균 실행시간 (ms)
 *
 * prompt 레코드에는 duration_ms가 기록되지 않으므로 (PreToolUse→PostToolUse 쌍으로
 * tool_call에만 측정값이 있음) tool_call + event_type='tool' 레코드를 대상으로 집계.
 * duration_ms가 0보다 크고 600_000ms(10분) 미만인 레코드만 집계하여 타임스탬프
 * 오기입으로 인한 이상값을 제외한다.
 *
 * @param fromTs 집계 시작 타임스탬프 (옵셔널, 미지정 시 전체 기간)
 * @param toTs   집계 종료 타임스탬프 (옵셔널, 미지정 시 전체 기간)
 */
export function getAvgPromptDurationMs(
  db: Database,
  fromTs?: number,
  toTs?: number
): number {
  const conditions: string[] = [
    "type = 'tool_call'",
    "event_type = 'tool'",
    'duration_ms > 0',
    'duration_ms < 600000',
  ];
  const params: number[] = [];

  if (fromTs !== undefined) { conditions.push('timestamp >= ?'); params.push(fromTs); }
  if (toTs   !== undefined) { conditions.push('timestamp <= ?'); params.push(toTs); }

  const row = db.query(`
    SELECT AVG(duration_ms) as avg
    FROM requests
    WHERE ${conditions.join(' AND ')}
  `).get(...params) as { avg: number | null };
  return row?.avg ?? 0;
}

/**
 * 전체 요청 통계
 * 토큰 합계는 tokens_confidence='high'인 레코드만 집계
 * 요청 수는 모든 레코드 포함 (성공/실패 분리 필요 시 별도 쿼리 사용)
 */
export function getRequestStats(db: Database, fromTs?: number, toTs?: number): RequestStats {
  const conditions: string[] = ["(event_type IS NULL OR event_type = 'tool')"];
  const params: number[] = [];

  if (fromTs) { conditions.push('timestamp >= ?'); params.push(fromTs); }
  if (toTs) { conditions.push('timestamp <= ?'); params.push(toTs); }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;
  return db.query(`
    SELECT
      COUNT(*) as total_requests,
      COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_input ELSE 0 END), 0) as total_tokens_input,
      COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_output ELSE 0 END), 0) as total_tokens_output,
      COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_total ELSE 0 END), 0) as total_tokens,
      COALESCE(AVG(CASE WHEN tokens_confidence='high' THEN tokens_total ELSE NULL END), 0) as avg_tokens_per_request,
      COALESCE(AVG(duration_ms), 0) as avg_duration_ms
    FROM requests
    ${whereClause}
  `).get(...params) as RequestStats;
}

/**
 * 세션별 요청 통계
 * 토큰 합계는 tokens_confidence='high'인 레코드만 집계
 */
export function getRequestStatsBySession(
  db: Database,
  sessionId: string
): RequestStats {
  return db.query(`
    SELECT
      COUNT(*) as total_requests,
      COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_input ELSE 0 END), 0) as total_tokens_input,
      COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_output ELSE 0 END), 0) as total_tokens_output,
      COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_total ELSE 0 END), 0) as total_tokens,
      COALESCE(AVG(CASE WHEN tokens_confidence='high' THEN tokens_total ELSE NULL END), 0) as avg_tokens_per_request,
      COALESCE(AVG(duration_ms), 0) as avg_duration_ms
    FROM requests
    WHERE session_id = ?
  `).get(sessionId) as RequestStats;
}

/** 타입별 통계 */
export interface TypeStats {
  type: RequestType;
  count: number;
  total_tokens: number;
  avg_tokens: number;
}

/**
 * 요청 타입별 통계
 */
export function getRequestStatsByType(db: Database, fromTs?: number, toTs?: number): TypeStats[] {
  const conditions: string[] = [];
  const params: number[] = [];

  if (fromTs) { conditions.push('timestamp >= ?'); params.push(fromTs); }
  if (toTs) { conditions.push('timestamp <= ?'); params.push(toTs); }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  return db.query(`
    SELECT
      type,
      COUNT(*) as count,
      SUM(tokens_total) as total_tokens,
      AVG(tokens_total) as avg_tokens
    FROM requests
    ${whereClause}
    GROUP BY type
    ORDER BY total_tokens DESC
  `).all(...params) as TypeStats[];
}

/**
 * 도구별 통계 (tool_call 타입만, tool_name 단위 집계)
 *
 * 데이터 신뢰도 표지 필드 (data-honesty-ui):
 * - confidence_low_count: tokens_confidence='low' 행 수
 * - confidence_error_count: tokens_confidence='error' 행 수
 * - error_count: tool_detail에 'Error' 포함 OR tokens_confidence='error' 행 수 (합산)
 */
export interface ToolStats {
  tool_name: string;
  call_count: number;
  total_tokens: number;
  avg_tokens: number;
  avg_duration_ms: number;
  max_duration_ms: number;
  error_count: number;
  confidence_low_count: number;
  confidence_error_count: number;
}

export function getToolStats(
  db: Database,
  limit: number = 20,
  fromTs?: number,
  toTs?: number
): ToolStats[] {
  const conditions: string[] = ["type = 'tool_call'", 'tool_name IS NOT NULL', "(event_type IS NULL OR event_type = 'tool')"];
  const params: (number | string)[] = [];

  if (fromTs) { conditions.push('timestamp >= ?'); params.push(fromTs); }
  if (toTs) { conditions.push('timestamp <= ?'); params.push(toTs); }

  params.push(limit.toString());

  return db.query(`
    SELECT
      tool_name,
      COUNT(*) as call_count,
      COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_total ELSE 0 END), 0) as total_tokens,
      COALESCE(AVG(CASE WHEN tokens_confidence='high' THEN tokens_total ELSE NULL END), 0) as avg_tokens,
      COALESCE(AVG(CASE WHEN duration_ms > 0 THEN duration_ms ELSE NULL END), 0)  AS avg_duration_ms,
      COALESCE(MAX(duration_ms), 0)  AS max_duration_ms,
      SUM(CASE WHEN tool_detail LIKE '%Error%' OR tool_detail LIKE '%error%' OR tokens_confidence='error' THEN 1 ELSE 0 END) AS error_count,
      SUM(CASE WHEN tokens_confidence='low'   THEN 1 ELSE 0 END) AS confidence_low_count,
      SUM(CASE WHEN tokens_confidence='error' THEN 1 ELSE 0 END) AS confidence_error_count
    FROM requests
    WHERE ${conditions.join(' AND ')}
    GROUP BY tool_name
    ORDER BY call_count DESC
    LIMIT ?
  `).all(...params) as ToolStats[];
}

/**
 * 세션 범위 도구별 성능 통계 (Feature F: Tool Performance Summary)
 */
export interface SessionToolStats extends ToolStats {
  pct_of_total_tokens: number;
}

export function getSessionToolStats(
  db: Database,
  sessionId: string
): SessionToolStats[] {
  return db.query(`
    WITH session_total AS (
      SELECT COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_total ELSE 0 END), 1) AS total
      FROM requests
      WHERE session_id = ?
        AND (event_type IS NULL OR event_type = 'tool')
    )
    SELECT
      tool_name,
      COUNT(*) AS call_count,
      COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_total ELSE 0 END), 0) AS total_tokens,
      COALESCE(AVG(CASE WHEN tokens_confidence='high' THEN tokens_total ELSE NULL END), 0) AS avg_tokens,
      COALESCE(AVG(CASE WHEN duration_ms > 0 THEN duration_ms ELSE NULL END), 0)  AS avg_duration_ms,
      COALESCE(MAX(duration_ms), 0)  AS max_duration_ms,
      SUM(CASE WHEN tool_detail LIKE '%Error%' OR tool_detail LIKE '%error%' OR tokens_confidence='error' THEN 1 ELSE 0 END) AS error_count,
      SUM(CASE WHEN tokens_confidence='low'   THEN 1 ELSE 0 END) AS confidence_low_count,
      SUM(CASE WHEN tokens_confidence='error' THEN 1 ELSE 0 END) AS confidence_error_count,
      ROUND(COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_total ELSE 0 END), 0) * 100.0 / (SELECT total FROM session_total), 1) AS pct_of_total_tokens
    FROM requests
    WHERE session_id = ?
      AND type = 'tool_call'
      AND tool_name IS NOT NULL
      AND (event_type IS NULL OR event_type = 'tool')
    GROUP BY tool_name
    ORDER BY avg_duration_ms DESC
  `).all(sessionId, sessionId) as SessionToolStats[];
}

/**
 * 시간대별 요청 통계
 */
export interface HourlyStats {
  hour: number;
  request_count: number;
  total_tokens: number;
}

export function getHourlyRequestStats(
  db: Database,
  sessionId?: string
): HourlyStats[] {
  let sql = `
    SELECT
      (timestamp / 3600000 % 24) as hour,
      COUNT(*) as request_count,
      SUM(tokens_total) as total_tokens
    FROM requests
  `;
  const params: string[] = [];

  if (sessionId) {
    sql += ' WHERE session_id = ?';
    params.push(sessionId);
  }

  sql += ' GROUP BY hour ORDER BY hour';

  return db.query(sql).all(...params) as HourlyStats[];
}

// =============================================================================
// Command Center Strip 집계
// =============================================================================


/** Command Center Strip 통계 */
export interface StripStats {
  p95_duration_ms: number;
  error_rate: number;
}

/**
 * Command Center Strip 지표 집계 (P95 duration / 오류율)
 *
 * 비용(cost_usd / cache_savings_usd)은 정확한 가격 플랜을 알 수 없는 추정치라 제거됨.
 * 두 쿼리(p95 duration, error rate) 모두 동일한 timestamp 범위 조건을 적용한다.
 *
 * @param fromTs 집계 시작 타임스탬프 (옵셔널)
 * @param toTs   집계 종료 타임스탬프 (옵셔널)
 */
export function getStripStats(
  db: Database,
  fromTs?: number,
  toTs?: number
): StripStats {
  const buildRangeClause = (baseConditions: string[]): { sql: string; params: number[] } => {
    const conditions = [...baseConditions];
    const params: number[] = [];
    if (fromTs !== undefined) { conditions.push('timestamp >= ?'); params.push(fromTs); }
    if (toTs   !== undefined) { conditions.push('timestamp <= ?'); params.push(toTs); }
    return { sql: conditions.join(' AND '), params };
  };

  // 1. P95 duration_ms — 지정 기간 tool_call PostToolUse 레코드
  const durationRange = buildRangeClause([
    "type = 'tool_call'",
    "event_type = 'tool'",
    'duration_ms > 0',
  ]);
  const durationRows = db.query(`
    SELECT duration_ms
    FROM requests
    WHERE ${durationRange.sql}
    ORDER BY duration_ms ASC
  `).all(...durationRange.params) as Array<{ duration_ms: number }>;

  let p95_duration_ms = 0;
  if (durationRows.length > 0) {
    const idx = Math.ceil(durationRows.length * 0.95) - 1;
    p95_duration_ms = durationRows[Math.min(idx, durationRows.length - 1)].duration_ms;
  }

  // 2. 오류율 — 지정 기간 tool_call PostToolUse 레코드 중 오류 패턴 포함 비율
  const errorRange = buildRangeClause([
    "type = 'tool_call'",
    "event_type = 'tool'",
  ]);
  const errorStats = db.query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE
        WHEN tool_detail LIKE '%[오류]%' OR tool_detail LIKE '%error%'
        THEN 1 ELSE 0
      END) AS errors
    FROM requests
    WHERE ${errorRange.sql}
  `).get(...errorRange.params) as { total: number; errors: number };

  const error_rate =
    errorStats.total > 0 ? errorStats.errors / errorStats.total : 0;

  return {
    p95_duration_ms,
    error_rate: Math.round(error_rate * 10_000) / 10_000,
  };
}

// =============================================================================
// Cache Intelligence 집계
// =============================================================================

/** 캐시 히트율·절감 토큰 통계 (USD 환산은 신뢰도 낮아 제거됨) */
export interface CacheStats {
  hitRate: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** 캐시로 절감된 입력 토큰 수 (cache_read_tokens 합산과 동일) */
  savingsTokens: number;
  /** 캐시 히트로 절감된 비율 (0~1) */
  savingsRate: number;
}

/**
 * 캐시 히트율 및 절감 토큰 집계
 * - fromTs / toTs 미지정 시 전체 기간
 * - tokens_confidence='high'인 레코드만 집계
 *
 * USD 비용 환산은 정확한 가격 플랜을 알 수 없어 추정치만 가능하므로 제거됨.
 */
export function getCacheStats(
  db: Database,
  fromTs?: number,
  toTs?: number
): CacheStats {
  const conditions: string[] = ["type = 'prompt'"];
  const params: number[] = [];

  if (fromTs !== undefined) { conditions.push('timestamp >= ?'); params.push(fromTs); }
  if (toTs   !== undefined) { conditions.push('timestamp <= ?'); params.push(toTs); }

  const row = db.query(`
    SELECT
      COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_input ELSE 0 END), 0)            AS tokens_input,
      COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN cache_creation_tokens ELSE 0 END), 0)   AS cache_creation_tokens,
      COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN cache_read_tokens ELSE 0 END), 0)       AS cache_read_tokens
    FROM requests
    WHERE ${conditions.join(' AND ')}
  `).get(...params) as {
    tokens_input: number;
    cache_creation_tokens: number;
    cache_read_tokens: number;
  } | null;

  const totalCacheRead     = row?.cache_read_tokens ?? 0;
  const totalCacheCreation = row?.cache_creation_tokens ?? 0;
  const totalTokensInput   = row?.tokens_input ?? 0;

  const totalEffectiveInput = totalTokensInput + totalCacheRead;
  const hitRate = totalEffectiveInput > 0 ? totalCacheRead / totalEffectiveInput : 0;
  const savingsRate = totalEffectiveInput > 0 ? totalCacheRead / totalEffectiveInput : 0;

  return {
    hitRate: Math.round(hitRate * 10_000) / 10_000,
    cacheReadTokens: totalCacheRead,
    cacheCreationTokens: totalCacheCreation,
    savingsTokens: totalCacheRead,
    savingsRate: Math.round(savingsRate * 10_000) / 10_000,
  };
}

// =============================================================================
// P95 Duration 계산
// =============================================================================

/**
 * 현재 필터 기간 기준 tool_call P95 duration_ms 계산
 * - fromTs / toTs 미지정 시 전체 기간
 */
export function getP95DurationMs(
  db: Database,
  fromTs?: number,
  toTs?: number
): number {
  const conditions: string[] = [
    "type = 'tool_call'",
    "event_type = 'tool'",
    'duration_ms > 0',
  ];
  const params: number[] = [];

  if (fromTs !== undefined) { conditions.push('timestamp >= ?'); params.push(fromTs); }
  if (toTs   !== undefined) { conditions.push('timestamp <= ?'); params.push(toTs); }

  const rows = db.query(`
    SELECT duration_ms
    FROM requests
    WHERE ${conditions.join(' AND ')}
    ORDER BY duration_ms ASC
  `).all(...params) as Array<{ duration_ms: number }>;

  if (rows.length === 0) return 0;
  const idx = Math.ceil(rows.length * 0.95) - 1;
  return rows[Math.min(idx, rows.length - 1)].duration_ms;
}

// =============================================================================
// 턴 집계 (Turn View)
// =============================================================================
