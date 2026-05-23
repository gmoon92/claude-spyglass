-- =============================================================================
-- 043 — request_view: 비정규화 read projection (storage-redesign-v3 Phase 2)
-- =============================================================================
-- 배경 (redesign-plan.md §1-4):
--   현재 로그 피드는 `getAllRequests` 1쿼리 후:
--     - normalizeRequests: sub_type / trust_level / model fallback 매 호출마다 계산
--     - enrichWithAnomalies: Agent 행마다 depth-3 WITH RECURSIVE (200~500ms cold)
--   이 모두를 read 시점이 아니라 projection 시점에 미리 계산해 두면
--   /api/requests 는 단순 SELECT + LIMIT 으로 끝난다.
--
-- 책임 (R4):
--   - 본 테이블은 read API 가 SELECT 만. UPDATE 는 projection worker 단독 (R3).
--   - source-of-truth 는 events_v3 — 깨지면 TRUNCATE + watermark=0 으로 재build.
--
-- 컬럼 설계:
--   - pre-derived: sub_type, trust_level, status (running/ok/error) — read 시 계산 0
--   - model: 폴백까지 해결된 최종 값 (turn 내 prompt 의 model 으로 채워둠)
--   - flags_json: anomaly 플래그 미리 부여 ({bloated_sys, agent_spike, ...})
--   - source_event_id: 어느 events_v3 row 가 본 row 를 만들었는지 역추적용
--
-- 인덱스:
--   - (session_id, timestamp DESC): 세션 페이지
--   - (type, timestamp DESC): 타입별 필터
--   - (tool_use_id) WHERE NOT NULL: pre/post 페어 조회 / agent_chain 펼침
--   - (parent_tool_use_id) WHERE NOT NULL: 서브에이전트 체인
--
-- 멱등성:
--   - PK = id (events_v3.event_id 와 동일) → INSERT OR REPLACE 로 worker upsert.
--   - schema_version 컬럼은 향후 컬럼 추가 시 partial backfill 결정용.
-- =============================================================================

CREATE TABLE IF NOT EXISTS request_view (
  id                  TEXT PRIMARY KEY,                           -- = events_v3.event_id (앱-레벨 ID)
  session_id          TEXT NOT NULL,
  turn_id             TEXT,
  timestamp           INTEGER NOT NULL,                           -- ms epoch

  -- type: 'prompt' | 'tool_call' | 'response' | 'system'
  type                TEXT NOT NULL,

  -- status: 'running' | 'ok' | 'error' (read 시 계산 금지 — 본 컬럼이 SSoT)
  status              TEXT NOT NULL DEFAULT 'ok',

  -- pre-derived from tool_name / model — read 측 normalize 불필요
  tool_name           TEXT,
  tool_detail         TEXT,
  tool_use_id         TEXT,
  parent_tool_use_id  TEXT,
  sub_type            TEXT,                                       -- 'Agent' | 'Skill' | 'Task' | 'mcp' | 'normal' 등 (request-normalizer SSoT 호환)
  trust_level         TEXT,                                       -- 'high' | 'medium' | 'low' 등

  -- model: turn 내 prompt 의 model 으로 채워진 최종 값 (model_fallback_applied 결과)
  model               TEXT,

  -- tokens
  tokens_input        INTEGER NOT NULL DEFAULT 0,
  tokens_output       INTEGER NOT NULL DEFAULT 0,
  tokens_total        INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
  duration_ms         INTEGER NOT NULL DEFAULT 0,

  -- subagent / agent context
  agent_id            TEXT,
  agent_type          TEXT,
  permission_mode     TEXT,

  -- anomaly 플래그 미리 부여 — JSON {bloated_sys: bool, agent_spike: bool, spike: bool, loop: bool, slow: bool}
  flags_json          TEXT,

  -- 역추적 / 재build
  source_event_id     INTEGER NOT NULL,                           -- events_v3.id
  schema_version      INTEGER NOT NULL DEFAULT 1,
  updated_at          INTEGER NOT NULL                            -- ms epoch — projection upsert 시점
);

-- 로그 피드 메인 쿼리: WHERE session_id = ? ORDER BY timestamp DESC LIMIT N
CREATE INDEX IF NOT EXISTS idx_request_view_session_ts
  ON request_view(session_id, timestamp DESC);

-- 타입별 필터 (예: tool_call 만)
CREATE INDEX IF NOT EXISTS idx_request_view_type_ts
  ON request_view(type, timestamp DESC);

-- pre/post 페어링 + agent chain 펼침 base
CREATE INDEX IF NOT EXISTS idx_request_view_tool_use
  ON request_view(tool_use_id) WHERE tool_use_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_request_view_parent_tool_use
  ON request_view(parent_tool_use_id) WHERE parent_tool_use_id IS NOT NULL;

-- 시간 전체 정렬 (글로벌 피드)
CREATE INDEX IF NOT EXISTS idx_request_view_ts
  ON request_view(timestamp DESC);

-- source_event_id 역추적 (debugging / re-projection)
CREATE INDEX IF NOT EXISTS idx_request_view_source_event
  ON request_view(source_event_id);
