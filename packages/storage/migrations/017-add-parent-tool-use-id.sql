-- Migration 017: requests.parent_tool_use_id 컬럼 추가
--
-- 서브에이전트(Task tool로 호출된 Agent) 내부에서 발생하는 도구 호출들을
-- 부모 Agent 행과 연결하기 위한 외래키 성격의 컬럼.
--
-- 데이터 모델:
--   - 부모 행: type='tool_call', tool_name='Agent', tool_use_id='toolu_xxx' (메인 transcript)
--   - 자식 행: type='tool_call', source='subagent-transcript',
--             parent_tool_use_id='toolu_xxx' (부모 Agent의 tool_use_id 참조)
--
-- visible_requests VIEW는 그대로 유지(parent_tool_use_id 노출은 SELECT * 자동).
-- 자식 행은 source='subagent-transcript' + event_type='tool'로 들어가므로
-- 기존 필터(event_type='pre_tool' 제외)에 영향 없음.
--
-- 인덱스: 자식 조회는 parent_tool_use_id 단일 컬럼 EQ 검색 → 단일 인덱스 충분.
--
-- ADR: ${CLAUDE_PROJECT_DIR}/.claude/docs/plans/subagent-children/adr.md

ALTER TABLE requests ADD COLUMN parent_tool_use_id TEXT;

CREATE INDEX IF NOT EXISTS idx_requests_parent_tool_use_id
  ON requests(parent_tool_use_id)
  WHERE parent_tool_use_id IS NOT NULL;
