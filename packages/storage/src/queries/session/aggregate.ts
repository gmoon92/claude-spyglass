/**
 * Session 집계(Aggregate) 쿼리.
 *
 * 변경 이유: 통계 정의(평균/합계 컬럼, 활성 세션 카운트 기준, 프로젝트 정렬 기준)
 * 가 바뀔 때 수정.
 */

import type { Database } from 'bun:sqlite';
import type { ProjectStats, SessionStats } from './types';

/**
 * 전체 세션 통계
 */
export function getSessionStats(db: Database, fromTs?: number, toTs?: number): SessionStats {
  const conditions: string[] = [];
  const params: number[] = [];

  if (fromTs) { conditions.push('started_at >= ?'); params.push(fromTs); }
  if (toTs) { conditions.push('started_at <= ?'); params.push(toTs); }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = db.query(`
    SELECT
      COUNT(*) as total_sessions,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COALESCE(AVG(total_tokens), 0) as avg_tokens_per_session,
      COUNT(CASE WHEN ended_at IS NULL THEN 1 END) as active_sessions
    FROM sessions
    ${whereClause}
  `).get(...params) as SessionStats;

  return result;
}

/**
 * 프로젝트별 세션 통계
 */
export function getProjectStats(
  db: Database,
  limit: number = 10,
  fromTs?: number,
  toTs?: number
): ProjectStats[] {
  const conditions: string[] = [];
  const params: (number | string)[] = [];

  if (fromTs) { conditions.push('started_at >= ?'); params.push(fromTs); }
  if (toTs) { conditions.push('started_at <= ?'); params.push(toTs); }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit.toString());

  return db.query(`
    SELECT
      project_name,
      COUNT(*) as session_count,
      SUM(total_tokens) as total_tokens
    FROM sessions
    ${whereClause}
    GROUP BY project_name
    ORDER BY total_tokens DESC
    LIMIT ?
  `).all(...params) as ProjectStats[];
}
