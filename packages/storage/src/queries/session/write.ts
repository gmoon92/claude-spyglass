/**
 * Session 라이프사이클(Create/Update/Delete) 쿼리.
 *
 * 변경 이유: 세션 라이프사이클 정책(생성 시 INSERT OR IGNORE, 종료/재활성화/토큰
 * 갱신, 단건·다건 삭제, 단일 retention by started_at)이 바뀔 때 수정.
 *
 * 멀티테이블 GC(retention.ts의 deleteOldData)와는 변경 이유가 다르므로 분리.
 */

import type { Database } from 'bun:sqlite';
import type { CreateSessionParams, UpdateSessionParams } from './types';

// =============================================================================
// 생성 (Create)
// =============================================================================

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
// 수정 (Update)
// =============================================================================

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
 * 세션 재활성화 — ended_at을 NULL로 되돌림.
 * SessionEnd 후 동일 session_id로 SessionStart가 재발생할 때(compact/resume) 사용.
 */
export function reactivateSession(db: Database, id: string): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (db as any).run(
    'UPDATE sessions SET ended_at = NULL WHERE id = ? AND ended_at IS NOT NULL',
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
// 삭제 (Delete) — 단건·다건·단일 테이블 retention
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
