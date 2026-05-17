-- =============================================================================
-- 028 — stats_hourly 자동 집계 트리거 (AFTER INSERT + AFTER UPDATE)
-- =============================================================================
-- 배경 (ADR-003):
--   requests 테이블은 INSERT-only가 아니다. persist.ts의 mergePostToolIntoPreTool이
--   pre_tool 행을 tool로 UPDATE하면서 실제 토큰을 채운다. 또한 INSERT 경로가 최소
--   4개(createRequest, createRequests, persistSubagentChildren, persistAssistantTextResponses)
--   존재하여 응용층 UPSERT는 누락 위험이 크다.
--
--   본 마이그레이션은 stats_hourly 자동 집계를 DB 레이어에 캡슐화한다. 트리거는
--   raw 토큰 누적만 담당하고, 비율(hit_rate 등) 계산은 쿼리 레이어 책임이다
--   (ADR-006). 이로써 산식이 바뀌어도 트리거 변경 없이 쿼리만 수정하면 된다.
--
-- 트리거 쌍 (ADR-003):
--   - trg_stats_after_insert: pre_tool 제외, NEW 값 그대로 UPSERT
--   - trg_stats_after_update: event_type='tool' 전환 시(pre_tool → tool 머지) 델타
--     (NEW.col - OLD.col)만 더해서 INSERT 시점의 0을 보정. request_count는 손대지 않음.
--
-- 버킷 산식 (정수 시간 버킷):
--   (timestamp / 1000 / 3600) * 3600
--   requests.timestamp는 Unix milliseconds. /1000으로 초 → /3600으로 시간 인덱스 →
--   *3600으로 시간 시작 unix epoch sec. SQLite integer division 활용.
--   `datetime(..., 'start of hour')`은 표준 SQLite modifier가 아니므로 사용 금지.
--   백필(029) 및 rebuild-stats 스크립트와 동일 산식을 공유한다 (ADR-005).
--
-- 1차 가정 (T-03이 코드로 검증):
--   - cli/fix.ts, write.ts, persist.ts 등에서 model/timestamp 컬럼을 변경하는 UPDATE
--     가 발생하지 않는다. bucket 이동 케이스 미고려.
--   - 대량 DELETE 보정은 트리거가 아닌 rebuild-stats 스크립트로 처리(ADR-004).
--
-- 변경 영향:
--   - hook 인서트 핫패스에 트리거 1회 UPSERT 추가 (< 0.5ms 추정, WAL 모드 reader 미블록).
--   - 트리거 도입 직후 stats_hourly는 빈 상태. 029 백필이 기존 4,552행을 채워준다.
--   - 새 트리거는 stats_hourly에만 write하므로 requests 트리거 재귀 위험 없음
--     (SQLite recursive_triggers 기본 OFF).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- AFTER INSERT 트리거
-- -----------------------------------------------------------------------------
-- pre_tool 행(event_type='pre_tool')은 tokens=0이라 INSERT 시점 누적은 의미가 없다.
-- mergePostToolIntoPreTool이 tool로 UPDATE한 시점에 trg_stats_after_update가 처리한다.
CREATE TRIGGER IF NOT EXISTS trg_stats_after_insert
AFTER INSERT ON requests
WHEN NEW.type IS NOT NULL
  AND (NEW.event_type IS NULL OR NEW.event_type != 'pre_tool')
BEGIN
  INSERT INTO stats_hourly (
    hour_ts, model, type,
    request_count,
    tokens_input, tokens_output, tokens_total,
    cache_creation_tokens, cache_read_tokens,
    duration_ms_sum, duration_ms_count,
    updated_at
  ) VALUES (
    (NEW.timestamp / 1000 / 3600) * 3600,
    COALESCE(NEW.model, ''),
    NEW.type,
    1,
    COALESCE(NEW.tokens_input, 0),
    COALESCE(NEW.tokens_output, 0),
    COALESCE(NEW.tokens_total, 0),
    COALESCE(NEW.cache_creation_tokens, 0),
    COALESCE(NEW.cache_read_tokens, 0),
    CASE WHEN NEW.duration_ms > 0 THEN NEW.duration_ms ELSE 0 END,
    CASE WHEN NEW.duration_ms > 0 THEN 1 ELSE 0 END,
    strftime('%s','now')
  )
  ON CONFLICT(hour_ts, model, type) DO UPDATE SET
    request_count         = request_count + 1,
    tokens_input          = tokens_input + excluded.tokens_input,
    tokens_output         = tokens_output + excluded.tokens_output,
    tokens_total          = tokens_total + excluded.tokens_total,
    cache_creation_tokens = cache_creation_tokens + excluded.cache_creation_tokens,
    cache_read_tokens     = cache_read_tokens + excluded.cache_read_tokens,
    duration_ms_sum       = duration_ms_sum + excluded.duration_ms_sum,
    duration_ms_count     = duration_ms_count + excluded.duration_ms_count,
    updated_at            = strftime('%s','now');
