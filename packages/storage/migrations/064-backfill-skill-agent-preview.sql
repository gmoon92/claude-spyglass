-- =============================================================================
-- 064 — Skill/Agent 과거 행 preview 백필 (표시용, 비파괴적)
-- =============================================================================
-- 배경:
--   preview.ts §extractPreview 가 v4.11.6 부터 tool_call 의 Skill/Agent 도 처리해
--   requests.preview 에 실제 지시문(args/description)을 채운다. 그러나 이 보강은 hook
--   수집 시점 로직이라 신규 호출부터만 적용된다 → 과거 Skill/Agent 행은 preview 가 NULL,
--   피드 MESSAGE(web §getContextText)가 tool_detail(=이름)로 폴백해 TARGET 과 중복 노출된다.
--
-- 해결:
--   request_payloads(off-row, 원본 payload SSoT)의 tool_input 에서 extractPreview 와 동일
--   우선순위로 preview 를 백필한다 — Skill=args→skill, Agent=description→prompt→subagent_type.
--   단일 COALESCE 로 두 케이스가 자연 분기된다(Skill payload 엔 description/prompt/subagent_type
--   가 없고, Agent payload 엔 args/skill 이 없으므로 순서가 섞이지 않는다). 2000자 상한(prompt 와 동일).
--
-- tool_detail(메타 카탈로그·그래프 flow 의 식별자 GROUP BY tool_detail)은 건드리지 않는다 —
-- preview 는 표시 전용 컬럼이라 안전.
--
-- 안전성:
--   - 평문 payload 만(`substr(...,1,1)='{'`). 암호화(R3) 환경은 payload 가 암호문이라 '{' 미매칭 →
--     스킵 → 평문 preview 누출 없음(preview_algo 불일치 회피). preview_algo 는 건드리지 않음(NULL 유지).
--   - 멱등: preview 가 이미 채워진 행은 WHERE 에서 제외. 두 번 실행해도 결과 동일.
--   - 트랜잭션: migrator 가 단일 트랜잭션으로 감쌈 — 실패 시 전체 롤백.
--   - 대상은 Skill/Agent 행으로 한정(소량) + request_payloads PK 조인 → 부팅 1회 수십~수백 ms.
--
-- Rollback (수동): _migrations 에서 064 행 삭제 + PRAGMA user_version=63. 백필된 preview 는
--   표시용이라 그대로 둬도 무해(신규 수집 데이터와 동일 형태).
-- =============================================================================

UPDATE requests
SET preview = substr(COALESCE(
  NULLIF(json_extract(CAST(p.payload AS TEXT), '$.tool_input.args'), ''),
  NULLIF(json_extract(CAST(p.payload AS TEXT), '$.tool_input.skill'), ''),
  NULLIF(json_extract(CAST(p.payload AS TEXT), '$.tool_input.description'), ''),
  NULLIF(json_extract(CAST(p.payload AS TEXT), '$.tool_input.prompt'), ''),
  NULLIF(json_extract(CAST(p.payload AS TEXT), '$.tool_input.subagent_type'), '')
), 1, 2000)
FROM request_payloads p
WHERE p.request_id = requests.id
  AND requests.tool_name IN ('Skill', 'Agent')
  AND (requests.preview IS NULL OR requests.preview = '')
  AND substr(CAST(p.payload AS TEXT), 1, 1) = '{'
  AND json_extract(CAST(p.payload AS TEXT), '$.tool_input') IS NOT NULL;
