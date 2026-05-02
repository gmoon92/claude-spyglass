/**
 * proxy 모듈 — hook 측 model NULL 행 backfill (v19)
 *
 * 책임:
 *  - 새 클로드 코드 세션의 첫 prompt/tool 행은 transcript flush 전이라 model이 NULL로 들어감.
 *  - proxy 응답 시점엔 model을 100% 알고 있으므로 같은 session_id의 NULL model 행을 즉시 채움.
 *
 * 시간 윈도우: proxyStartMs - 30s ~ proxyStartMs + 5s
 *  - 보통은 hook이 proxy보다 먼저 도달하지만, 새 세션 시작 직후엔 proxy가 살짝 먼저 들어올 수 있어
 *    양방향으로 잡음. 5초 이상 차이 나는 행은 다른 turn으로 간주하여 건드리지 않음.
 *
 * 외부 노출: backfillRequestModelFromProxy(db, sessionId, model, proxyStartMs)
 * 호출자: handler.ts (createProxyRequest 직후)
 * 의존성: bun:sqlite Database
 */

import type { Database } from 'bun:sqlite';

/**
 * 같은 session_id + 시간 윈도우 안의 model IS NULL 행을 일괄 UPDATE.
 *
 * sessionId 또는 model이 null이면 no-op (안전).
 */
export function backfillRequestModelFromProxy(
  db: Database,
  sessionId: string | null,
  model: string | null,
  proxyStartMs: number,
): void {
  if (!sessionId || !model) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).run(
      `UPDATE requests
       SET model = ?
       WHERE session_id = ?
         AND model IS NULL
         AND timestamp BETWEEN ? AND ?`,
      model,
      sessionId,
      proxyStartMs - 30_000,
      proxyStartMs + 5_000,
    );
  } catch (err) {
    console.warn('[PROXY] backfill model UPDATE failed:', err);
  }
}
