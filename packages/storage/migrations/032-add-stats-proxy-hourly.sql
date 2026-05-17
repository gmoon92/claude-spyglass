-- =============================================================================
-- 032 — stats_proxy_hourly: proxy_requests 사전 집계 SSoT
-- =============================================================================
-- 배경 (proxy-hourly ADR-001~005):
--   proxy_requests 7,499+ rows. Anthropic API 직접 프록시 레이어 (응답시간, TTFT,
--   비용, 에러 등 풍부한 측정값). 현재 통계 위젯이 proxy_requests를 직접 합산하면
--   stats-aggregation과 동일한 풀스캔 부채. stats_proxy_hourly로 사전 집계.
--
-- 차원: hour_ts + model (UNIQUE) — surrogate id PK
-- 측정값: count류 3개 + tokens 4개 + 지연 sum/count 4개 + cost_usd REAL 1개 = 12개
--
-- 트리거: AFTER INSERT만. proxy_requests UPDATE 경로는 거의 없으므로 도입 안 함
-- (ADR-002). 정정은 rebuild-stats-proxy 스크립트 패턴으로.
--
-- 백필: INSERT INTO ... SELECT (ON CONFLICT DO NOTHING) 멱등성 보장.
-- =============================================================================

CREATE TABLE IF NOT EXISTS stats_proxy_hourly (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 버킷 차원
  hour_ts                  INTEGER NOT NULL,
  model                    TEXT    NOT NULL DEFAULT '',

  -- 카운터
  request_count            INTEGER NOT NULL DEFAULT 0,
  error_count              INTEGER NOT NULL DEFAULT 0,
  stream_count             INTEGER NOT NULL DEFAULT 0,

  -- 토큰
  tokens_input             INTEGER NOT NULL DEFAULT 0,
  tokens_output            INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens    INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens        INTEGER NOT NULL DEFAULT 0,

  -- 응답 지연 (ADR-003: NULL 제외 모든 행)
  response_time_ms_sum     INTEGER NOT NULL DEFAULT 0,
  response_time_ms_count   INTEGER NOT NULL DEFAULT 0,

  -- TTFT (NULL 제외 모든 행)
  first_token_ms_sum       INTEGER NOT NULL DEFAULT 0,
  first_token_ms_count     INTEGER NOT NULL DEFAULT 0,

  -- 비용 (ADR-004: REAL 유지, 쿼리에서 ROUND)
  cost_usd_sum             REAL    NOT NULL DEFAULT 0.0,

  updated_at               INTEGER NOT NULL DEFAULT (strftime('%s','now')),

  UNIQUE (hour_ts, model)
);

CREATE INDEX IF NOT EXISTS idx_stats_proxy_hourly_ts
  ON stats_proxy_hourly(hour_ts DESC);
CREATE INDEX IF NOT EXISTS idx_stats_proxy_hourly_model_ts
  ON stats_proxy_hourly(model, hour_ts DESC);

