/**
 * Request 일반 통계 — 헤더/요약 카드용.
 *
 * @description
 *   srp-redesign Phase 10: aggregate.ts(453줄)를 UI 도메인별로 분해.
 *   이 파일의 변경 이유: "헤더/요약 카드의 지표 정의 변경".
 *
 *   타입: RequestStats / TypeStats
 *   함수: getRequestStats / getRequestStatsBySession / getRequestStatsByType
 *
 *   집계 정책: 토큰 합계는 tokens_confidence='high'인 레코드만 집계.
 */

import type { Database } from 'bun:sqlite';
import type { RequestType } from '../../schema';

/** 요청 통계 결과 */
export interface RequestStats {
  total_requests: number;
  total_tokens_input: number;
  total_tokens_output: number;
  total_tokens: number;
  avg_tokens_per_request: number;
  avg_duration_ms: number;
}

/** 타입별 통계 */
export interface TypeStats {
  type: RequestType;
  count: number;
  total_tokens: number;
  avg_tokens: number;
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
