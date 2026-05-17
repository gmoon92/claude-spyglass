-- =============================================================================
-- 031 — stats_hourly avg_duration_ms 회귀 보완 (duration_ms_count 의미 변경)
-- =============================================================================
-- 배경:
--   030 적용 후 getRequestStats 회귀 검증에서 avg_duration_ms가 ±6ms 차이 발생.
--   원본 `AVG(duration_ms) FROM requests`는 NULL 제외 모든 행(0 포함) 평균이지만,
--   030 트리거는 duration_ms_count를 `duration_ms > 0`인 행만 카운트해 분모가 다름.
--   ADR-007 회귀 검증 기준 ±1ms 초과 → 트리거 의미를 원본과 정확히 일치시킨다.
--
-- 변경 사항:
--   - duration_ms_sum: `duration_ms > 0인 행 합산` → `NULL 제외 모든 행 합산 (0 포함)`
--   - duration_ms_count: `duration_ms > 0인 행 수` → `NULL 제외 모든 행 수`
--   - 의미: avg_duration_ms = duration_ms_sum / duration_ms_count가 정확히
--     AVG(duration_ms) FROM requests (NULL 제외)와 동일
--   - 트리거 재정의 + 백필 재실행 + build-aggregate.ts 동일 수정 (별도 코드 변경)
--
-- 영향:
--   - getRequestStats.avg_duration_ms 정확히 원본과 일치 (회귀 0)
--   - duration_ms_sum 절대값 변동 가능 (0이었던 행도 합산에 포함되지만 sum=0 영향 없음)
--   - duration_ms_count 증가 (모든 NULL 제외 행 수)
-- =============================================================================

DROP TRIGGER IF EXISTS trg_stats_after_insert;
DROP TRIGGER IF EXISTS trg_stats_after_update;

-- AFTER INSERT — duration 의미 변경 (NULL 제외 모든 행)
CREATE TRIGGER IF NOT EXISTS trg_stats_after_insert
AFTER INSERT ON requests
WHEN NEW.type IS NOT NULL
  AND (NEW.event_type IS NULL OR NEW.event_type != 'pre_tool')
BEGIN
  INSERT INTO stats_hourly (
    hour_ts, model, type, event_type,
    request_count,
    tokens_input, tokens_output, tokens_total,
    cache_creation_tokens, cache_read_tokens,
    duration_ms_sum, duration_ms_count,
    tokens_input_high_sum, tokens_output_high_sum,
    tokens_total_high_sum, tokens_high_count,
    updated_at
  ) VALUES (
    (NEW.timestamp / 1000 / 3600) * 3600,
    COALESCE(NEW.model, ''),
    NEW.type,
    COALESCE(NEW.event_type, ''),
    1,
    COALESCE(NEW.tokens_input, 0),
    COALESCE(NEW.tokens_output, 0),
    COALESCE(NEW.tokens_total, 0),
    COALESCE(NEW.cache_creation_tokens, 0),
    COALESCE(NEW.cache_read_tokens, 0),
    CASE WHEN NEW.duration_ms IS NOT NULL THEN NEW.duration_ms ELSE 0 END,
    CASE WHEN NEW.duration_ms IS NOT NULL THEN 1 ELSE 0 END,
    CASE WHEN NEW.tokens_confidence = 'high' THEN COALESCE(NEW.tokens_input, 0)  ELSE 0 END,
    CASE WHEN NEW.tokens_confidence = 'high' THEN COALESCE(NEW.tokens_output, 0) ELSE 0 END,
    CASE WHEN NEW.tokens_confidence = 'high' THEN COALESCE(NEW.tokens_total, 0)  ELSE 0 END,
    CASE WHEN NEW.tokens_confidence = 'high' THEN 1 ELSE 0 END,
    strftime('%s','now')
  )
  ON CONFLICT(hour_ts, model, type, event_type) DO UPDATE SET
    request_count          = request_count + 1,
    tokens_input           = tokens_input + excluded.tokens_input,
    tokens_output          = tokens_output + excluded.tokens_output,
    tokens_total           = tokens_total + excluded.tokens_total,
    cache_creation_tokens  = cache_creation_tokens + excluded.cache_creation_tokens,
    cache_read_tokens      = cache_read_tokens + excluded.cache_read_tokens,
    duration_ms_sum        = duration_ms_sum + excluded.duration_ms_sum,
    duration_ms_count      = duration_ms_count + excluded.duration_ms_count,
    tokens_input_high_sum  = tokens_input_high_sum + excluded.tokens_input_high_sum,
    tokens_output_high_sum = tokens_output_high_sum + excluded.tokens_output_high_sum,
    tokens_total_high_sum  = tokens_total_high_sum + excluded.tokens_total_high_sum,
    tokens_high_count      = tokens_high_count + excluded.tokens_high_count,
    updated_at             = strftime('%s','now');
END;

-- AFTER UPDATE — pre_tool → tool 첫 전환
CREATE TRIGGER IF NOT EXISTS trg_stats_after_update
AFTER UPDATE OF
  tokens_input, tokens_output, tokens_total,
  cache_creation_tokens, cache_read_tokens,
  duration_ms
