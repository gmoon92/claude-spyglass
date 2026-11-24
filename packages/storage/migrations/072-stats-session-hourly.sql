-- =============================================================================
-- 072 — stats_session_hourly: 세션 × 시간 × 모델 토큰 요약 (허브 요약 #2)
-- =============================================================================
-- 배경:
--   허브(weekly-worklog 등)는 세션별 토큰·캐시 적중률 일별 합계를 매번 proxy_requests 에서 훑는다.
--   기존 stats_proxy_hourly 에는 세션 차원이 없고, 원본·기존 집계는 30일 뒤 지워져 그보다 긴
--   추이가 남지 않는다.
--
-- 설계:
--   - 출처: proxy_requests(실제 API 호출 — 토큰의 단일 출처). session_id 없는 행은 제외.
--   - 시간 버킷: (timestamp/1000/3600)*3600 (기존 stats 와 같은 산식). 일 단위 저장은 UTC 로만
--     자를 수 있어 KST 일자와 어긋나므로, 일 단위 묶음은 API 가 tz 로 한다.
--   - project_name: 행이 들어올 때 sessions 에서 복사해 둔다. 세션 행은 원본 보존 30일과 함께
--     지워지므로, 365일 보존하는 요약이 프로젝트를 잃지 않게 하기 위함. 읽을 때는 sessions 가
--     살아 있으면 그쪽을 우선하고, 별칭(project_aliases)은 읽을 때 적용한다.
--   - 비용 컬럼 없음(허브 결정 — 토큰만).
--   - 갱신: proxy_requests AFTER INSERT 트리거(032 와 같은 방식). proxy_requests 는 응답 완료 후
--     한 번에 INSERT 되고, 이후 UPDATE 는 system_hash·payload 만 바꾸므로 UPDATE 트리거는 두지 않는다.
--   - DELETE 트리거 없음: 원본이 retention·archive 로 지워져도 요약은 남는다(그게 목적).
--     요약 자체의 보존은 365일 — storage queries/session/retention.ts 가 지운다.
-- =============================================================================

CREATE TABLE IF NOT EXISTS stats_session_hourly (
  hour_ts               INTEGER NOT NULL,
  session_id            TEXT    NOT NULL,
  model                 TEXT    NOT NULL DEFAULT '',
  project_name          TEXT,
  request_count         INTEGER NOT NULL DEFAULT 0,
  error_count           INTEGER NOT NULL DEFAULT 0,
  tokens_input          INTEGER NOT NULL DEFAULT 0,
  tokens_output         INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  updated_at            INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  PRIMARY KEY (hour_ts, session_id, model)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_stats_session_hourly_session
  ON stats_session_hourly(session_id, hour_ts);

CREATE TRIGGER IF NOT EXISTS trg_session_stats_after_insert
AFTER INSERT ON proxy_requests
WHEN NEW.session_id IS NOT NULL
BEGIN
  INSERT INTO stats_session_hourly (
    hour_ts, session_id, model, project_name,
    request_count, error_count,
    tokens_input, tokens_output, cache_creation_tokens, cache_read_tokens,
    updated_at
  ) VALUES (
    (NEW.timestamp / 1000 / 3600) * 3600,
    NEW.session_id,
    COALESCE(NEW.model, ''),
    (SELECT s.project_name FROM sessions s WHERE s.id = NEW.session_id),
    1,
    CASE WHEN (NEW.status_code >= 400 OR NEW.error_type IS NOT NULL) THEN 1 ELSE 0 END,
    COALESCE(NEW.tokens_input, 0),
    COALESCE(NEW.tokens_output, 0),
    COALESCE(NEW.cache_creation_tokens, 0),
    COALESCE(NEW.cache_read_tokens, 0),
    strftime('%s','now')
  )
  ON CONFLICT(hour_ts, session_id, model) DO UPDATE SET
    request_count         = request_count + 1,
    error_count           = error_count + excluded.error_count,
    tokens_input          = tokens_input + excluded.tokens_input,
    tokens_output         = tokens_output + excluded.tokens_output,
    cache_creation_tokens = cache_creation_tokens + excluded.cache_creation_tokens,
    cache_read_tokens     = cache_read_tokens + excluded.cache_read_tokens,
    project_name          = COALESCE(project_name, excluded.project_name),
    updated_at            = strftime('%s','now');
END;

-- 백필 — 현재 Hot proxy_requests 1회 집계. 테이블이 막 만들어졌을 때만 의미가 있고,
-- 재적용 시에는 ON CONFLICT DO NOTHING 으로 기존 누적값을 건드리지 않는다(멱등).
INSERT INTO stats_session_hourly (
  hour_ts, session_id, model, project_name,
  request_count, error_count,
  tokens_input, tokens_output, cache_creation_tokens, cache_read_tokens
)
SELECT
  (p.timestamp / 1000 / 3600) * 3600,
  p.session_id,
  COALESCE(p.model, ''),
  (SELECT s.project_name FROM sessions s WHERE s.id = p.session_id),
  COUNT(*),
  SUM(CASE WHEN (p.status_code >= 400 OR p.error_type IS NOT NULL) THEN 1 ELSE 0 END),
  SUM(COALESCE(p.tokens_input, 0)),
  SUM(COALESCE(p.tokens_output, 0)),
  SUM(COALESCE(p.cache_creation_tokens, 0)),
  SUM(COALESCE(p.cache_read_tokens, 0))
FROM proxy_requests p
WHERE p.session_id IS NOT NULL
GROUP BY 1, 2, 3
ON CONFLICT(hour_ts, session_id, model) DO NOTHING;
