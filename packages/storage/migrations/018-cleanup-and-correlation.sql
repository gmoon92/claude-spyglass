-- Migration 018: 데이터 정리 및 correlated_requests 매칭 정확도 개선
--
-- 1) sentinel session(id='s1', project_name='p', epoch 0) 삭제
--    - 과거 테스트 시드의 잔여 행. 실제 요청 0건 연결되어 있음.
-- 2) visible_requests VIEW 제거
--    - event_type='pre_tool' 행이 0건이라 필터가 무의미한 dead code 상태.
--    - 사용처(소스 grep) 없음을 확인 후 안전하게 제거.
-- 3) correlated_requests VIEW 재정의
--    - 기존: prompt 행만 매칭 → 매칭률 ~3% (prompt 86건, proxy 965건)
--    - 신규: prompt 우선, 없으면 tool_call(±10s 윈도우)로 fallback

DELETE FROM sessions WHERE id = 's1' OR started_at < 1700000000000;

DROP VIEW IF EXISTS visible_requests;

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
  COALESCE(prompt_match.session_id, tool_match.session_id)         AS session_id,
  COALESCE(prompt_match.turn_id,    tool_match.turn_id)            AS turn_id,
  COALESCE(prompt_match.hook_model, tool_match.hook_model)         AS hook_model,
  COALESCE(prompt_match.hook_tokens_input,  tool_match.hook_tokens_input)  AS hook_tokens_input,
  COALESCE(prompt_match.hook_tokens_output, tool_match.hook_tokens_output) AS hook_tokens_output,
  COALESCE(prompt_match.hook_cache_read,    tool_match.hook_cache_read)    AS hook_cache_read,
  prompt_match.hook_prompt_preview,
  COALESCE(prompt_match.hook_ts,    tool_match.hook_ts)            AS hook_ts,
  CASE
    WHEN prompt_match.hook_ts IS NOT NULL THEN 'prompt'
    WHEN tool_match.hook_ts   IS NOT NULL THEN 'tool_call'
    ELSE NULL
  END AS correlation_kind,
  COALESCE(prompt_match.diff_ms, tool_match.diff_ms) AS correlation_diff_ms
FROM proxy_requests pr
LEFT JOIN (
  SELECT pr2.id AS proxy_id,
         r.session_id, r.turn_id, r.model AS hook_model,
         r.tokens_input AS hook_tokens_input, r.tokens_output AS hook_tokens_output,
         r.cache_read_tokens AS hook_cache_read,
         r.preview AS hook_prompt_preview,
         r.timestamp AS hook_ts,
         ABS(pr2.timestamp - r.timestamp) AS diff_ms,
         ROW_NUMBER() OVER (PARTITION BY pr2.id ORDER BY ABS(pr2.timestamp - r.timestamp)) AS rn
  FROM proxy_requests pr2
  JOIN requests r
    ON r.type = 'prompt'
   AND r.timestamp BETWEEN pr2.timestamp - 5000 AND pr2.timestamp + 2000
) prompt_match ON prompt_match.proxy_id = pr.id AND prompt_match.rn = 1
LEFT JOIN (
  SELECT pr2.id AS proxy_id,
         r.session_id, r.turn_id, r.model AS hook_model,
         r.tokens_input AS hook_tokens_input, r.tokens_output AS hook_tokens_output,
         r.cache_read_tokens AS hook_cache_read,
         r.timestamp AS hook_ts,
         ABS(pr2.timestamp - r.timestamp) AS diff_ms,
         ROW_NUMBER() OVER (PARTITION BY pr2.id ORDER BY ABS(pr2.timestamp - r.timestamp)) AS rn
  FROM proxy_requests pr2
  JOIN requests r
    ON r.type = 'tool_call'
   AND r.timestamp BETWEEN pr2.timestamp - 10000 AND pr2.timestamp + 5000
) tool_match ON tool_match.proxy_id = pr.id AND tool_match.rn = 1
ORDER BY pr.timestamp DESC;
