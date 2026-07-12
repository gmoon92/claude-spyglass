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
import { loadArchivedRequestRows } from './read';

/**
 * tool_detail 오류 패턴 JS 미러 — getStripStats의 SQL LIKE 4종(error/[오류]/エラー/错误)을 archive
 * 원행에 동일 적용(다국어 오류 표기). SQL 표현과 나란히 관리(정책 변경 시 함께 수정).
 */
function isToolError(toolDetail?: string | null): boolean {
  if (!toolDetail) return false;
  return (
    toolDetail.toLowerCase().includes('error') ||
    toolDetail.includes('[오류]') ||
    toolDetail.includes('エラー') ||
    toolDetail.includes('错误')
  );
}

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
  `).all(...durationRange.params) as Array<{ duration_ms: number }>;

  // Hot + Archive duration 합쳐 정렬 후 P95(비가법 — 전체 표본 필요). archive 원행은 동일 필터 재현.
  const durations = [
    ...durationRows.map((r) => r.duration_ms),
    ...loadArchivedRequestRows(db, { fromTs, toTs })
      .filter((r) => r.type === 'tool_call' && r.event_type === 'tool' && r.duration_ms != null && r.duration_ms > 0)
      .map((r) => r.duration_ms),
  ].sort((a, b) => a - b);
  const p95_duration_ms = computeP95(durations.map((duration_ms) => ({ duration_ms })));

  // 2. 오류율 — 지정 기간 tool_call PostToolUse 레코드 중 오류 패턴 포함 비율
  const errorRange = buildRangeClause([
    "type = 'tool_call'",
    "event_type = 'tool'",
  ]);
  const errorStats = db.query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE
        WHEN LOWER(tool_detail) LIKE '%error%'
           OR tool_detail LIKE '%[오류]%'
           OR tool_detail LIKE '%エラー%'
           OR tool_detail LIKE '%错误%'
        THEN 1 ELSE 0
      END) AS errors
    FROM requests
    WHERE ${errorRange.sql}
  `).get(...errorRange.params) as { total: number; errors: number };

  // Archive 구간 오류율 병합 — 동일 필터(tool_call/tool) + tool_detail 오류 패턴 JS 미러.
  let total = errorStats.total;
  let errors = errorStats.errors;
  for (const r of loadArchivedRequestRows(db, { fromTs, toTs })) {
    if (r.type !== 'tool_call' || r.event_type !== 'tool') continue;
    total++;
    if (isToolError(r.tool_detail)) errors++;
  }

  const error_rate = total > 0 ? errors / total : 0;

  return {
    p95_duration_ms,
    error_rate: Math.round(error_rate * 10_000) / 10_000,
  };
}
