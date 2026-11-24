-- =============================================================================
-- 071 — 서브에이전트 행의 잘못 채워진 model 보정 (1회성 데이터 수정)
-- =============================================================================
-- 배경:
--   서브에이전트 첫 도구 호출의 PreToolUse 시점에는 서브 transcript 에 assistant 줄이 없어 model 이
--   NULL 로 들어간다. 이후 proxy 응답 backfill(server proxy/backfill.ts)이 "같은 세션 + 시간 윈도우"
--   로만 행을 골라, 동시에 오가던 메인 세션 응답의 model(부모 모델)로 채우는 경우가 있었다.
--   → /api/stats/subagents 상한 판정(over_cap)의 거짓 양성 원인.
--   코드 수정: backfill 이 billing-header cc_is_subagent 로 메인/서브 행을 구분한다(같은 커밋).
--
-- 보정 규칙:
--   서브에이전트 행(agent_id NOT NULL) 중 api_request_id 로 이어지는 proxy 요청이 서브에이전트
--   요청(system_preview 의 cc_is_subagent=true)인데 model 이 다르면, proxy 의 model 로 바꾼다.
--   proxy 는 실제 API 호출 기록이라 모델의 단일 출처로 본다.
--
-- 정책:
--   - 멱등: 이미 같은 값이면 대상에서 빠진다(재적용 안전).
--   - 메인 행(agent_id NULL)은 건드리지 않는다 — 어느 proxy 요청이 맞는지 이 정보만으로는 정할 수 없다.
--   - Hot 테이블만 대상. Archive 로 옮겨진 행은 그대로 둔다.
-- =============================================================================

UPDATE requests
   SET model = (
     SELECT p.model FROM proxy_requests p
      WHERE p.api_request_id = requests.api_request_id
        AND p.system_preview LIKE '%cc_is_subagent=true%'
        AND p.model IS NOT NULL
      LIMIT 1
   )
 WHERE agent_id IS NOT NULL
   AND api_request_id IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM proxy_requests p
      WHERE p.api_request_id = requests.api_request_id
        AND p.system_preview LIKE '%cc_is_subagent=true%'
        AND p.model IS NOT NULL
        AND p.model IS NOT requests.model
   );
