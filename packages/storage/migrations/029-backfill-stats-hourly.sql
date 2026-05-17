-- =============================================================================
-- 029 — stats_hourly 1회 백필 (기존 requests 데이터를 사전 집계로 채움)
-- =============================================================================
-- 배경 (ADR-005):
--   028에서 트리거가 추가됐지만, 028 적용 시점 이전에 INSERT된 requests 행은
--   stats_hourly에 반영되지 않는다. 본 마이그레이션은 기존 requests 전체를 1회 집계
--   하여 stats_hourly에 채운다.
--
-- 멱등성:
--   ON CONFLICT(hour_ts, model, type) DO NOTHING — 028 적용 직후 hook insert로
--   stats_hourly에 일부 행이 이미 들어가 있는 경우(서버 미중단 시) 그 행은 보존하고
--   누락된 bucket만 채운다. 다만 부분 데이터 중복 누적은 피할 수 없으므로 안전을 위해
--   적용 전 서버를 중단할 것 (T-04 체크리스트).
--
-- 산식:
--   - 버킷: (timestamp / 1000 / 3600) * 3600  — 트리거(028)와 동일
--   - 필터: event_type IS NULL OR event_type != 'pre_tool'  — 트리거와 동일
--   본 SQL과 packages/storage/src/queries/stats/build-aggregate.ts의 SELECT 식이
--   1:1로 일치해야 한다. 둘 다 수정해야 하는 변경이 생기면 build-aggregate.ts를 진실
--   소스로 두고 본 파일을 갱신할 것.
-- =============================================================================

INSERT INTO stats_hourly (
  hour_ts, model, type,
  request_count,
  tokens_input, tokens_output, tokens_total,
  cache_creation_tokens, cache_read_tokens,
  duration_ms_sum, duration_ms_count
)
SELECT
  (timestamp / 1000 / 3600) * 3600              AS hour_ts,
  COALESCE(model, '')                            AS model,
  type                                            AS type,
  COUNT(*)                                       AS request_count,
  SUM(COALESCE(tokens_input, 0))                 AS tokens_input,
  SUM(COALESCE(tokens_output, 0))                AS tokens_output,
  SUM(COALESCE(tokens_total, 0))                 AS tokens_total,
  SUM(COALESCE(cache_creation_tokens, 0))        AS cache_creation_tokens,
  SUM(COALESCE(cache_read_tokens, 0))            AS cache_read_tokens,
  SUM(CASE WHEN duration_ms > 0 THEN duration_ms ELSE 0 END) AS duration_ms_sum,
  SUM(CASE WHEN duration_ms > 0 THEN 1 ELSE 0 END)           AS duration_ms_count
FROM requests
WHERE (event_type IS NULL OR event_type != 'pre_tool')
GROUP BY hour_ts, model, type
ON CONFLICT(hour_ts, model, type) DO NOTHING;

ANALYZE stats_hourly;

-- 적용 직후 WAL 정리 — 028과 동일한 이유 (테스트 fixture 잔존 WAL 회피).
PRAGMA wal_checkpoint(TRUNCATE);
