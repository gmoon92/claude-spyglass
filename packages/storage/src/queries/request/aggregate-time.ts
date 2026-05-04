/**
 * Request 시계열 통계 — 히트맵/선그래프용.
 *
 * @description
 *   srp-redesign Phase 10: aggregate.ts(453줄)를 UI 도메인별로 분해.
 *   이 파일의 변경 이유: "시간대 분해/그룹핑 정책 변경 (시·일·주 단위 등)".
 *
 *   타입: HourlyStats
 *   함수: getHourlyRequestStats
 */

import type { Database } from 'bun:sqlite';

/** 시간대별 요청 통계 */
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
