-- Migration 019: hook ↔ proxy cross-link을 위한 컬럼 추가
--
-- 배경:
-- - 프록시 요청 헤더에는 `x-claude-code-session-id`가 있어 hook과 정확히 매칭 가능하지만,
--   현재 proxy_requests는 timestamp ±5/10s 휴리스틱으로만 매칭(correlated_requests VIEW).
--   진단 로그(proxy-payload.jsonl)에서 이 헤더가 100% 신뢰성 있게 들어옴을 확인.
-- - Anthropic API 응답의 api_request_id는 proxy_requests에는 저장하지만 requests에는 컬럼이 없음.
--   hook의 응답 행과 proxy 응답을 연결할 키가 없음.
-- - 같은 turn 안에서 proxy 호출은 N번 발생하지만 turn_id가 proxy 측에 없어 묶지 못함.
--
-- 변경:
-- 1) proxy_requests.session_id  — 헤더 직접 저장 → join key
-- 2) proxy_requests.turn_id     — 같은 turn의 N개 API 호출 그룹화
-- 3) requests.api_request_id    — Anthropic 외부 ID 역참조

ALTER TABLE proxy_requests ADD COLUMN session_id TEXT;
ALTER TABLE proxy_requests ADD COLUMN turn_id TEXT;
ALTER TABLE requests ADD COLUMN api_request_id TEXT;

CREATE INDEX IF NOT EXISTS idx_proxy_requests_session_id
  ON proxy_requests(session_id, timestamp DESC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_proxy_requests_turn_id
  ON proxy_requests(turn_id)
  WHERE turn_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_requests_api_request_id
  ON requests(api_request_id)
  WHERE api_request_id IS NOT NULL;
