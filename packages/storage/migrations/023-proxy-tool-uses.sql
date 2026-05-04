-- Migration 023: proxy_tool_uses 테이블 — tool_use_id ↔ api_request_id 정확 매핑
--
-- 배경 (ADR-001 P1-E):
-- - 기존엔 hook 측에서 proxy 응답을 timestamp 윈도우(120s)로 매칭. 평균 60s · 최대 224s 응답
--   환경에서 누락 위험 + cross-session 오매칭 가능.
-- - 진단 로그 분석 결과: proxy SSE에 content_block_start의 tool_use 블록이 들어오고,
--   같은 tool_use_id가 hook PostToolUse payload에 1:1로 도착함을 확인.
-- - Anthropic 응답 메시지(msg_XXX = api_request_id) 안에 tool_use 블록(toolu_XXX)이 들어가는
--   구조이므로, tool_use_id PK로 api_request_id를 조회하면 시간 의존이 0초가 된다.
--
-- 변경:
-- - proxy_tool_uses 테이블 신설.
-- - tool_use_id PRIMARY KEY (Anthropic 발급, 전역 유니크 가정).
-- - api_request_id INDEX (역방향 조회 — "이 응답이 발행한 도구 호출들" 같은 쿼리용).

CREATE TABLE proxy_tool_uses (
  tool_use_id    TEXT PRIMARY KEY,
  api_request_id TEXT NOT NULL,
  tool_name      TEXT,
  block_index    INTEGER,
  created_at     INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_proxy_tool_uses_api_request_id
  ON proxy_tool_uses(api_request_id);
