-- Migration 039: 서브에이전트 자식의 rolling Skill/Task 부모 적용
--
-- 배경
--   Migration 038 은 agent_type 이 지정된 자식 행을 동일 (session, turn) 의 부모 Agent 에
--   일괄 연결했다. 그 결과 트리가 평면화되어 다음과 같이 잘못 표시된다:
--     pm
--       ├─ redmine (skill)
--       ├─ mcp__redmine__getIssue   ← redmine 안에서 호출됐지만 pm 직속으로 잡힘
--       └─ commit (skill)
--   기대 결과 (transcript.ts 의 rolling parent 알고리즘):
--     pm
--       ├─ redmine (skill)
--       │   └─ mcp__redmine__getIssue
--       └─ commit (skill)
--
-- rolling-parent 규칙 (transcript.ts L184-189 와 동일)
--   동일 (session_id, turn_id, agent_type) 안에서 시간 순으로 훑으며,
--   - Skill/Task 행은 부모를 매칭 Agent 로 (이전 Skill 의 형제가 됨).
--   - 그 외 도구 행은 직전 Skill/Task 가 있으면 그 toolUseId 를, 없으면 Agent 를 부모로.
--
-- 알고리즘 (SQL)
--   각 행 R 마다:
--     CASE
--       WHEN R 이 Skill/Task → R.parent = 매칭 Agent
--       ELSE → R.parent = COALESCE(R 이전 Skill/Task 의 toolUseId, 매칭 Agent)
--
-- 적용 범위
--   parent_tool_use_id IS NULL OR parent_tool_use_id = 매칭 Agent 인 행만 재계산.
--   즉 Migration 038 이 일괄 적용한 행 + 신규 NULL 행을 모두 처리한다.
--   subagent-transcript 백필이 이미 정확히 채운 행(source='subagent-transcript')은 그대로 둔다.

UPDATE requests
SET parent_tool_use_id = CASE
  -- 1) Skill/Task 행은 항상 매칭 Agent 를 부모로
  WHEN requests.tool_name IN ('Skill', 'Task')
    OR requests.tool_name LIKE 'Skill%'
    OR requests.tool_name LIKE 'Task%'
  THEN (
    SELECT parent.tool_use_id FROM requests AS parent
    WHERE parent.tool_name = 'Agent'
      AND parent.tool_detail = requests.agent_type
      AND parent.session_id = requests.session_id
      AND parent.turn_id = requests.turn_id
      AND parent.tool_use_id IS NOT NULL
      AND (parent.event_type IS NULL OR parent.event_type = 'tool')
      AND parent.timestamp <= requests.timestamp
      AND parent.id != requests.id
    ORDER BY parent.timestamp DESC
    LIMIT 1
  )
  -- 2) 그 외 도구: 직전 Skill/Task 가 있으면 그것, 없으면 Agent
  ELSE COALESCE(
    (
      SELECT skill.tool_use_id FROM requests AS skill
      WHERE skill.agent_type = requests.agent_type
        AND skill.session_id = requests.session_id
        AND skill.turn_id = requests.turn_id
        AND (skill.tool_name IN ('Skill', 'Task')
             OR skill.tool_name LIKE 'Skill%'
             OR skill.tool_name LIKE 'Task%')
        AND skill.tool_use_id IS NOT NULL
        AND skill.timestamp < requests.timestamp
      ORDER BY skill.timestamp DESC
      LIMIT 1
    ),
    (
      SELECT parent.tool_use_id FROM requests AS parent
      WHERE parent.tool_name = 'Agent'
        AND parent.tool_detail = requests.agent_type
        AND parent.session_id = requests.session_id
        AND parent.turn_id = requests.turn_id
        AND parent.tool_use_id IS NOT NULL
        AND (parent.event_type IS NULL OR parent.event_type = 'tool')
        AND parent.timestamp <= requests.timestamp
        AND parent.id != requests.id
      ORDER BY parent.timestamp DESC
      LIMIT 1
    )
  )
  END
WHERE requests.agent_type IS NOT NULL
  AND requests.session_id IS NOT NULL
  AND requests.turn_id IS NOT NULL
  AND (
    requests.parent_tool_use_id IS NULL
    OR requests.parent_tool_use_id IN (
      SELECT parent.tool_use_id FROM requests AS parent
      WHERE parent.tool_name = 'Agent'
        AND parent.tool_detail = requests.agent_type
        AND parent.session_id = requests.session_id
        AND parent.turn_id = requests.turn_id
        AND parent.tool_use_id IS NOT NULL
    )
  )
  AND (requests.source IS NULL OR requests.source != 'subagent-transcript');
