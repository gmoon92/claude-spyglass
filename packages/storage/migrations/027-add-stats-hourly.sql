-- =============================================================================
-- 027 — stats_hourly: 통계 도메인 사전 집계 SSoT 테이블
-- =============================================================================
-- 배경:
--   캐시 도넛, cache-trend, dashboard summary, /api/stats/* 라우트가 매 호출마다
--   requests 테이블에 SUM/COUNT/GROUP BY 풀스캔을 수행한다. 실측 105ms (4.5K rows)는
--   현재 체감 안 되지만 hook 누적 추세상 100K+ → 1M+ 시 모든 위젯이 동일 풀스캔을
--   반복하여 기술 부채로 누적된다.
--
--   본 마이그레이션은 통계 도메인의 SSoT로 사용할 사전 집계 테이블 stats_hourly만
--   생성한다. 트리거(028)와 백필(029)은 별도 마이그레이션으로 분리한다.
--
-- 정책 (ADR-002):
--   - 차원: hour_ts(1시간 버킷) + model + type
--   - PK는 surrogate `id` AUTOINCREMENT — 향후 cwd/turn_id 같은 차원 추가 시
--     UNIQUE 제약만 갱신하면 되어 PK 변경 비용 0.
--   - UNIQUE(hour_ts, model, type) — UPSERT의 ON CONFLICT 대상.
--   - 측정값은 raw 누적만(request_count, tokens_*, cache_*, duration_*) — 비율 계산은
--     쿼리 레이어 책임(ADR-006). 산식이 바뀌어도 트리거/백필 불필요.
--   - hour_ts는 Unix epoch seconds, model은 빈 문자열 기본값(모델 미상 행 누적용).
--
-- 변경 영향:
--   - 새 테이블 + 2개 인덱스 추가. 기존 쿼리 무영향.
--   - 028이 적용되기 전까지 stats_hourly는 빈 상태로 유지. 028 트리거 도입 이후부터
--     requests 변경이 자동 반영된다.
-- =============================================================================

CREATE TABLE IF NOT EXISTS stats_hourly (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 버킷 차원
  hour_ts   INTEGER NOT NULL,              -- Unix epoch seconds, 시작 시각 (start of hour)
  model     TEXT    NOT NULL DEFAULT '',   -- requests.model (NULL은 '' 로 정규화)
  type      TEXT    NOT NULL,              -- requests.type — 'prompt' | 'tool_call' | 'response' | 'system' 등

  -- 측정값 (raw 누적)
  request_count          INTEGER NOT NULL DEFAULT 0,
  tokens_input           INTEGER NOT NULL DEFAULT 0,
  tokens_output          INTEGER NOT NULL DEFAULT 0,
  tokens_total           INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens      INTEGER NOT NULL DEFAULT 0,
  duration_ms_sum        INTEGER NOT NULL DEFAULT 0,   -- duration_ms > 0인 행의 합
  duration_ms_count      INTEGER NOT NULL DEFAULT 0,   -- duration_ms > 0인 행의 카운트 (평균/분위 근사용)

  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),

  UNIQUE (hour_ts, model, type)
);

-- 시간 범위 조회용 (cache-trend 24h, dashboard summary 최근 N시간 등)
CREATE INDEX IF NOT EXISTS idx_stats_hourly_ts
  ON stats_hourly(hour_ts DESC);

-- 모델별 시계열 조회용 (model breakdown 위젯이 추가될 때를 대비한 인덱스)
CREATE INDEX IF NOT EXISTS idx_stats_hourly_model_ts
  ON stats_hourly(model, hour_ts DESC);

ANALYZE stats_hourly;