-- AFTER INSERT 트리거 — 모든 proxy_requests INSERT를 stats에 자동 누적
CREATE TRIGGER IF NOT EXISTS trg_proxy_stats_after_insert
AFTER INSERT ON proxy_requests
BEGIN
  INSERT INTO stats_proxy_hourly (
    hour_ts, model,
    request_count,
    error_count,
    stream_count,
    tokens_input, tokens_output,
    cache_creation_tokens, cache_read_tokens,
    response_time_ms_sum, response_time_ms_count,
    first_token_ms_sum,   first_token_ms_count,
    cost_usd_sum,
    updated_at
  ) VALUES (
    (NEW.timestamp / 1000 / 3600) * 3600,
    COALESCE(NEW.model, ''),
    1,
    CASE WHEN (NEW.status_code >= 400 OR NEW.error_type IS NOT NULL) THEN 1 ELSE 0 END,
    CASE WHEN NEW.is_stream = 1 THEN 1 ELSE 0 END,
    COALESCE(NEW.tokens_input, 0),
    COALESCE(NEW.tokens_output, 0),
    COALESCE(NEW.cache_creation_tokens, 0),
    COALESCE(NEW.cache_read_tokens, 0),
    CASE WHEN NEW.response_time_ms IS NOT NULL THEN NEW.response_time_ms ELSE 0 END,
    CASE WHEN NEW.response_time_ms IS NOT NULL THEN 1 ELSE 0 END,
    CASE WHEN NEW.first_token_ms   IS NOT NULL THEN NEW.first_token_ms   ELSE 0 END,
    CASE WHEN NEW.first_token_ms   IS NOT NULL THEN 1 ELSE 0 END,
    COALESCE(NEW.cost_usd, 0.0),
    strftime('%s','now')
  )
  ON CONFLICT(hour_ts, model) DO UPDATE SET
    request_count          = request_count + 1,
    error_count            = error_count + excluded.error_count,
    stream_count           = stream_count + excluded.stream_count,
    tokens_input           = tokens_input + excluded.tokens_input,
    tokens_output          = tokens_output + excluded.tokens_output,
    cache_creation_tokens  = cache_creation_tokens + excluded.cache_creation_tokens,
    cache_read_tokens      = cache_read_tokens + excluded.cache_read_tokens,
    response_time_ms_sum   = response_time_ms_sum + excluded.response_time_ms_sum,
    response_time_ms_count = response_time_ms_count + excluded.response_time_ms_count,
    first_token_ms_sum     = first_token_ms_sum + excluded.first_token_ms_sum,
    first_token_ms_count   = first_token_ms_count + excluded.first_token_ms_count,
    cost_usd_sum           = cost_usd_sum + excluded.cost_usd_sum,
    updated_at             = strftime('%s','now');
END;

-- 백필 — 기존 proxy_requests 전체 1회 집계 (ON CONFLICT DO NOTHING 멱등)
INSERT INTO stats_proxy_hourly (
  hour_ts, model,
  request_count, error_count, stream_count,
  tokens_input, tokens_output,
  cache_creation_tokens, cache_read_tokens,
  response_time_ms_sum, response_time_ms_count,
  first_token_ms_sum,   first_token_ms_count,
  cost_usd_sum
)
SELECT
  (timestamp / 1000 / 3600) * 3600               AS hour_ts,
  COALESCE(model, '')                             AS model,
  COUNT(*)                                        AS request_count,
  SUM(CASE WHEN (status_code >= 400 OR error_type IS NOT NULL) THEN 1 ELSE 0 END) AS error_count,
  SUM(CASE WHEN is_stream = 1 THEN 1 ELSE 0 END) AS stream_count,
  SUM(COALESCE(tokens_input, 0))                  AS tokens_input,
  SUM(COALESCE(tokens_output, 0))                 AS tokens_output,
  SUM(COALESCE(cache_creation_tokens, 0))         AS cache_creation_tokens,
  SUM(COALESCE(cache_read_tokens, 0))             AS cache_read_tokens,
  SUM(CASE WHEN response_time_ms IS NOT NULL THEN response_time_ms ELSE 0 END) AS response_time_ms_sum,
  SUM(CASE WHEN response_time_ms IS NOT NULL THEN 1 ELSE 0 END)                AS response_time_ms_count,
  SUM(CASE WHEN first_token_ms   IS NOT NULL THEN first_token_ms   ELSE 0 END) AS first_token_ms_sum,
  SUM(CASE WHEN first_token_ms   IS NOT NULL THEN 1 ELSE 0 END)                AS first_token_ms_count,
  SUM(COALESCE(cost_usd, 0.0))                    AS cost_usd_sum
FROM proxy_requests
GROUP BY hour_ts, model
ON CONFLICT(hour_ts, model) DO NOTHING;

ANALYZE stats_proxy_hourly;

PRAGMA wal_checkpoint(TRUNCATE);
