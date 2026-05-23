-- =============================================================================
-- 041 — outbox_pending: hook fast-path 5ms 보장용 outbox (storage-redesign-v3)
-- =============================================================================
-- 배경 (redesign-plan.md Phase 4-5):
--   현재 hook 응답 경로는 동기 — DB write + SSE broadcast 모두 한 트랜잭션.
--   향후 outbox 패턴을 도입해 hook 측은 events_v3 INSERT + outbox_pending INSERT
--   두 row 만 INSERT 하고 즉시 200 OK 반환 (≤5ms 목표). 비동기 worker 가
--   outbox_pending 을 drain 해 SSE broadcast / projection materialize 를 수행한다.
--
-- 본 migration 의 범위:
--   - outbox_pending 테이블 + 인덱스 생성만. (additive, 위험 0)
--   - 실제 outbox enqueue 호출 추가는 Phase 4 (hook dual-write) 에서.
--   - drain worker 는 Phase 5 (projection-worker.ts) 에서.
--
-- Claim 메커니즘:
--   - claimed_at NULL = 미처리 (worker 가 가져갈 수 있는 상태).
--   - worker 가 한 batch 를 가져갈 때:
--       UPDATE outbox_pending
--       SET claimed_at = ?, claim_token = ?
--       WHERE id IN (SELECT id FROM outbox_pending WHERE claimed_at IS NULL ORDER BY id LIMIT N)
--   - 처리 완료 시 DELETE 또는 status 컬럼 토글 (현재는 DELETE — 단순화).
--   - 처리 실패 시 retry_count + last_error 갱신, claimed_at 을 NULL 로 되돌림.
--
-- 인덱스:
--   - (claimed_at, id) WHERE claimed_at IS NULL: 미처리 행만 빠르게 LIMIT N.
--
-- 멱등성:
--   - event_id UNIQUE → 같은 event 가 두 번 enqueue 되어도 두 번째는 INSERT OR IGNORE 로 무시.
-- =============================================================================

CREATE TABLE IF NOT EXISTS outbox_pending (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      TEXT NOT NULL UNIQUE,              -- events_v3.event_id 와 1:1 대응 (idempotent)
  enqueued_at   INTEGER NOT NULL,                  -- ms epoch — outbox INSERT 시점
  claimed_at    INTEGER,                           -- ms epoch — worker claim 시점 (NULL = 미처리)
  claim_token   TEXT,                              -- worker 세션 토큰 (debugging 용)
  retry_count   INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT                                -- 실패 시 마지막 에러 메시지
);

-- 미처리 행 우선 조회 — drain worker 의 핵심 쿼리:
--   SELECT id, event_id FROM outbox_pending
--   WHERE claimed_at IS NULL ORDER BY id LIMIT 100
CREATE INDEX IF NOT EXISTS idx_outbox_pending_available
  ON outbox_pending(claimed_at, id) WHERE claimed_at IS NULL;

-- 재시도 대상 조회 — claim 후 일정 시간 경과해도 미처리인 행 (stuck 감지):
--   SELECT id FROM outbox_pending WHERE claimed_at < ? AND claim_token IS NOT NULL
CREATE INDEX IF NOT EXISTS idx_outbox_pending_claimed_at
  ON outbox_pending(claimed_at) WHERE claimed_at IS NOT NULL;
