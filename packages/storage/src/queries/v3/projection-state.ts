/**
 * projection_state 쿼리 헬퍼 — watermark SSoT.
 *
 * 책임:
 *  - R3 단일 writer: 한 projection 은 자기 row 만 UPDATE.
 *  - /api/projection-lag (Phase 6) 응답 base.
 *  - R5 격리: 한 projection 실패가 다른 projection 또는 SSE 를 막지 않음.
 *
 * @see packages/storage/migrations/042-projection-state.sql
 */

import type { Database } from 'bun:sqlite';

export interface ProjectionStateRow {
  projection_name: string;
  last_event_id: number;
  last_advanced_at: number;
  total_processed: number;
  last_error: string | null;
  last_error_at: number | null;
  schema_version: number;
}

/** 등록된 모든 projection 행 조회 — /api/projection-lag 응답 source. */
export function getAllProjectionState(db: Database): ProjectionStateRow[] {
  return db
    .query('SELECT * FROM projection_state ORDER BY projection_name')
    .all() as ProjectionStateRow[];
}

/** 단일 projection 행 조회 — worker tick 진입 시점에 last_event_id 회수. */
export function getProjectionState(db: Database, name: string): ProjectionStateRow | null {
  return (
    (db
      .query('SELECT * FROM projection_state WHERE projection_name = ? LIMIT 1')
      .get(name) as ProjectionStateRow | null) ?? null
  );
}

/**
 * watermark advance — projection worker 가 한 batch 처리 끝낸 후 호출.
 *
 * 행이 없으면 INSERT (worker 가 신규 projection 을 자체 등록 가능).
 * 행이 있으면 UPDATE — last_event_id 와 last_advanced_at 만 갱신.
 * last_error 는 명시적 clear: success 호출 시 last_error / last_error_at 모두 NULL.
 */
export function advanceWatermark(
  db: Database,
  name: string,
  lastEventId: number,
  processedDelta: number,
  now = Date.now(),
): void {
  const existing = db
    .query('SELECT projection_name FROM projection_state WHERE projection_name = ?')
    .get(name);
  if (!existing) {
    db.prepare(
      `INSERT INTO projection_state
        (projection_name, last_event_id, last_advanced_at, total_processed, last_error, last_error_at)
       VALUES (?, ?, ?, ?, NULL, NULL)`
    ).run(name, lastEventId, now, processedDelta);
    return;
  }
  db.prepare(
    `UPDATE projection_state
     SET last_event_id   = ?,
         last_advanced_at = ?,
         total_processed = total_processed + ?,
         last_error      = NULL,
         last_error_at   = NULL
     WHERE projection_name = ?`
  ).run(lastEventId, now, processedDelta, name);
}

/**
 * projection 실패 기록 — watermark 는 advance 하지 않고, last_error 만 마크.
 *
 * 다음 tick 에서 같은 watermark 부터 재시도. R5 격리: 본 row 의 error 가
 * 다른 projection 의 advance 를 막지 않는다.
 */
export function recordProjectionError(
  db: Database,
  name: string,
  error: string,
  now = Date.now(),
): void {
  const existing = db
    .query('SELECT projection_name FROM projection_state WHERE projection_name = ?')
    .get(name);
  if (!existing) {
    db.prepare(
      `INSERT INTO projection_state
        (projection_name, last_event_id, last_advanced_at, last_error, last_error_at)
       VALUES (?, 0, 0, ?, ?)`
    ).run(name, error, now);
    return;
  }
  db.prepare(
    `UPDATE projection_state
     SET last_error = ?, last_error_at = ?
     WHERE projection_name = ?`
  ).run(error, now, name);
}
