-- =============================================================================
-- 030 — stats_hourly에 event_type 차원 + tokens_high 컬럼 추가
-- =============================================================================
-- 배경 (stats-event-type-dim ADR-001/002/003):
--   stats-aggregation 1차에서 dashboard.summary / getRequestStats 전환이 1차 비목표
--   로 보류됐다. 이유: getRequestStats 필터(event_type='tool', 4,049건)와 stats_hourly
--   트리거 필터(event_type != 'pre_tool', 5,515건) 간 36% 의미 차이로 단순 합산
--   소스 교체 시 dashboard.summary.totalRequests 값이 즉시 회귀.
--
--   본 마이그레이션은 stats_hourly에 event_type 차원을 추가하여 쿼리 레이어에서
--   기존 필터 의미를 정확히 재현할 수 있게 한다. 또한 tokens_confidence='high' 필터
--   재현을 위해 별도 토큰 컬럼을 추가한다.
--
-- 변경 사항:
--   1. stats_hourly 재생성 (SQLite UNIQUE 제약 변경 불가 → 테이블 재생성 패턴)
--      - UNIQUE: (hour_ts, model, type) → (hour_ts, model, type, event_type)
--      - 신규 컬럼: event_type, tokens_input_high_sum, tokens_output_high_sum,
--        tokens_total_high_sum, tokens_high_count
--   2. 028 트리거 DROP + 신규 트리거 CREATE (event_type 컬럼 + tokens_high 누적)
--   3. requests에서 완전 백필 (ON CONFLICT DO NOTHING, GROUP BY에 event_type 추가)
--
-- 단일 트랜잭션 보장:
--   migrator.ts가 nonPragmaStmts를 db.transaction()으로 감싸므로 본 파일의 DDL/DML은
--   원자적으로 적용된다. PRAGMA wal_checkpoint만 트랜잭션 밖에서 별도 실행.
--
-- 회귀 0:
--   기존 stats_hourly rows(178개)는 event_type을 합산해놓은 상태라 분해 정보가
--   소실됐다. 따라서 절단 후 requests에서 완전 재집계 (ADR-002).
-- =============================================================================

-- 1) 028 트리거 제거 — 마이그레이션 중 stats_hourly 변경에 트리거가 발동되지 않도록
DROP TRIGGER IF EXISTS trg_stats_after_insert;
DROP TRIGGER IF EXISTS trg_stats_after_update;

-- 2) 신규 테이블 — event_type 차원 + tokens_high 4개 컬럼
CREATE TABLE stats_hourly_v2 (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 버킷 차원
  hour_ts    INTEGER NOT NULL,
  model      TEXT    NOT NULL DEFAULT '',
  type       TEXT    NOT NULL,
  event_type TEXT    NOT NULL DEFAULT '',   -- COALESCE(event_type, '') 정규화

  -- 측정값 (raw 누적)
  request_count          INTEGER NOT NULL DEFAULT 0,
  tokens_input           INTEGER NOT NULL DEFAULT 0,
  tokens_output          INTEGER NOT NULL DEFAULT 0,
  tokens_total           INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens      INTEGER NOT NULL DEFAULT 0,
  duration_ms_sum        INTEGER NOT NULL DEFAULT 0,
  duration_ms_count      INTEGER NOT NULL DEFAULT 0,

  -- tokens_confidence='high' 필터 재현용 (ADR-003)
  tokens_input_high_sum  INTEGER NOT NULL DEFAULT 0,
  tokens_output_high_sum INTEGER NOT NULL DEFAULT 0,
  tokens_total_high_sum  INTEGER NOT NULL DEFAULT 0,
  tokens_high_count      INTEGER NOT NULL DEFAULT 0,

  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),

  UNIQUE (hour_ts, model, type, event_type)
);

-- 3) 기존 테이블 DROP + RENAME (절단 후 재집계라 데이터 이전 안 함)
DROP TABLE stats_hourly;
ALTER TABLE stats_hourly_v2 RENAME TO stats_hourly;

-- 4) 인덱스 (027과 동일 명명 규칙)
CREATE INDEX IF NOT EXISTS idx_stats_hourly_ts
  ON stats_hourly(hour_ts DESC);
CREATE INDEX IF NOT EXISTS idx_stats_hourly_model_ts
  ON stats_hourly(model, hour_ts DESC);
CREATE INDEX IF NOT EXISTS idx_stats_hourly_event_type
  ON stats_hourly(event_type, hour_ts DESC);

-- 5) 신규 AFTER INSERT 트리거 — event_type 컬럼 + tokens_high 누적
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
    CASE WHEN NEW.duration_ms > 0 THEN NEW.duration_ms ELSE 0 END,
    CASE WHEN NEW.duration_ms > 0 THEN 1 ELSE 0 END,
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

-- 6) 신규 AFTER UPDATE 트리거 — pre_tool → tool 첫 전환에만 발동
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
    'tool',                              -- pre_tool → tool 전환 완료 시점 고정
    1,                                   -- pre_tool은 INSERT에서 skip됐으므로 여기서 첫 카운트
    COALESCE(NEW.tokens_input, 0)          - COALESCE(OLD.tokens_input, 0),
    COALESCE(NEW.tokens_output, 0)         - COALESCE(OLD.tokens_output, 0),
    COALESCE(NEW.tokens_total, 0)          - COALESCE(OLD.tokens_total, 0),
    COALESCE(NEW.cache_creation_tokens, 0) - COALESCE(OLD.cache_creation_tokens, 0),
    COALESCE(NEW.cache_read_tokens, 0)     - COALESCE(OLD.cache_read_tokens, 0),
    CASE WHEN COALESCE(NEW.duration_ms, 0) > 0 THEN NEW.duration_ms - COALESCE(OLD.duration_ms, 0) ELSE 0 END,
    CASE WHEN COALESCE(NEW.duration_ms, 0) > 0 AND COALESCE(OLD.duration_ms, 0) = 0 THEN 1 ELSE 0 END,
    -- tokens_high — UPDATE 시점에 NEW.tokens_confidence를 평가. pre_tool 시점엔 보통 high가 아님.
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

-- 7) 완전 백필 — event_type 차원 + tokens_high 컬럼 포함
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
  SUM(CASE WHEN duration_ms > 0 THEN duration_ms ELSE 0 END) AS duration_ms_sum,
  SUM(CASE WHEN duration_ms > 0 THEN 1 ELSE 0 END)           AS duration_ms_count,
  SUM(CASE WHEN tokens_confidence = 'high' THEN COALESCE(tokens_input, 0)  ELSE 0 END) AS tokens_input_high_sum,
  SUM(CASE WHEN tokens_confidence = 'high' THEN COALESCE(tokens_output, 0) ELSE 0 END) AS tokens_output_high_sum,
  SUM(CASE WHEN tokens_confidence = 'high' THEN COALESCE(tokens_total, 0)  ELSE 0 END) AS tokens_total_high_sum,
  SUM(CASE WHEN tokens_confidence = 'high' THEN 1 ELSE 0 END)                          AS tokens_high_count
FROM requests
WHERE (event_type IS NULL OR event_type != 'pre_tool')
GROUP BY hour_ts, model, type, event_type;

ANALYZE stats_hourly;

-- 트리거 적용 후 WAL 정리 (028과 동일 — 테스트 fixture 잔존 WAL 회피)
PRAGMA wal_checkpoint(TRUNCATE);
