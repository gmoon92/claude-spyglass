-- =============================================================================
-- 033 — anomaly_thresholds: bloated-sys / agent-spike 임계 정책 SSoT
-- =============================================================================
-- 배경 (anomaly-bloated-sys ADR-001, ADR-004):
--   현행 anomaly 로직은 system 프롬프트가 모델 컨텍스트 윈도우의 큰 비율을 점유해도
--   감지하지 못한다. 모델별 윈도우 차이(200K / 1M)를 반영하려면 임계를 **윈도우 비율**로
--   두어야 하며, 프로젝트·모델별 운영 데이터를 보고 SQL/CLI로 즉시 튜닝 가능해야 한다.
--
-- 정책 (ADR-001 / ADR-002):
--   - bloated-sys: warn = 윈도우의 15%, critical = 25%
--   - agent-spike: (자식합 ≥ 윈도우 15%) AND (자식합 / 부모 ≥ 10×)
--     → 동일 warn_pct(15) 임계를 두 anomaly가 공유. critical_pct는 bloated-sys 전용.
--
-- 우선순위 (ADR-004) — server/src/anomaly-thresholds.ts에서 적용:
--   1) project_id + model_id 둘 다 일치
--   2) project_id 일치 (model_id IS NULL 또는 '*')
--   3) model_id 일치 (project_id IS NULL 또는 '*')
--   4) 전역(NULL/NULL 또는 '*'/'*') 폴백
--
-- 캐시: server/src/anomaly-thresholds.ts가 첫 호출 시 1회 로드 → 인메모리 보존.
--       운영자가 SQL로 시드를 갱신하고 즉시 반영을 원하면 invalidateAnomalyThresholdsCache().
--
-- 멱등성: CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE — 마이그레이터 재실행 안전.
--
-- @see packages/server/src/anomaly-thresholds.ts (조회·캐시 유틸 — model-limits.ts 패턴 미러)
-- @see packages/server/src/metrics/calculators/anomaly.ts (bloated-sys / agent-spike 검출)
-- @see .claude/docs/plans/anomaly-bloated-sys/adr.md ADR-001, ADR-004
-- =============================================================================

CREATE TABLE IF NOT EXISTS anomaly_thresholds (
  -- 전역 폴백은 '*' 와일드카드로 표현 (ADR-004).
  -- TEXT '*' / 구체 값(project / 모델 패턴)로 분기. NULL은 사용 안 함 → 우선순위 비교 단순.
  project_id    TEXT NOT NULL DEFAULT '*',
  model_id      TEXT NOT NULL DEFAULT '*',

  -- 윈도우 비율 임계 (정수 percentage; 15 = 15%).
  -- INTEGER로 두는 이유: 0~100 범위라 REAL이 불필요, SQL 비교가 직관적.
  warn_pct      INTEGER NOT NULL,
  critical_pct  INTEGER NOT NULL,

  notes         TEXT,
  updated_at    INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),

  PRIMARY KEY (project_id, model_id)
);

-- 기본 시드 — 모든 프로젝트·모든 모델 적용 (ADR-001 채택값 15 / 25).
INSERT OR IGNORE INTO anomaly_thresholds (project_id, model_id, warn_pct, critical_pct, notes) VALUES
  ('*', '*', 15, 25, 'ADR-001 default — system bloat warn=15%, critical=25%');
