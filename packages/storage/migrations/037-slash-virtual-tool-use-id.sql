-- =============================================================================
-- 037 — slash_command 행에 가상 tool_use_id 부여 + 부분 인덱스 추가
-- =============================================================================
-- 배경 (meta-docs-flow-tree feature):
--   ego-graph를 cooccurrence(같은 turn에 함께 등장)에서 parent_tool_use_id 체인을
--   BFS로 따라가는 다단계 호출 트리(depth ≤ 3)로 전환한다.
--
--   문제: slash_command 행(`/pm`, `/commit` 등)은 user_prompt_submit 시점에 기록되며
--         tool_use_id가 없다. 따라서 같은 turn에서 일어난 root-level Skill/Agent 호출
--         들과 parent_tool_use_id로 연결할 방법이 없었다.
--
-- 해결:
--   1) slash_command가 있는 기존 행에 가상 tool_use_id = 'slash:' || turn_id 부여
--   2) 같은 turn 내 root-level 호출(parent_tool_use_id IS NULL)들의 parent를
--      그 가상 ID로 연결 — 슬래시가 직접 호출한 자식들로 인식되게 한다.
--
--   가상 ID 형식 'slash:<turn_id>' 는 일반 anthropic tool_use_id(`toolu_*`)와
--   충돌하지 않는다. 신규 행에도 동일 규칙이 적용되도록 캡처 로직(handlers)을
--   함께 갱신한다.
--
-- 부분 인덱스:
--   BFS의 핵심 쿼리 `WHERE parent_tool_use_id IN (...)` 가속용.
--   IS NOT NULL 부분 조건으로 인덱스 크기 최소화.
--
-- 트랜잭션:
--   - 본 파일은 migrator.transaction() 안에서 실행됨 — 파일 내부 BEGIN/COMMIT 금지.
--
-- @see packages/storage/src/queries/meta-document.ts getMetaFlowEgo (callTree BFS)
-- @see packages/server/src/hook/handlers/user-prompt-submit.handler.ts
-- =============================================================================

-- 1) slash_command 행에 가상 tool_use_id 부여 (없는 경우에만)
UPDATE requests
SET tool_use_id = 'slash:' || turn_id
WHERE slash_command IS NOT NULL
  AND tool_use_id IS NULL
  AND turn_id IS NOT NULL;

-- 2) 같은 turn 내 root-level 호출을 슬래시 가상 ID에 연결
UPDATE requests AS child
SET parent_tool_use_id = 'slash:' || child.turn_id
WHERE child.parent_tool_use_id IS NULL
  AND child.tool_use_id IS NOT NULL
  AND child.tool_use_id NOT LIKE 'slash:%'
  AND child.turn_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM requests AS slash
    WHERE slash.turn_id = child.turn_id
      AND slash.slash_command IS NOT NULL
      AND slash.tool_use_id = 'slash:' || child.turn_id
  );

-- 3) BFS 가속용 부분 인덱스
CREATE INDEX IF NOT EXISTS idx_requests_parent_tool_use_id
  ON requests(parent_tool_use_id)
  WHERE parent_tool_use_id IS NOT NULL;
