-- Migration 014: proxy_requests 테이블 생성
-- 프록시 레이어에서 수집하는 HTTP 레벨 API 메트릭 저장
-- 훅 데이터(requests 테이블)와 별도로 관리하여 비교 분석 가능
-- 향후 타임스탬프 기반 correlation으로 두 데이터 소스를 연결할 예정

CREATE TABLE IF NOT EXISTS proxy_requests (
  id               TEXT    PRIMARY KEY,
  timestamp        INTEGER NOT NULL,
  method           TEXT    NOT NULL,
  path             TEXT    NOT NULL,
  status_code      INTEGER,
  response_time_ms INTEGER,
  model            TEXT,
  tokens_input     INTEGER DEFAULT 0,
  tokens_output    INTEGER DEFAULT 0,
  cache_creation_tokens INTEGER DEFAULT 0,
  cache_read_tokens     INTEGER DEFAULT 0,
  tokens_per_second REAL,
  cost_usd         REAL,
  is_stream        INTEGER DEFAULT 0,
  created_at       INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_proxy_requests_timestamp ON proxy_requests(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_proxy_requests_model ON proxy_requests(model, timestamp DESC) WHERE model IS NOT NULL;
