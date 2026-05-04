/**
 * Request Command Center Strip 통계 — P95 duration + 오류율 합성.
 *
 * @description
 *   srp-redesign Phase 10: aggregate.ts(453줄)를 UI 도메인별로 분해.
 *   이 파일의 변경 이유: "Command Center Strip 노출 지표 변경".
 *
 *   타입: StripStats
 *   함수: getStripStats
 *
 *   비용(cost_usd / cache_savings_usd)은 정확한 가격 플랜을 알 수 없는 추정치라 제거됨.
 *   P95 계산은 aggregate-latency.ts의 computeP95 헬퍼를 재사용해 중복 제거.
 */

import type { Database } from 'bun:sqlite';
import { computeP95 } from './aggregate-latency';

/** Command Center Strip 통계 */
export interface StripStats {
  p95_duration_ms: number;
  error_rate: number;
}

/**
 * Command Center Strip 지표 집계 (P95 duration / 오류율)
 *
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

  const p95_duration_ms = computeP95(durationRows);

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
