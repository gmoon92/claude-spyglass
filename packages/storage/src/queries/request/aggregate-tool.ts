/**
 * Request 도구 통계 — Feature F: Tool Performance Summary.
 *
 * @description
 *   srp-redesign Phase 10: aggregate.ts(453줄)를 UI 도메인별로 분해.
 *   이 파일의 변경 이유: "도구 성능 지표 정의 변경 (call_count, error_count, confidence 등)".
 *
 *   타입: ToolStats / SessionToolStats
 *   함수: getToolStats / getSessionToolStats
 *
 *   데이터 신뢰도 표지 필드 (data-honesty-ui):
 *   - confidence_low_count: tokens_confidence='low' 행 수
 *   - confidence_error_count: tokens_confidence='error' 행 수
 *   - error_count: tool_detail에 'Error' 포함 OR tokens_confidence='error' 행 수 (합산)
 */

import type { Database } from 'bun:sqlite';

/** 도구별 통계 (tool_call 타입만, tool_name 단위 집계) */
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

/** 세션 범위 도구별 성능 통계 (Feature F: Tool Performance Summary) */
export interface SessionToolStats extends ToolStats {
  pct_of_total_tokens: number;
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
