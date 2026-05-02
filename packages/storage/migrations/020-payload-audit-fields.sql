-- Migration 020: 실제 페이로드 분석으로 발견한 감사/분석 활용 가능 필드 컬럼화
--
-- 근거 (proxy-payload.jsonl + hook-payload.jsonl 실측):
--  proxy 측 - 요청 헤더/본문에 항상 포함되지만 DB에 저장 안 되던 메타:
--    user-agent, x-app, anthropic-beta, x-stainless-* (SDK 메타),
--    body.thinking.type, body.temperature, body.metadata.user_id,
--    body.system, body.tools[].name
--  proxy 측 - 응답 헤더 안에 있던 운영 메타:
--    anthropic-organization-id, request-id (api_request_id의 msg_xxx와 별개의 req_xxx)
--  hook 측 - raw 페이로드에 있지만 requests에 저장 안 되던 메타:
--    permission_mode, agent_id, agent_type,
--    tool_response.interrupted, tool_response.userModified
--
-- 활용 (예시):
--  - 어떤 클라이언트/CLI 버전이 어떤 베타 기능을 가장 많이 사용? (anthropic_beta, client_user_agent)
--  - 권한 모드(bypassPermissions/plan/...)별 도구 호출 패턴 (permission_mode)
--  - 서브에이전트 호출 비중·체인 (agent_id, agent_type)
--  - 인터럽트 비율 / 사용자 수정 비율 (tool_interrupted, tool_user_modified)
--  - 동일 system 프롬프트 재사용 / temperature 변동 (system_preview, temperature)
--  - 조직 단위 비용·사용량 분석 (anthropic_org_id)

-- proxy_requests: 클라이언트/요청 메타
ALTER TABLE proxy_requests ADD COLUMN client_user_agent     TEXT;
ALTER TABLE proxy_requests ADD COLUMN client_app            TEXT;
ALTER TABLE proxy_requests ADD COLUMN anthropic_beta        TEXT;
ALTER TABLE proxy_requests ADD COLUMN anthropic_org_id      TEXT;
ALTER TABLE proxy_requests ADD COLUMN anthropic_request_id  TEXT;
ALTER TABLE proxy_requests ADD COLUMN thinking_type         TEXT;
ALTER TABLE proxy_requests ADD COLUMN temperature           REAL;
ALTER TABLE proxy_requests ADD COLUMN system_preview        TEXT;
ALTER TABLE proxy_requests ADD COLUMN tool_names            TEXT;
ALTER TABLE proxy_requests ADD COLUMN metadata_user_id      TEXT;
ALTER TABLE proxy_requests ADD COLUMN client_meta_json      TEXT;

-- requests: hook raw 페이로드 메타
ALTER TABLE requests ADD COLUMN permission_mode    TEXT;
ALTER TABLE requests ADD COLUMN agent_id           TEXT;
ALTER TABLE requests ADD COLUMN agent_type         TEXT;
ALTER TABLE requests ADD COLUMN tool_interrupted   INTEGER;
ALTER TABLE requests ADD COLUMN tool_user_modified INTEGER;

-- 인덱스: 분석 쿼리에서 자주 그룹화할 컬럼들
CREATE INDEX IF NOT EXISTS idx_proxy_requests_client_app
  ON proxy_requests(client_app)
  WHERE client_app IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_proxy_requests_anthropic_org
  ON proxy_requests(anthropic_org_id)
  WHERE anthropic_org_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_proxy_requests_anthropic_req_id
  ON proxy_requests(anthropic_request_id)
  WHERE anthropic_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_requests_agent_id
  ON requests(agent_id)
  WHERE agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_requests_permission_mode
  ON requests(permission_mode)
  WHERE permission_mode IS NOT NULL;
