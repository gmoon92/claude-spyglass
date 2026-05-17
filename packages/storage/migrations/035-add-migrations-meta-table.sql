-- =============================================================================
-- 035 — _migrations 메타테이블 신설 (마이그레이션 히스토리 SSoT)
-- =============================================================================
-- 배경 (auto-update-migration-hardening ADR-001):
--   현재 마이그레이션 적용 상태는 PRAGMA user_version 단일 정수만으로 추적된다.
--   부팅·점프 적용 판단에는 충분하나 다음 정보가 누락된다:
--     - 어떤 파일이 적용되었는가
--     - 언제 적용되었는가
--     - 적용 시점의 앱 버전은 무엇이었는가
--     - 적용에 얼마나 걸렸는가 (성능 회귀 추적)
--   운영 사고 발생 시 "어느 마이그레이션에서 무엇이 망가졌는가"를 진단할 일차 데이터 부재.
--
-- 결정:
--   - PRAGMA user_version은 빠른 조회용으로 유지 (SQLite 네이티브 패턴 보존)
--   - 본 테이블은 히스토리/감사 보강 — 적용 시점·소요·앱 버전 기록
--   - migrator는 각 마이그레이션 파일 적용 트랜잭션 안에서 INSERT 실행 (원자성 보장)
--   - 테이블명 prefix `_`는 "시스템/메타 테이블" 컨벤션
--
-- 멱등성:
--   - CREATE TABLE IF NOT EXISTS — 마이그레이터 재실행 안전
--   - legacy 백필은 INSERT OR IGNORE — 동일 version PK 중복 무시
--
-- 트랜잭션:
--   - 본 파일은 migrator.transaction() 안에서 실행됨 — 파일 내부 BEGIN/COMMIT 금지
--
-- @see packages/storage/src/migrator.ts (각 파일 적용 후 INSERT 로직)
-- @see .claude/docs/plans/auto-update-migration-hardening/adr.md ADR-001
-- =============================================================================

-- 1) 메타테이블 — 마이그레이션 적용 히스토리 (version PK)
CREATE TABLE IF NOT EXISTS _migrations (
  version     INTEGER PRIMARY KEY,                  -- 마이그레이션 번호 (= PRAGMA user_version 대응)
  filename    TEXT NOT NULL,                        -- 적용된 SQL 파일명 ('035-add-migrations-meta-table.sql' 등)
  applied_at  INTEGER NOT NULL,                     -- 적용 시각 (unix epoch seconds)
  app_version TEXT,                                 -- 적용 시점 spyglass 앱 버전 (package.json#version)
  duration_ms INTEGER                               -- 적용 소요 시간 (ms) — 성능 회귀 추적
);

-- 2) 최신 적용 행 조회 인덱스 — `/api/version`의 latestMigrationFile, lag 감지에 사용
--    applied_at DESC + version DESC로 정렬해 동일 초 단위 적용도 안정 정렬.
CREATE INDEX IF NOT EXISTS idx_migrations_applied_at_desc
  ON _migrations(applied_at DESC, version DESC);

-- 3) Legacy 백필 — 본 마이그레이션이 적용되기 전(v1~v34)에 이미 적용된 마이그레이션 기록을 채워둔다.
--    파일 단위 히스토리(filename/applied_at)는 알 수 없으므로 다음 정책으로 표기:
--      - filename = '(legacy)' — 본 마이그레이션 이전 시점 적용 표시
--      - applied_at = strftime('%s','now') — 본 백필 시점 (정확한 적용 시각은 소실)
--      - app_version = NULL, duration_ms = NULL — 불명
--    PRAGMA user_version 값까지 1..current 범위를 일괄 백필.
--    INSERT OR IGNORE로 중복 PK 방지 (재실행 안전 + 단일 점프로 첫 적용된 신규 DB도 안전 — current=0이면 시퀀스 비어 NOP).
WITH RECURSIVE seq(value) AS (
  SELECT 1
  WHERE (SELECT user_version FROM pragma_user_version) >= 1
  UNION ALL
  SELECT value + 1 FROM seq
  WHERE value < (SELECT user_version FROM pragma_user_version)
)
INSERT OR IGNORE INTO _migrations (version, filename, applied_at, app_version, duration_ms)
SELECT
  value AS version,
  '(legacy)' AS filename,
  CAST(strftime('%s','now') AS INTEGER) AS applied_at,
  NULL AS app_version,
  NULL AS duration_ms
FROM seq;
