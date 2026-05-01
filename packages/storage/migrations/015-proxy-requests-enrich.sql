-- Migration 015: proxy_requests 스키마 확장 + correlation VIEW
--
-- (1) proxy_requests: 요청/응답 세부 메타데이터 컬럼 추가
--   - messages_count: 요청 메시지 개수 (대화 히스토리 깊이)
--   - max_tokens: 요청 시 지정한 max_tokens
--   - tools_count: 요청에 포함된 tool 정의 수
--   - request_preview: 마지막 user 메시지 앞 200자 (훅 preview와 correlation 키)
--   - stop_reason: end_turn | max_tokens | tool_use | stop_sequence
--   - response_preview: 어시스턴트 응답 앞 200자
--   - error_type: authentication_error | invalid_request_error | etc
--   - error_message: 에러 상세 메시지
--   - first_token_ms: Time-To-First-Token (TTFT, ms)
--   - api_request_id: Anthropic 서버가 발행한 req_xxx ID
--
-- (2) correlated_requests VIEW:
--   proxy_requests ↔ requests(hooks) 를 타임스탬프 근사값으로 연결
--   프록시 요청 ±5초 이내의 UserPromptSubmit 훅 이벤트를 매핑

ALTER TABLE proxy_requests ADD COLUMN messages_count  INTEGER DEFAULT 0;
ALTER TABLE proxy_requests ADD COLUMN max_tokens      INTEGER;
ALTER TABLE proxy_requests ADD COLUMN tools_count     INTEGER DEFAULT 0;
ALTER TABLE proxy_requests ADD COLUMN request_preview TEXT;
ALTER TABLE proxy_requests ADD COLUMN stop_reason     TEXT;
ALTER TABLE proxy_requests ADD COLUMN response_preview TEXT;
ALTER TABLE proxy_requests ADD COLUMN error_type      TEXT;
ALTER TABLE proxy_requests ADD COLUMN error_message   TEXT;
ALTER TABLE proxy_requests ADD COLUMN first_token_ms  INTEGER;
ALTER TABLE proxy_requests ADD COLUMN api_request_id  TEXT;

-- correlated_requests: proxy + hook 통합 뷰
-- 같은 시간대(±5초)의 UserPromptSubmit 훅과 프록시 요청을 연결
DROP VIEW IF EXISTS correlated_requests;
CREATE VIEW correlated_requests AS
SELECT
  pr.id              AS proxy_id,
  pr.timestamp       AS proxy_ts,
  pr.method,
  pr.path,
  pr.status_code,
  pr.response_time_ms,
  pr.first_token_ms,
  pr.model           AS proxy_model,
  pr.tokens_input,
  pr.tokens_output,
  pr.cache_creation_tokens,
  pr.cache_read_tokens,
  pr.tokens_per_second,
  pr.cost_usd,
  pr.is_stream,
  pr.messages_count,
  pr.max_tokens,
  pr.tools_count,
  pr.stop_reason,
  pr.request_preview  AS proxy_request_preview,
  pr.response_preview AS proxy_response_preview,
  pr.error_type,
  pr.error_message,
  pr.api_request_id,
  -- 훅 데이터
  r.id               AS hook_id,
  r.session_id,
  r.turn_id,
  r.model            AS hook_model,
  r.tokens_input     AS hook_tokens_input,
  r.tokens_output    AS hook_tokens_output,
  r.cache_read_tokens AS hook_cache_read,
  r.preview          AS hook_prompt_preview,
  r.timestamp        AS hook_ts,
  ABS(pr.timestamp - r.timestamp) AS correlation_diff_ms
FROM proxy_requests pr
LEFT JOIN (
  SELECT id, session_id, turn_id, model, tokens_input, tokens_output,
         cache_read_tokens, preview, timestamp
  FROM requests
  WHERE type = 'prompt'
) r ON r.timestamp BETWEEN pr.timestamp - 5000 AND pr.timestamp + 2000
ORDER BY pr.timestamp DESC;
