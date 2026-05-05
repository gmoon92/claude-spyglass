/**
 * Session 조회(Read) — 외부 호환 표면.
 *
 * # 책임
 *
 * `domain/session-status.ts`의 결과 함수에 위임하는 thin wrapper + 단순 단건 조회 등
 * 도메인 분류가 필요 없는 직접 조회.
 *
 * # 왜 thin wrapper인가
 *
 * "visible/LIVE 정의" SSoT가 도메인 모듈에 있어야 화면별 분기 재발이 차단된다 (3차례 회귀
 * 학습). 이 파일은 외부에서 import되는 시그니처를 보존하기 위한 호환층.
 *
 * 변경 이유: 시그니처 호환·단건 조회 정책이 바뀔 때만 수정.
 */

import type { Database } from 'bun:sqlite';
import type { SessionFilterOptions, SessionQueryResult } from './types';
import {
  listLiveSessions,
  listVisibleSessions,
} from '../../domain/session-status';

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
 * 모든 visible 세션 조회 — 도메인 함수(`listVisibleSessions`)에 위임.
 *
 * "visible 정의 SSoT가 한 곳" 원칙을 지키기 위해 SQL은 도메인 모듈이 보유한다.
 * 외부 시그니처는 호환성을 위해 그대로.
 */
export function getAllSessions(
  db: Database,
  limit: number = 100,
  fromTs?: number,
  toTs?: number,
  now: number = Date.now(),
): SessionQueryResult[] {
  return listVisibleSessions(db, limit, { fromTs, toTs }, now) as SessionQueryResult[];
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
 * 프로젝트별 visible 세션 조회 — 도메인 함수(`listVisibleSessions`)에 projectName 필터 적용.
 */
export function getSessionsByProject(
  db: Database,
  projectName: string,
  limit: number = 100,
  fromTs?: number,
  toTs?: number,
  now: number = Date.now(),
): SessionQueryResult[] {
  return listVisibleSessions(db, limit, { fromTs, toTs, projectName }, now) as SessionQueryResult[];
}

/**
 * LIVE 세션 조회 — 도메인 함수(`listLiveSessions`)에 위임.
 */
export function getActiveSessions(
  db: Database,
  now: number = Date.now(),
): SessionQueryResult[] {
  return listLiveSessions(db, now) as SessionQueryResult[];
}
