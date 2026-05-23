/**
 * events_v3 쿼리 헬퍼 — storage-redesign-v3 R1 SoT.
 *
 * 책임:
 *  - events_v3 INSERT (append-only 강제: INSERT OR IGNORE + 트리거 차단).
 *  - projection worker 용 watermark 기반 배치 fetch.
 *
 * 절대 추가하지 말 것:
 *  - UPDATE / DELETE 헬퍼 — schema 레벨 트리거가 차단한다 (trg_events_v3_no_update,
 *    trg_events_v3_no_delete). application 우회는 R1 위반.
 *
 * @see .claude/docs/plans/storage-redesign-v3/redesign-plan.md
 * @see packages/storage/migrations/040-events-v3.sql
 */

import type { Database } from 'bun:sqlite';

/**
 * events_v3 한 row 의 application-side shape.
 *
 * id 는 INTEGER AUTOINCREMENT — INSERT 후 lastInsertRowid 로 회수.
 * event_id 는 application 이 생성하는 idempotent key (hook payload.id 와 동일 권장).
 */
export interface EventV3Row {
  id?: number;
  event_id: string;
  session_id: string;
  turn_id?: string | null;
  timestamp: number;                                              // ms epoch
  event_kind: EventKind;
  tool_use_id?: string | null;
  parent_tool_use_id?: string | null;
  agent_id?: string | null;
  agent_type?: string | null;
  tool_name?: string | null;
  model?: string | null;
  payload_json: string;                                           // JSON string
  source?: string | null;
  schema_version?: number;
  created_at?: number;
}

/** event_kind 열거형. 새 종류 추가 시 본 union 갱신. */
export type EventKind =
  | 'hook_pre_tool'
  | 'hook_post_tool'
  | 'hook_prompt'
  | 'hook_response'
  | 'hook_system'
  | 'hook_session_start'
  | 'hook_session_end'
  | 'hook_notification'
  | 'hook_user_prompt_submit'
  | 'hook_stop'
  | 'hook_subagent_stop'
  | 'hook_pre_compact';

/**
 * events_v3 에 한 row INSERT.
 *
 * 동작:
 *  - INSERT OR IGNORE → event_id 중복이면 silent skip (hook 재전송 idempotent).
 *  - 성공 시 lastInsertRowid 반환, 중복 무시 시 null 반환.
 *
 * 호출자 (예정):
 *  - hook/processor.ts: dual-write (legacy saveRequest + appendEventV3).
 *  - replay 스크립트 (claude_events → events_v3 backfill).
 */
export function appendEventV3(db: Database, event: EventV3Row): number | null {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO events_v3 (
      event_id, session_id, turn_id, timestamp, event_kind,
      tool_use_id, parent_tool_use_id, agent_id, agent_type,
      tool_name, model, payload_json, source, schema_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // bun:sqlite 의 .run() 결과는 { changes, lastInsertRowid: number | bigint }
  const result = stmt.run(
    event.event_id,
    event.session_id,
    event.turn_id ?? null,
    event.timestamp,
    event.event_kind,
    event.tool_use_id ?? null,
    event.parent_tool_use_id ?? null,
    event.agent_id ?? null,
    event.agent_type ?? null,
    event.tool_name ?? null,
    event.model ?? null,
    event.payload_json,
    event.source ?? 'hook',
    event.schema_version ?? 1,
  );
  if (result.changes === 0) return null;
  return Number(result.lastInsertRowid);
}

/**
 * watermark 이후 events_v3 배치 fetch — projection worker 가 호출.
 *
 * `WHERE id > ? ORDER BY id LIMIT ?` — idx_events_v3_id_asc 활용.
 *
 * @param afterId  지금까지 처리한 events_v3.id (projection_state.last_event_id)
 * @param limit    배치 크기 (worker tick 당 처리량 제한)
 */
export function getEventsAfter(db: Database, afterId: number, limit = 500): EventV3Row[] {
  return db
    .query(
      `SELECT * FROM events_v3 WHERE id > ? ORDER BY id ASC LIMIT ?`
    )
    .all(afterId, limit) as EventV3Row[];
}

/**
 * 최대 events_v3.id 조회 — lag 계산용.
 *
 * @returns 테이블 빔 → 0
 */
export function getMaxEventId(db: Database): number {
  const row = db
    .query('SELECT COALESCE(MAX(id), 0) AS max_id FROM events_v3')
    .get() as { max_id: number };
  return row.max_id;
}

/**
 * 단일 event 조회 (debugging / re-projection 용).
 */
export function getEventByEventId(db: Database, eventId: string): EventV3Row | null {
  return (
    (db
      .query('SELECT * FROM events_v3 WHERE event_id = ? LIMIT 1')
      .get(eventId) as EventV3Row | null) ?? null
  );
}

/**
 * 세션 범위 events 카운트 (관측용).
 */
export function countEventsBySession(db: Database, sessionId: string): number {
  const row = db
    .query('SELECT COUNT(*) AS n FROM events_v3 WHERE session_id = ?')
    .get(sessionId) as { n: number };
  return row.n;
}
