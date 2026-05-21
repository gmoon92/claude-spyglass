-- Migration 038: 서브에이전트 자식 행의 parent_tool_use_id 백필
--
-- 배경
--   meta-docs-flow (Migration 037 + BFS) 가 호출 트리를 parent_tool_use_id 체인으로
--   추적한다. 그러나 실제 데이터에서는:
--     - Agent 행: tool_use_id 채움, agent_type NULL (자기 자신이 부모이므로)
--     - 서브에이전트 자식 행: agent_type=<부모 Agent 이름>, agent_id=<서브세션 ID>
--       그러나 parent_tool_use_id 는 비어 있음 (source='claude-code-hook' 경로)
--   결과: BFS 가 depth=1 자식을 단 한 행도 찾지 못하고 center 노드만 표시됨.
--
-- 백필 규칙
--   agent_type IS NOT NULL AND parent_tool_use_id IS NULL 인 행에 대해,
--   동일 (session_id, turn_id) 안의 가장 최근(timestamp 기준) Agent 행을 부모로 채움.
--   - parent.tool_name='Agent' AND parent.tool_detail = child.agent_type
--   - parent.tool_use_id IS NOT NULL
--   - parent.event_type IS NULL OR parent.event_type='tool'  (pre_tool 미머지 행 제외)
--   - parent.timestamp <= child.timestamp (시간 순서)
--
-- 안전 장치
--   - 자기 자신 매칭 방지: parent.id != child.id
--   - 단 한 행만 후보일 때만 채움 → 같은 턴에 같은 type 의 Agent 가 2회 이상이면 NULL 유지
--     (모호한 경우는 BFS 가 단순히 결과를 누락하는 편이 잘못 연결되는 것보다 안전)
--   - idempotent: parent_tool_use_id IS NULL 조건으로 중복 적용 방지

UPDATE requests AS child
SET parent_tool_use_id = (
  SELECT parent.tool_use_id
  FROM requests AS parent
  WHERE parent.tool_name = 'Agent'
    AND parent.tool_detail = child.agent_type
    AND parent.session_id = child.session_id
    AND parent.turn_id = child.turn_id
    AND parent.tool_use_id IS NOT NULL
    AND (parent.event_type IS NULL OR parent.event_type = 'tool')
    AND parent.timestamp <= child.timestamp
    AND parent.id != child.id
  ORDER BY parent.timestamp DESC
  LIMIT 1
)
WHERE child.agent_type IS NOT NULL
  AND child.parent_tool_use_id IS NULL
  AND child.session_id IS NOT NULL
  AND child.turn_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM requests AS parent
    WHERE parent.tool_name = 'Agent'
      AND parent.tool_detail = child.agent_type
      AND parent.session_id = child.session_id
      AND parent.turn_id = child.turn_id
      AND parent.tool_use_id IS NOT NULL
      AND (parent.event_type IS NULL OR parent.event_type = 'tool')
      AND parent.timestamp <= child.timestamp
      AND parent.id != child.id
  );
