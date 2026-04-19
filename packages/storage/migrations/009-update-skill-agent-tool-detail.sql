-- Migration 009: Skill/Agent tool_detail 개선
-- 훅 스크립트 변경에 따른 tool_detail 저장 방식 개선
-- - Skill: args/description → skill 이름으로 업데이트
-- - Agent: -> description으로 업데이트
-- 멱등성: != 조건으로 동일 마이그레이션 반복 실행 가능

UPDATE requests
SET tool_detail = json_extract(payload, '$.tool_input.skill')
WHERE tool_name = 'Skill'
  AND json_valid(payload)
  AND json_extract(payload, '$.tool_input.skill') IS NOT NULL
  AND (
    tool_detail IS NULL
    OR tool_detail != json_extract(payload, '$.tool_input.skill')
  );

UPDATE requests
SET tool_detail = json_extract(payload, '$.tool_input.description')
WHERE tool_name = 'Agent'
  AND json_valid(payload)
  AND json_extract(payload, '$.tool_input.description') IS NOT NULL
  AND (
    tool_detail IS NULL
    OR tool_detail != json_extract(payload, '$.tool_input.description')
  );
