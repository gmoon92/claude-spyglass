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
 * 전체 요청 통계 — stats_hourly 사전 집계 기반 (stats-event-type-dim ADR-004)
 *
 * 데이터 소스 전환:
 *   - 이전: requests 직접 SUM/COUNT/AVG (풀스캔)
 *   - 현재: stats_hourly 시간 버킷 합산. event_type='tool' 필터로 기존 의미 보존.
 *
 * 회귀 0 보장 (ADR-003):
 *   - tokens_* 합계: stats_hourly의 tokens_*_high_sum 컬럼 사용 (high 필터 재현)
 *   - request_count: SUM(request_count) (필터링된 행만)
 *   - avg_tokens_per_request: tokens_total_high_sum / tokens_high_count
 *   - avg_duration_ms: duration_ms_sum / duration_ms_count (high 필터 미적용 — 기존과 동일)
 *
 * fromTs/toTs는 ms 단위, stats_hourly hour_ts는 sec 단위이므로 변환 필수.
 */
export function getRequestStats(db: Database, fromTs?: number, toTs?: number): RequestStats {
  // 원본 필터 `event_type IS NULL OR event_type='tool'`를 stats_hourly의 NULL→'' 정규화
  // 컨벤션에 맞춰 `event_type IN ('tool','')`로 재현. (stats-event-type-dim ADR-004)
  const conditions: string[] = ["event_type IN ('tool','')"];
  const params: number[] = [];

  if (fromTs) {
    conditions.push('hour_ts >= ?');
    params.push(Math.floor(fromTs / 1000 / 3600) * 3600);
  }
  if (toTs) {
    conditions.push('hour_ts <= ?');
    params.push(Math.floor(toTs / 1000 / 3600) * 3600);
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;
  const row = db.query(`
    SELECT
      COALESCE(SUM(request_count), 0)          AS total_requests,
      COALESCE(SUM(tokens_input_high_sum), 0)  AS total_tokens_input,
      COALESCE(SUM(tokens_output_high_sum), 0) AS total_tokens_output,
      COALESCE(SUM(tokens_total_high_sum), 0)  AS total_tokens,
      CASE WHEN SUM(tokens_high_count) > 0
           THEN CAST(SUM(tokens_total_high_sum) AS REAL) / SUM(tokens_high_count)
           ELSE 0 END                          AS avg_tokens_per_request,
      CASE WHEN SUM(duration_ms_count) > 0
           THEN CAST(SUM(duration_ms_sum) AS REAL) / SUM(duration_ms_count)
           ELSE 0 END                          AS avg_duration_ms
    FROM stats_hourly
    ${whereClause}
  `).get(...params) as RequestStats;
  return row;
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
 * 요청 타입별 통계 — stats_hourly 사전 집계 기반 (stats-event-type-dim ADR-004/006)
 *
 * 변경 사항:
 *   - 이전: requests 직접 GROUP BY type (pre_tool 미필터 — 잠재 버그)
 *   - 현재: stats_hourly GROUP BY type. stats_hourly 트리거가 pre_tool을 제외하므로
 *     ADR-006에 따라 잠재 버그가 자연 수정됨.
 *
 * 응답값 변화 (ADR-006):
 *   - pre_tool 행이 type='tool_call' count에서 제외됨 → 약간 감소
 *   - 이는 회귀가 아닌 버그 수정으로 분류
 */
export function getRequestStatsByType(db: Database, fromTs?: number, toTs?: number): TypeStats[] {
  const conditions: string[] = [];
  const params: number[] = [];

  if (fromTs) {
    conditions.push('hour_ts >= ?');
    params.push(Math.floor(fromTs / 1000 / 3600) * 3600);
  }
  if (toTs) {
    conditions.push('hour_ts <= ?');
    params.push(Math.floor(toTs / 1000 / 3600) * 3600);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  return db.query(`
    SELECT
      type,
      SUM(request_count) AS count,
      SUM(tokens_total)  AS total_tokens,
      CASE WHEN SUM(request_count) > 0
           THEN CAST(SUM(tokens_total) AS REAL) / SUM(request_count)
           ELSE 0 END    AS avg_tokens
    FROM stats_hourly
    ${whereClause}
    GROUP BY type
    ORDER BY total_tokens DESC
  `).all(...params) as TypeStats[];
}
