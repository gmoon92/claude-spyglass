-- =============================================================================
-- 044 — turn_view: 1쿼리 turn 렌더링 projection (storage-redesign-v3 Phase 2)
-- =============================================================================
-- 배경 (redesign-plan.md §1-2):
--   현재 getTurnsBySession 가 6개 독립 쿼리 + 인메모리 Map join + 3회 ROW_NUMBER:
--     SQL1: GROUP BY turn_id
--     SQL2: prompt rows
--     SQL3: tool_call rows
--     SQL3-bis: response rows
--     SQL4a-c: proxy_requests ROW_NUMBER OVER PARTITION (system_hash / reminder / beta)
--   각 turn 1개를 보여주려고 6번 디스크 + 메모리 sort 발생.
--
-- 결정:
--   - turn 1개 = 본 테이블 1 row. payload_json 안에 prompt/tool_calls/responses
--     까지 미리 직렬화. UI 는 SELECT 1쿼리로 완료.
--   - 자주 SELECT 되는 집계 (tokens, status, has_error 등) 는 별 컬럼.
--
-- payload_json 구조 (request-normalizer / domain SSoT 와 정렬):
--   {
--     "prompt": { id, timestamp, content_preview, model, tokens_*, ... },
--     "tool_calls": [{ id, timestamp, tool_name, tool_detail, status, ... }],
--     "responses": [{ id, timestamp, model, tokens_*, ... }],
--     "summary": { ... },
--     "system_hash": "...",
--     "system_reminder": "...",
--     "first_beta": "..."
--   }
--   = 기존 6쿼리 결과를 그대로 직렬화한 형태.
--
-- 상태 결정 (status 컬럼):
--   - 'running' : 진행 중 (어떤 tool_call 이 'running')
--   - 'ok'      : 모두 ok
--   - 'error'   : 하나 이상 error
--   - 'mixed'   : ok + error 혼재 (현재 정책상 'error' 로 표시 권장하나 컬럼은 분리)
--
-- 인덱스:
--   - (session_id, turn_index): 세션 화면 정렬
--   - (session_id, started_at DESC): 시계열 정렬 (turn_index 미할당 시 fallback)
--   - (status): 'error' 만 필터
-- =============================================================================

CREATE TABLE IF NOT EXISTS turn_view (
  session_id          TEXT NOT NULL,
  turn_id             TEXT NOT NULL,
  turn_index          INTEGER NOT NULL DEFAULT 0,                 -- 세션 내 turn 순번 (1부터)
  started_at          INTEGER NOT NULL,                           -- ms epoch — 첫 이벤트 시각
  ended_at            INTEGER,                                    -- ms epoch — 마지막 이벤트 시각 (running 이면 NULL)
  duration_ms         INTEGER,                                    -- ended_at - started_at

  -- 집계 (read 시 계산 금지 — 본 컬럼이 SSoT)
  tokens_input        INTEGER NOT NULL DEFAULT 0,
  tokens_output       INTEGER NOT NULL DEFAULT 0,
  tokens_total        INTEGER NOT NULL DEFAULT 0,
  cache_read          INTEGER NOT NULL DEFAULT 0,
  cache_creation      INTEGER NOT NULL DEFAULT 0,

  prompt_id           TEXT,                                       -- turn 내 prompt 의 id (없으면 NULL — implicit turn)
  tool_call_count     INTEGER NOT NULL DEFAULT 0,
  response_count      INTEGER NOT NULL DEFAULT 0,
  error_count         INTEGER NOT NULL DEFAULT 0,

  -- 상태 SSoT
  status              TEXT NOT NULL DEFAULT 'ok',                 -- 'running' | 'ok' | 'error' | 'mixed'
  has_error           INTEGER NOT NULL DEFAULT 0,                 -- bool — error_count > 0

  -- 6쿼리 결과를 직렬화한 turn payload (UI 가 1쿼리로 받음)
  payload_json        TEXT,

  -- proxy meta 사전 결합 (system_hash 등 — getTurnsBySession SQL4a-c 의 산출)
  system_hash         TEXT,
  system_byte_size    INTEGER,
  system_reminder     TEXT,                                       -- 마지막 reminder
  first_beta          TEXT,                                       -- 첫 anthropic_beta

  -- 역추적
  source_event_id     INTEGER NOT NULL,                           -- 본 turn 의 마지막 events_v3.id
  schema_version      INTEGER NOT NULL DEFAULT 1,
  updated_at          INTEGER NOT NULL,                           -- ms epoch

  PRIMARY KEY (session_id, turn_id)
);

-- 세션 화면 정렬 — turn_index 가 SSoT
CREATE INDEX IF NOT EXISTS idx_turn_view_session
  ON turn_view(session_id, turn_index);

-- 시계열 정렬 fallback (turn_index 미할당 시)
CREATE INDEX IF NOT EXISTS idx_turn_view_session_started
  ON turn_view(session_id, started_at DESC);

-- error 필터 (글로벌)
CREATE INDEX IF NOT EXISTS idx_turn_view_status
  ON turn_view(status) WHERE status != 'ok';

-- 역추적
CREATE INDEX IF NOT EXISTS idx_turn_view_source_event
  ON turn_view(source_event_id);
