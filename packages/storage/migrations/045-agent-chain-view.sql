-- =============================================================================
-- 045 — agent_chain_view: depth-3 펼침 projection (storage-redesign-v3 Phase 2)
-- =============================================================================
-- 배경 (redesign-plan.md §1-3):
--   현재 enrichWithAnomalies 가 페이지 내 Agent/Skill/Task 행마다 depth-3
--   WITH RECURSIVE 호출:
--     parent.tool_use_id → parent_tool_use_id 체인 깊이 3 펼침 → 자식 토큰 합산.
--   페이지 200건 중 Agent 행이 10개면 10번 재귀 쿼리. 메모이즈 없음.
--   cold-cache 200~500ms (request-normalizer 주석 인용).
--
-- 결정:
--   - 부모-자식 체인을 미리 펼친 flat 테이블.
--   - read 측은 본 테이블 SELECT 1회로 자식 토큰 합산 완료. WITH RECURSIVE 제거.
--
-- 컬럼:
--   - root_tool_use_id : 체인 시작점 (Agent/Skill/Task)
--   - descendant_tool_use_id : 자손의 tool_use_id (자기 자신 포함 가능 — depth=0)
--   - depth : 0 (root 자체), 1, 2, 3 — 깊이 3까지만 펼침 (현재 anomaly 정책과 정합)
--   - tokens_total / row_count : 미리 합산
--
-- 사용 예시:
--   /* 한 Agent 의 모든 자손 토큰 합산 */
--   SELECT SUM(tokens_total) FROM agent_chain_view
--   WHERE root_tool_use_id = ? AND depth > 0;
--
-- 멱등성:
--   - PK = (root_tool_use_id, descendant_tool_use_id) → REPLACE 안전.
--   - 자식이 늦게 도착해도 watermark 기반 worker 가 다음 tick 에 자동 채움.
--
-- 인덱스:
--   - (root_tool_use_id): 한 root 의 모든 자손 조회 (메인 쿼리).
--   - (descendant_tool_use_id): 역방향 (자손 → 모든 조상) 조회.
--   - (session_id, root_tool_use_id): 세션 범위 필터 + root.
-- =============================================================================

CREATE TABLE IF NOT EXISTS agent_chain_view (
  root_tool_use_id        TEXT NOT NULL,                          -- 체인 시작 (Agent/Skill/Task 등)
  descendant_tool_use_id  TEXT NOT NULL,                          -- 자손 tool_use_id (depth=0 이면 자기 자신)
  session_id              TEXT NOT NULL,
  depth                   INTEGER NOT NULL,                       -- 0 (root) | 1 | 2 | 3 — depth 3 까지만
  tokens_input            INTEGER NOT NULL DEFAULT 0,
  tokens_output           INTEGER NOT NULL DEFAULT 0,
  tokens_total            INTEGER NOT NULL DEFAULT 0,
  row_count               INTEGER NOT NULL DEFAULT 1,             -- 본 descendant 가 차지하는 raw row 수 (보통 1, post_tool 머지면 2)
  source_event_id         INTEGER NOT NULL,                       -- 본 row 가 마지막으로 업데이트된 events_v3.id
  schema_version          INTEGER NOT NULL DEFAULT 1,
  updated_at              INTEGER NOT NULL,

  PRIMARY KEY (root_tool_use_id, descendant_tool_use_id)
);

-- 메인 쿼리 — 한 root 의 모든 자손
CREATE INDEX IF NOT EXISTS idx_agent_chain_root
  ON agent_chain_view(root_tool_use_id, depth);

-- 역방향 — 한 descendant 의 모든 조상 (anomaly 회귀 분석용)
CREATE INDEX IF NOT EXISTS idx_agent_chain_descendant
  ON agent_chain_view(descendant_tool_use_id);

-- 세션 범위 필터
CREATE INDEX IF NOT EXISTS idx_agent_chain_session
  ON agent_chain_view(session_id, root_tool_use_id);

-- 역추적
CREATE INDEX IF NOT EXISTS idx_agent_chain_source_event
  ON agent_chain_view(source_event_id);