END;

-- -----------------------------------------------------------------------------
-- AFTER UPDATE 트리거 (pre_tool → tool 첫 전환에만 발동)
-- -----------------------------------------------------------------------------
-- WHEN 조건을 (OLD.event_type='pre_tool' AND NEW.event_type='tool')로 좁혀 둔다.
-- 이유:
--   1) INSERT 트리거에서 pre_tool 행은 제외됐다 → 이 트리거가 stats에 처음으로
--      해당 row를 카운트한다 → request_count += 1이 안전.
--   2) cli/fix.ts 등의 수동 정정 UPDATE(tool → tool 재정정)는 발동되지 않아
--      이중 카운트 위험이 차단된다.
--   3) OLD가 pre_tool이므로 모든 토큰 컬럼이 0 → NEW.col - OLD.col은 NEW.col 그대로.
--      구현 단순화 가능하나, 다른 UPDATE 경로 보호 위해 안전하게 델타로 작성한다.
CREATE TRIGGER IF NOT EXISTS trg_stats_after_update
AFTER UPDATE OF
  tokens_input, tokens_output, tokens_total,
  cache_creation_tokens, cache_read_tokens,
  duration_ms
ON requests
WHEN OLD.event_type = 'pre_tool' AND NEW.event_type = 'tool'
BEGIN
  INSERT INTO stats_hourly (
    hour_ts, model, type,
    request_count,
    tokens_input, tokens_output, tokens_total,
    cache_creation_tokens, cache_read_tokens,
    duration_ms_sum, duration_ms_count,
    updated_at
  ) VALUES (
    (NEW.timestamp / 1000 / 3600) * 3600,
    COALESCE(NEW.model, ''),
    NEW.type,
    1,  -- pre_tool이 INSERT 시 제외됐으므로 여기서 처음 카운트
    COALESCE(NEW.tokens_input, 0)          - COALESCE(OLD.tokens_input, 0),
    COALESCE(NEW.tokens_output, 0)         - COALESCE(OLD.tokens_output, 0),
    COALESCE(NEW.tokens_total, 0)          - COALESCE(OLD.tokens_total, 0),
    COALESCE(NEW.cache_creation_tokens, 0) - COALESCE(OLD.cache_creation_tokens, 0),
    COALESCE(NEW.cache_read_tokens, 0)     - COALESCE(OLD.cache_read_tokens, 0),
    CASE WHEN COALESCE(NEW.duration_ms, 0) > 0 THEN NEW.duration_ms - COALESCE(OLD.duration_ms, 0) ELSE 0 END,
    CASE WHEN COALESCE(NEW.duration_ms, 0) > 0 AND COALESCE(OLD.duration_ms, 0) = 0 THEN 1 ELSE 0 END,
    strftime('%s','now')
  )
  ON CONFLICT(hour_ts, model, type) DO UPDATE SET
    request_count         = request_count + 1,
    tokens_input          = tokens_input + excluded.tokens_input,
    tokens_output         = tokens_output + excluded.tokens_output,
    tokens_total          = tokens_total + excluded.tokens_total,
    cache_creation_tokens = cache_creation_tokens + excluded.cache_creation_tokens,
    cache_read_tokens     = cache_read_tokens + excluded.cache_read_tokens,
    duration_ms_sum       = duration_ms_sum + excluded.duration_ms_sum,
    duration_ms_count     = duration_ms_count + excluded.duration_ms_count,
    updated_at            = strftime('%s','now');
END;

-- 트리거 적용 후 WAL을 즉시 메인 DB로 체크포인트 — 테스트 fixture가 db.close()를 누락하고
-- main DB 파일만 unlink하는 패턴에서 -wal/-shm 잔존으로 인한 disk I/O error를 회피.
PRAGMA wal_checkpoint(TRUNCATE);
