/**
 * Session CRUD Operations
 *
 * @description Session 테이블 생성/조회/수정/삭제 및 집계 쿼리
 */

import type { Database } from 'bun:sqlite';
import type { Session } from '../schema';

// =============================================================================
// 생성 (Create)
// =============================================================================

/** 세션 생성 파라미터 */
export interface CreateSessionParams {
  id: string;
  project_name: string;
  started_at: number;
  total_tokens?: number;
}

/** 세션 생성 SQL (중복 session_id는 무시 — 재시작/동시 요청 안전) */
const SQL_CREATE_SESSION = `
  INSERT OR IGNORE INTO sessions (id, project_name, started_at, total_tokens)
  VALUES (?, ?, ?, ?)
`;

/**
 * 새 세션 생성
 * @returns 생성된 세션 ID
 */
export function createSession(
  db: Database,
  params: CreateSessionParams
): string {
  const stmt = db.prepare(SQL_CREATE_SESSION);
  stmt.run(
    params.id,
    params.project_name,
    params.started_at,
    params.total_tokens ?? 0
  );
  return params.id;
}

/**
 * 여러 세션 일괄 생성
 */
export function createSessions(
  db: Database,
  sessions: CreateSessionParams[]
): string[] {
  const stmt = db.prepare(SQL_CREATE_SESSION);
  const insert = db.transaction((items: CreateSessionParams[]) => {
    for (const item of items) {
      stmt.run(item.id, item.project_name, item.started_at, item.total_tokens ?? 0);
    }
  });
  insert(sessions);
  return sessions.map(s => s.id);
}

// =============================================================================
// 조회 (Read)
// =============================================================================

/** 세션 조회 결과 */
export interface SessionQueryResult extends Session {}

/** 세션 필터 옵션 */
export interface SessionFilterOptions {
  project_name?: string;
  started_after?: number;
  started_before?: number;
  limit?: number;
  offset?: number;
}

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
      (SELECT MAX(r.timestamp) FROM requests r WHERE r.session_id = s.id) as last_activity_at
    FROM sessions s
    ${where}
    ORDER BY (s.ended_at IS NULL) DESC, last_activity_at DESC, s.started_at DESC
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
      (SELECT MAX(r.timestamp) FROM requests r WHERE r.session_id = s.id) as last_activity_at
    FROM sessions s
    WHERE ${conditions.join(' AND ')}
    ORDER BY (s.ended_at IS NULL) DESC, last_activity_at DESC, s.started_at DESC
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

// =============================================================================
// 수정 (Update)
// =============================================================================

/** 세션 업데이트 파라미터 */
export interface UpdateSessionParams {
  ended_at?: number;
  total_tokens?: number;
}

/**
 * 세션 업데이트
 */
export function updateSession(
  db: Database,
  id: string,
  params: UpdateSessionParams
): boolean {
  const fields: string[] = [];
  const values: (number | string)[] = [];

  if (params.ended_at !== undefined) {
    fields.push('ended_at = ?');
    values.push(params.ended_at);
  }
  if (params.total_tokens !== undefined) {
    fields.push('total_tokens = ?');
    values.push(params.total_tokens);
  }

  if (fields.length === 0) return false;

  values.push(id);
  const sql = `UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = db.run(sql, ...values as any[]);
  return result.changes > 0;
}

/**
 * 세션 종료 처리
 */
export function endSession(
  db: Database,
  id: string,
  endedAt: number = Date.now()
): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (db as any).run(
    'UPDATE sessions SET ended_at = ? WHERE id = ?',
    endedAt,
    id
  );
  return result.changes > 0;
}

/**
 * 세션 토큰 수 업데이트
 */
export function updateSessionTokens(
  db: Database,
  id: string,
  totalTokens: number
): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (db as any).run(
    'UPDATE sessions SET total_tokens = ? WHERE id = ?',
    totalTokens,
    id
  );
  return result.changes > 0;
}

// =============================================================================
// 삭제 (Delete)
// =============================================================================

/**
 * 세션 삭제 (연관된 requests도 CASCADE로 삭제됨)
 */
export function deleteSession(db: Database, id: string): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (db as any).run('DELETE FROM sessions WHERE id = ?', id);
  return result.changes > 0;
}

/**
 * 여러 세션 일괄 삭제
 */
export function deleteSessions(db: Database, ids: string[]): number {
  const placeholders = ids.map(() => '?').join(',');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = db.run(`DELETE FROM sessions WHERE id IN (${placeholders})`, ...ids as any[]);
  return result.changes;
}

/**
 * 오래된 세션 삭제 (보관 기간 기준)
 */
export function deleteOldSessions(
  db: Database,
  beforeTimestamp: number
): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (db as any).run(
    'DELETE FROM sessions WHERE started_at < ?',
    beforeTimestamp
  );
  return result.changes;
}

// =============================================================================
// 집계 (Aggregate)
// =============================================================================

/** 세션 통계 결과 */
export interface SessionStats {
  total_sessions: number;
  total_tokens: number;
  avg_tokens_per_session: number;
  active_sessions: number;
}

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
export interface ProjectStats {
  project_name: string;
  session_count: number;
  total_tokens: number;
}

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
