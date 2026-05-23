/**
 * request_view 쿼리 헬퍼 — R3 단일 writer (projection-worker B).
 *
 * 책임:
 *  - upsertRequestView : worker 가 events_v3 row 를 변환해 본 테이블에 멱등 upsert.
 *  - getRequestViewBySession / getRecentRequestView : read API base.
 *
 * 절대 추가하지 말 것:
 *  - 본 테이블에 INSERT/UPDATE 하는 다른 writer. R3 위반.
 *
 * @see packages/storage/migrations/043-request-view.sql
 */

import type { Database } from 'bun:sqlite';

export interface RequestViewRow {
  id: string;
  session_id: string;
  turn_id: string | null;
  timestamp: number;
  type: string;
  status: string;
  tool_name: string | null;
  tool_detail: string | null;
  tool_use_id: string | null;
  parent_tool_use_id: string | null;
  sub_type: string | null;
  trust_level: string | null;
  model: string | null;
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  duration_ms: number;
  agent_id: string | null;
  agent_type: string | null;
  permission_mode: string | null;
  flags_json: string | null;
  source_event_id: number;
  schema_version: number;
  updated_at: number;
}

export interface UpsertRequestViewParams {
  id: string;
  session_id: string;
  turn_id?: string | null;
  timestamp: number;
  type: string;
  status?: string;
  tool_name?: string | null;
  tool_detail?: string | null;
  tool_use_id?: string | null;
  parent_tool_use_id?: string | null;
  sub_type?: string | null;
  trust_level?: string | null;
  model?: string | null;
  tokens_input?: number;
  tokens_output?: number;
  tokens_total?: number;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
  duration_ms?: number;
  agent_id?: string | null;
  agent_type?: string | null;
  permission_mode?: string | null;
  flags_json?: string | null;
  source_event_id: number;
  updated_at?: number;
}

/**
 * request_view 멱등 upsert (R3 단일 writer 전용).
 *
 * - PK = id → 같은 id 재호출 시 REPLACE.
 * - source_event_id 가 더 최신이면 덮어쓰기 → worker 재실행 안전.
 */
export function upsertRequestView(db: Database, p: UpsertRequestViewParams): void {
  db.prepare(
    `INSERT OR REPLACE INTO request_view (
       id, session_id, turn_id, timestamp, type, status,
       tool_name, tool_detail, tool_use_id, parent_tool_use_id,
       sub_type, trust_level, model,
       tokens_input, tokens_output, tokens_total,
       cache_creation_tokens, cache_read_tokens, duration_ms,
       agent_id, agent_type, permission_mode,
       flags_json, source_event_id, schema_version, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  ).run(
    p.id,
    p.session_id,
    p.turn_id ?? null,
    p.timestamp,
    p.type,
    p.status ?? 'ok',
    p.tool_name ?? null,
    p.tool_detail ?? null,
    p.tool_use_id ?? null,
    p.parent_tool_use_id ?? null,
    p.sub_type ?? null,
    p.trust_level ?? null,
    p.model ?? null,
    p.tokens_input ?? 0,
    p.tokens_output ?? 0,
    p.tokens_total ?? 0,
    p.cache_creation_tokens ?? 0,
    p.cache_read_tokens ?? 0,
    p.duration_ms ?? 0,
    p.agent_id ?? null,
    p.agent_type ?? null,
    p.permission_mode ?? null,
    p.flags_json ?? null,
    p.source_event_id,
    p.updated_at ?? Date.now(),
  );
}

/**
 * 세션 범위 read — 로그 피드용. JOIN / WITH RECURSIVE / normalize 없음.
 */
export function getRequestViewBySession(
  db: Database,
  sessionId: string,
  limit = 200,
): RequestViewRow[] {
  return db
    .query(
      `SELECT * FROM request_view
       WHERE session_id = ?
       ORDER BY timestamp DESC LIMIT ?`
    )
    .all(sessionId, limit) as RequestViewRow[];
}

/**
 * 글로벌 최근 N 행 — 메인 피드.
 */
export function getRecentRequestView(db: Database, limit = 200): RequestViewRow[] {
  return db
    .query(`SELECT * FROM request_view ORDER BY timestamp DESC LIMIT ?`)
    .all(limit) as RequestViewRow[];
}

/**
 * 행 수 (관측 / lag 표시용).
 */
export function countRequestView(db: Database): number {
  const row = db.query('SELECT COUNT(*) AS n FROM request_view').get() as { n: number };
  return row.n;
}
