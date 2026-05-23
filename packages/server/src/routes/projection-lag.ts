/**
 * /api/projection-lag — projection 신선도(lag) 노출.
 *
 * 책임:
 *  - 각 projection 의 (last_event_id, max_event_id, lag_ms, error) 를 반환.
 *  - UI freshnessIndicatorHtml(meta) 가 polling 해 🟢🟡🟠🔴 4단계 표시.
 *
 * 응답 contract (SSoT — 클라이언트가 본 구조에 의존):
 *  {
 *    success: true,
 *    data: {
 *      now_ms: number,
 *      max_event_id: number,
 *      outbox: { available: number, claimed: number, total: number },
 *      projections: [{
 *        name: string,
 *        last_event_id: number,
 *        pending: number,                // max_event_id - last_event_id
 *        lag_ms: number,                 // now - last_advanced_at
 *        total_processed: number,
 *        last_error: string | null,
 *        last_error_at: number | null,
 *      }, ...]
 *    }
 *  }
 *
 * @see .claude/docs/plans/storage-redesign-v3/redesign-plan.md Phase 6
 */

import type { RouteHandler } from './_shared';
import { jsonResponse } from './_shared';
import {
  getAllProjectionState,
  getMaxEventId,
  countOutboxPending,
} from '@spyglass/storage';

export const projectionLagRouter: RouteHandler = (_req, db, _url, path, method) => {
  if (path !== '/api/projection-lag' || method !== 'GET') return null;

  const now = Date.now();
  const maxEventId = getMaxEventId(db);
  const outbox = countOutboxPending(db);
  const states = getAllProjectionState(db);

  const projections = states.map((s) => ({
    name: s.projection_name,
    last_event_id: s.last_event_id,
    pending: Math.max(0, maxEventId - s.last_event_id),
    // last_advanced_at = 0 이면 한 번도 advance 안 한 상태 — lag_ms 는 0 으로 보고 (UI 측 'fresh' 처리)
    lag_ms: s.last_advanced_at === 0 ? 0 : Math.max(0, now - s.last_advanced_at),
    total_processed: s.total_processed,
    last_error: s.last_error,
    last_error_at: s.last_error_at,
  }));

  return jsonResponse({
    success: true,
    data: {
      now_ms: now,
      max_event_id: maxEventId,
      outbox,
      projections,
    },
  });
};
