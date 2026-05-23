/**
 * outbox_pending 쿼리 헬퍼 — hook fast-path 비동기 처리 큐.
 *
 * 책임:
 *  - enqueue : 새 event_id 를 outbox 에 등록 (idempotent).
 *  - claim   : worker 가 미처리 batch 를 가져감 (claimed_at 표시).
 *  - done    : 처리 완료된 row DELETE.
 *  - release : worker crash 시 claim 해제 (stuck 복구).
 *
 * 의도:
 *  - hook 응답 측은 enqueue 후 즉시 반환 → ≤5ms.
 *  - background worker 가 claim → SSE broadcast / projection materialize → done.
 *
 * @see .claude/docs/plans/storage-redesign-v3/redesign-plan.md Phase 4-5
 * @see packages/storage/migrations/041-outbox-pending.sql
 */

import type { Database } from 'bun:sqlite';

export interface OutboxRow {
  id: number;
  event_id: string;
  enqueued_at: number;
  claimed_at: number | null;
  claim_token: string | null;
  retry_count: number;
  last_error: string | null;
}

/**
 * outbox_pending 에 새 event 등록 (idempotent — 같은 event_id 재호출 시 무시).
 *
 * @returns INSERT 됐으면 true, 이미 존재해서 무시됐으면 false.
 */
export function enqueueOutboxEvent(db: Database, eventId: string, now = Date.now()): boolean {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO outbox_pending (event_id, enqueued_at) VALUES (?, ?)
  `);
  const result = stmt.run(eventId, now);
  return result.changes > 0;
}

/**
 * 미처리 batch claim — worker tick 마다 호출.
 *
 * 동작:
 *  - claimed_at 이 NULL 인 행 중 가장 오래된 N개를 claim.
 *  - claimed_at = now(), claim_token = token 으로 마크.
 *  - claimed 된 행을 그대로 반환 (worker 가 처리할 대상).
 *
 * 트랜잭션 안에서 호출 권장 — UPDATE + SELECT 사이 race condition 회피.
 *
 * @param token  worker 세션 토큰 (debugging 용, crypto.randomUUID() 권장)
 * @param batchSize  한 batch 최대 행 수
 */
export function claimOutboxBatch(
  db: Database,
  token: string,
  batchSize: number,
  now = Date.now(),
): OutboxRow[] {
  // 가져갈 id 목록을 먼저 SELECT, 그 다음 UPDATE — bun:sqlite 는 UPDATE..RETURNING
  // 미지원이므로 두 step 으로 분리. tx 안에서 호출되면 race 없다.
  const ids = (db
    .query(
      `SELECT id FROM outbox_pending
       WHERE claimed_at IS NULL
       ORDER BY id ASC LIMIT ?`
    )
    .all(batchSize) as Array<{ id: number }>).map((r) => r.id);

  if (ids.length === 0) return [];

  const placeholders = ids.map(() => '?').join(',');
  db.prepare(
    `UPDATE outbox_pending
     SET claimed_at = ?, claim_token = ?
     WHERE id IN (${placeholders})`
  ).run(now, token, ...ids);

  return db
    .query(`SELECT * FROM outbox_pending WHERE id IN (${placeholders}) ORDER BY id ASC`)
    .all(...ids) as OutboxRow[];
}

/**
 * 처리 완료된 outbox row DELETE.
 *
 * worker 가 성공적으로 SSE broadcast + projection materialize 끝낸 후 호출.
 */
export function markOutboxDone(db: Database, ids: number[]): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(`DELETE FROM outbox_pending WHERE id IN (${placeholders})`).run(...ids);
  return result.changes;
}

/**
 * Claim 해제 — worker crash 또는 처리 실패 시 다음 tick 에서 재시도 가능하게.
 *
 * retry_count 증가 + last_error 기록. claimed_at = NULL 로 되돌림.
 */
export function releaseOutboxClaim(
  db: Database,
  ids: number[],
  error: string | null = null,
): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const result = db
    .prepare(
      `UPDATE outbox_pending
       SET claimed_at = NULL,
           claim_token = NULL,
           retry_count = retry_count + 1,
           last_error = ?
       WHERE id IN (${placeholders})`
    )
    .run(error, ...ids);
  return result.changes;
}

/**
 * stuck claim 복구 — 일정 시간 (예: 5분) 지나도 claim 상태인 row 를 release.
 *
 * 다른 worker 가 stuck 된 batch 를 다시 가져갈 수 있도록.
 *
 * @returns release 된 row 수
 */
export function releaseStuckClaims(db: Database, olderThanMs: number, now = Date.now()): number {
  const cutoff = now - olderThanMs;
  const result = db
    .prepare(
      `UPDATE outbox_pending
       SET claimed_at = NULL,
           claim_token = NULL,
           retry_count = retry_count + 1,
           last_error = 'reclaimed-after-stuck'
       WHERE claimed_at IS NOT NULL AND claimed_at < ?`
    )
    .run(cutoff);
  return result.changes;
}

/**
 * pending (미처리 + claim 중) 카운트 — 관측 / /api/projection-lag 응답용.
 */
export function countOutboxPending(db: Database): { available: number; claimed: number; total: number } {
  const row = db
    .query(
      `SELECT
         SUM(CASE WHEN claimed_at IS NULL THEN 1 ELSE 0 END) AS available,
         SUM(CASE WHEN claimed_at IS NOT NULL THEN 1 ELSE 0 END) AS claimed,
         COUNT(*) AS total
       FROM outbox_pending`
    )
    .get() as { available: number | null; claimed: number | null; total: number };
  return {
    available: row.available ?? 0,
    claimed: row.claimed ?? 0,
    total: row.total ?? 0,
  };
}
