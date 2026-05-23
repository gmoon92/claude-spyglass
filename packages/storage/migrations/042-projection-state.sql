-- =============================================================================
-- 042 — projection_state: watermark SSoT (storage-redesign-v3 Phase 2)
-- =============================================================================
-- 배경 (redesign-plan.md R3, R8):
--   각 projection (request_view, turn_view, agent_chain_view) 은 events_v3 를
--   tail 로 따라가며 idempotent upsert 한다. "어디까지 처리했는가" 를 추적하는
--   단일 SSoT 가 필요.
--
-- 결정 — (projection_name PK, last_event_id, last_advanced_at):
--   - projection_name : 'request_view' 등 단순 문자열 — application 이 정의.
--   - last_event_id   : events_v3.id 까지 진행했다는 watermark.
--   - last_advanced_at: 마지막으로 watermark 가 advance 된 시각 (lag 계산용).
--
--   각 projection 은 자기 행만 UPDATE — R3 (단일 writer / projection).
--   다른 projection 이 깨져도 본 행은 영향 없음 — R5 (격리).
--
-- /api/projection-lag (Phase 6) 가 본 테이블을 SELECT 해 lag(ms) 노출:
--   lag_ms = now() - last_advanced_at
--   pending = max(events_v3.id) - last_event_id
--
-- 초기 seed:
--   - 본 migration 적용 시점에 v3 projection 들을 등록 (row 가 없으면 worker 가
--     첫 tick 에서 자동 INSERT 하지만, 명시적으로 seed 해 두면 invariant 보장).
-- =============================================================================

CREATE TABLE IF NOT EXISTS projection_state (
  projection_name   TEXT PRIMARY KEY,
  last_event_id     INTEGER NOT NULL DEFAULT 0,    -- events_v3.id watermark (단조 증가)
  last_advanced_at  INTEGER NOT NULL DEFAULT 0,    -- ms epoch — lag 계산용
  total_processed   INTEGER NOT NULL DEFAULT 0,    -- 누적 처리 row 수 (관측용)
  last_error        TEXT,                          -- 마지막 실패 메시지 (null = healthy)
  last_error_at     INTEGER,                       -- 마지막 실패 시점 (null = healthy)
  schema_version    INTEGER NOT NULL DEFAULT 1
);

-- v3 projection 등록 (idempotent — 같은 name 으로 두 번 적용해도 안전)
INSERT OR IGNORE INTO projection_state (projection_name, last_event_id, last_advanced_at)
VALUES
  ('request_view', 0, 0),
  ('turn_view', 0, 0),
  ('agent_chain_view', 0, 0);
