/**
 * Session 조회(Read) 쿼리.
 *
 * 변경 이유: 세션 조회 정책(빈 세션 hide, 정렬 우선순위, 첫 prompt payload 포함 등)
 * 이 바뀔 때 수정.
 */

import type { Database } from 'bun:sqlite';
import type { SessionFilterOptions, SessionQueryResult } from './types';
import { ACTIVE_SESSION_REQUEST_JOIN_SQL } from './_shared';

/**
 * 세션 단건 조회 (ID 기준)
 */
export function getSessionById(
  db: Database,
  id: string
): SessionQueryResult | null {
  return db.query('SELECT * FROM sessions WHERE id = ?').get(id) as SessionQueryResult | null;
}

/**
 * 모든 세션 조회 (최근순, first_prompt_payload 포함, 날짜 필터 지원)
 *
 * 개선:
 *  - LEFT JOIN + GROUP BY로 N+1 쿼리 제거
 *  - v22: HAVING last_activity_at IS NOT NULL — requests가 0건인 빈 세션 hide
 *    (사용자가 데이터 삭제·정리한 뒤 sessions 테이블에만 남은 잔존 행이 사이드바에
 *     노이즈로 노출되던 문제 해결. 활성 세션은 첫 hook 도달 시 last_activity_at이 채워지므로
 *     영향 없음.)
 */
export function getAllSessions(
  db: Database,
  limit: number = 100,
  fromTs?: number,
  toTs?: number
): SessionQueryResult[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (fromTs) { conditions.push('s.started_at >= ?'); params.push(fromTs); }
  if (toTs)   { conditions.push('s.started_at <= ?'); params.push(toTs); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  return db.query(`
    SELECT s.*,
      (SELECT r.payload FROM requests r
       WHERE r.session_id = s.id AND r.type = 'prompt'
       ORDER BY r.timestamp ASC LIMIT 1) as first_prompt_payload,
      MAX(r.timestamp) as last_activity_at
    FROM sessions s
    ${ACTIVE_SESSION_REQUEST_JOIN_SQL}
    ${where}
    GROUP BY s.id
    HAVING last_activity_at IS NOT NULL
    ORDER BY (s.ended_at IS NULL) DESC, COALESCE(MAX(r.timestamp), s.started_at) DESC
    LIMIT ?
  `).all(...params, limit) as SessionQueryResult[];
}

/**
 * 필터링된 세션 조회
 */
export function getSessionsWithFilter(
  db: Database,
  options: SessionFilterOptions = {}
): SessionQueryResult[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (options.project_name) {
    conditions.push('project_name = ?');
    params.push(options.project_name);
  }
  if (options.started_after) {
    conditions.push('started_at >= ?');
    params.push(options.started_after);
  }
  if (options.started_before) {
    conditions.push('started_at <= ?');
    params.push(options.started_before);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitClause = options.limit ? `LIMIT ${options.limit}` : 'LIMIT 100';
  const offsetClause = options.offset ? `OFFSET ${options.offset}` : '';

  const sql = `SELECT * FROM sessions ${whereClause} ORDER BY started_at DESC ${limitClause} ${offsetClause}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return db.query(sql).all(...params as any[]) as SessionQueryResult[];
}

/**
 * 프로젝트별 세션 조회
 * 개선: LEFT JOIN + GROUP BY로 N+1 쿼리 제거
 */
export function getSessionsByProject(
  db: Database,
  projectName: string,
  limit: number = 100,
  fromTs?: number,
  toTs?: number
): SessionQueryResult[] {
  const conditions: string[] = ['s.project_name = ?'];
  const params: (string | number)[] = [projectName];

  if (fromTs) { conditions.push('s.started_at >= ?'); params.push(fromTs); }
  if (toTs) { conditions.push('s.started_at <= ?'); params.push(toTs); }

  params.push(limit.toString());

  return db.query(`
    SELECT s.*,
      (SELECT r.payload FROM requests r
       WHERE r.session_id = s.id AND r.type = 'prompt'
       ORDER BY r.timestamp ASC LIMIT 1) as first_prompt_payload,
      MAX(r.timestamp) as last_activity_at
    FROM sessions s
    ${ACTIVE_SESSION_REQUEST_JOIN_SQL}
    WHERE ${conditions.join(' AND ')}
    GROUP BY s.id
    HAVING last_activity_at IS NOT NULL
    ORDER BY (s.ended_at IS NULL) DESC, COALESCE(MAX(r.timestamp), s.started_at) DESC
    LIMIT ?
  `).all(...params) as SessionQueryResult[];
}

/**
 * 활성 세션 조회 (ended_at이 NULL인 세션)
 */
export function getActiveSessions(
  db: Database
): SessionQueryResult[] {
  return db.query('SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC')
    .all() as SessionQueryResult[];
}