ON requests
WHEN OLD.event_type = 'pre_tool' AND NEW.event_type = 'tool'
BEGIN
  INSERT INTO stats_hourly (
    hour_ts, model, type, event_type,
    request_count,
    tokens_input, tokens_output, tokens_total,
    cache_creation_tokens, cache_read_tokens,
    duration_ms_sum, duration_ms_count,
    tokens_input_high_sum, tokens_output_high_sum,
    tokens_total_high_sum, tokens_high_count,
    updated_at
  ) VALUES (
    (NEW.timestamp / 1000 / 3600) * 3600,
    COALESCE(NEW.model, ''),
    NEW.type,
    'tool',
    1,
    COALESCE(NEW.tokens_input, 0)          - COALESCE(OLD.tokens_input, 0),
    COALESCE(NEW.tokens_output, 0)         - COALESCE(OLD.tokens_output, 0),
    COALESCE(NEW.tokens_total, 0)          - COALESCE(OLD.tokens_total, 0),
    COALESCE(NEW.cache_creation_tokens, 0) - COALESCE(OLD.cache_creation_tokens, 0),
    COALESCE(NEW.cache_read_tokens, 0)     - COALESCE(OLD.cache_read_tokens, 0),
    -- duration_ms 델타: NEW.duration_ms - OLD.duration_ms (양쪽 NULL 처리)
    CASE WHEN NEW.duration_ms IS NOT NULL THEN COALESCE(NEW.duration_ms, 0) - COALESCE(OLD.duration_ms, 0) ELSE 0 END,
    -- duration_ms_count 델타: WHEN 조건이 pre→tool 첫 전환만 발동하므로 한 row당 1회만 +1.
    -- OLD가 pre_tool일 때 duration_ms는 createRequest의 기본값 0이 들어와 NULL이 아니지만,
    -- pre_tool 시점에 INSERT 트리거가 skip됐으므로 이 시점이 첫 카운트가 맞다.
    CASE WHEN NEW.duration_ms IS NOT NULL THEN 1 ELSE 0 END,
    CASE WHEN NEW.tokens_confidence = 'high' THEN COALESCE(NEW.tokens_input, 0)  - COALESCE(OLD.tokens_input, 0)  ELSE 0 END,
    CASE WHEN NEW.tokens_confidence = 'high' THEN COALESCE(NEW.tokens_output, 0) - COALESCE(OLD.tokens_output, 0) ELSE 0 END,
    CASE WHEN NEW.tokens_confidence = 'high' THEN COALESCE(NEW.tokens_total, 0)  - COALESCE(OLD.tokens_total, 0)  ELSE 0 END,
    CASE WHEN NEW.tokens_confidence = 'high' THEN 1 ELSE 0 END,
    strftime('%s','now')
  )
  ON CONFLICT(hour_ts, model, type, event_type) DO UPDATE SET
    request_count          = request_count + 1,
    tokens_input           = tokens_input + excluded.tokens_input,
    tokens_output          = tokens_output + excluded.tokens_output,
    tokens_total           = tokens_total + excluded.tokens_total,
    cache_creation_tokens  = cache_creation_tokens + excluded.cache_creation_tokens,
    cache_read_tokens      = cache_read_tokens + excluded.cache_read_tokens,
    duration_ms_sum        = duration_ms_sum + excluded.duration_ms_sum,
    duration_ms_count      = duration_ms_count + excluded.duration_ms_count,
    tokens_input_high_sum  = tokens_input_high_sum + excluded.tokens_input_high_sum,
    tokens_output_high_sum = tokens_output_high_sum + excluded.tokens_output_high_sum,
    tokens_total_high_sum  = tokens_total_high_sum + excluded.tokens_total_high_sum,
    tokens_high_count      = tokens_high_count + excluded.tokens_high_count,
    updated_at             = strftime('%s','now');
END;

-- stats_hourly 재집계 — duration 의미 변경된 트리거 적용. 백필은 별도 SQL로 처리하기보다
-- 마이그레이션 안에서 절단 후 재계산을 명시.
DELETE FROM stats_hourly;

INSERT INTO stats_hourly (
  hour_ts, model, type, event_type,
  request_count,
  tokens_input, tokens_output, tokens_total,
  cache_creation_tokens, cache_read_tokens,
  duration_ms_sum, duration_ms_count,
  tokens_input_high_sum, tokens_output_high_sum,
  tokens_total_high_sum, tokens_high_count
)
SELECT
  (timestamp / 1000 / 3600) * 3600              AS hour_ts,
  COALESCE(model, '')                            AS model,
  type                                            AS type,
  COALESCE(event_type, '')                       AS event_type,
  COUNT(*)                                       AS request_count,
  SUM(COALESCE(tokens_input, 0))                 AS tokens_input,
  SUM(COALESCE(tokens_output, 0))                AS tokens_output,
  SUM(COALESCE(tokens_total, 0))                 AS tokens_total,
  SUM(COALESCE(cache_creation_tokens, 0))        AS cache_creation_tokens,
  SUM(COALESCE(cache_read_tokens, 0))            AS cache_read_tokens,
  -- 새 의미: NULL 제외 모든 행 (0 포함)
  SUM(CASE WHEN duration_ms IS NOT NULL THEN duration_ms ELSE 0 END) AS duration_ms_sum,
  SUM(CASE WHEN duration_ms IS NOT NULL THEN 1 ELSE 0 END)           AS duration_ms_count,
  SUM(CASE WHEN tokens_confidence = 'high' THEN COALESCE(tokens_input, 0)  ELSE 0 END) AS tokens_input_high_sum,
  SUM(CASE WHEN tokens_confidence = 'high' THEN COALESCE(tokens_output, 0) ELSE 0 END) AS tokens_output_high_sum,
  SUM(CASE WHEN tokens_confidence = 'high' THEN COALESCE(tokens_total, 0)  ELSE 0 END) AS tokens_total_high_sum,
  SUM(CASE WHEN tokens_confidence = 'high' THEN 1 ELSE 0 END)                          AS tokens_high_count
FROM requests
WHERE (event_type IS NULL OR event_type != 'pre_tool')
GROUP BY hour_ts, model, type, event_type;

ANALYZE stats_hourly;

PRAGMA wal_checkpoint(TRUNCATE);
