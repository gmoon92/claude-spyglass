/**
 * turn_view 쿼리 헬퍼 — R3 단일 writer (projection-worker C).
 *
 * 책임:
 *  - upsertTurnView : 한 turn 의 집계 + payload_json 을 멱등 upsert.
 *  - getTurnViewBySession : 1쿼리로 모든 turn 회수 (기존 6쿼리 대체).
 *
 * @see packages/storage/migrations/044-turn-view.sql
 */

import type { Database } from 'bun:sqlite';

export interface TurnViewRow {
  session_id: string;
  turn_id: string;
  turn_index: number;
  started_at: number;
  ended_at: number | null;
  duration_ms: number | null;
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  cache_read: number;
  cache_creation: number;
  prompt_id: string | null;
  tool_call_count: number;
  response_count: number;
  error_count: number;
  status: string;
  has_error: number;
  payload_json: string | null;
  system_hash: string | null;
  system_byte_size: number | null;
  system_reminder: string | null;
  first_beta: string | null;
  source_event_id: number;
  schema_version: number;
  updated_at: number;
}

export interface UpsertTurnViewParams {
  session_id: string;
  turn_id: string;
  turn_index?: number;
  started_at: number;
  ended_at?: number | null;
  duration_ms?: number | null;
  tokens_input?: number;
  tokens_output?: number;
  tokens_total?: number;
  cache_read?: number;
  cache_creation?: number;
  prompt_id?: string | null;
  tool_call_count?: number;
  response_count?: number;
  error_count?: number;
  status?: string;
  has_error?: number;
  payload_json?: string | null;
  system_hash?: string | null;
  system_byte_size?: number | null;
  system_reminder?: string | null;
  first_beta?: string | null;
  source_event_id: number;
  updated_at?: number;
}

/**
 * turn_view 멱등 upsert.
 *
 * PK = (session_id, turn_id) → 같은 turn 재계산 시 REPLACE.
 */
export function upsertTurnView(db: Database, p: UpsertTurnViewParams): void {
  db.prepare(
    `INSERT OR REPLACE INTO turn_view (
       session_id, turn_id, turn_index, started_at, ended_at, duration_ms,
       tokens_input, tokens_output, tokens_total, cache_read, cache_creation,
       prompt_id, tool_call_count, response_count, error_count,
       status, has_error, payload_json,
       system_hash, system_byte_size, system_reminder, first_beta,
       source_event_id, schema_version, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  ).run(
    p.session_id,
    p.turn_id,
    p.turn_index ?? 0,
    p.started_at,
    p.ended_at ?? null,
    p.duration_ms ?? null,
    p.tokens_input ?? 0,
    p.tokens_output ?? 0,
    p.tokens_total ?? 0,
    p.cache_read ?? 0,
    p.cache_creation ?? 0,
    p.prompt_id ?? null,
    p.tool_call_count ?? 0,
    p.response_count ?? 0,
    p.error_count ?? 0,
    p.status ?? 'ok',
    p.has_error ?? 0,
    p.payload_json ?? null,
    p.system_hash ?? null,
    p.system_byte_size ?? null,
    p.system_reminder ?? null,
    p.first_beta ?? null,
    p.source_event_id,
    p.updated_at ?? Date.now(),
  );
}

/**
 * 세션 turn 전체 회수 — 1쿼리. (기존 getTurnsBySession 의 6쿼리 + 인메모리 join 대체)
 */
export function getTurnViewBySession(db: Database, sessionId: string): TurnViewRow[] {
  return db
    .query(
      `SELECT * FROM turn_view WHERE session_id = ? ORDER BY turn_index ASC, started_at ASC`
    )
    .all(sessionId) as TurnViewRow[];
}

/**
 * 행 수.
 */
export function countTurnView(db: Database): number {
  const row = db.query('SELECT COUNT(*) AS n FROM turn_view').get() as { n: number };
  return row.n;
}
