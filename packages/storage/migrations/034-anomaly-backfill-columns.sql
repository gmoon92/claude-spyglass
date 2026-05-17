-- =============================================================================
-- 034 — proxy_requests / requests 백필 보조 인덱스 (anomaly-bloated-sys)
-- =============================================================================
-- 배경 (anomaly-bloated-sys ADR-001 / ADR-002 백필 정책):
--   bloated-sys / agent-spike 검출은 두 컬럼에 의존:
--     - proxy_requests.system_byte_size  (v022에서 이미 추가)
--     - requests.parent_tool_use_id      (v017에서 이미 추가)
--   본 마이그레이션은 CLI `spyglass analyze --backfill <date-range>` 가 누락분을
--   효율적으로 스캔할 수 있도록 보조 인덱스만 추가한다.
--
--   ※ 컬럼 추가는 v022 / v017 에서 이미 완료. 본 파일에서는 ALTER TABLE 미실행.
--      이 task는 백필 SELECT 성능 향상 목적으로 "필요한 경우" 인덱스를 추가하는 범위.
--
-- 정책:
--   - system_byte_size IS NULL 행을 빠르게 찾기 위한 partial index.
--     백필 대상 식별: `WHERE system_byte_size IS NULL AND timestamp BETWEEN ? AND ?`
--   - parent_tool_use_id 트리 조회(WITH RECURSIVE)를 위한 tool_use_id 보조 인덱스.
--     v017이 자식 → 부모 방향 인덱스를 만들었으나, agent-spike 검출은 부모 tool_use_id에서
--     출발해 자식을 펼치는 방향이므로 (tool_use_id, parent_tool_use_id) 양쪽 인덱스가 모두 유효.
--     기존 v018(cleanup) 시점에 tool_use_id 인덱스가 있는지 확인 어렵기에 IF NOT EXISTS 멱등성으로 안전.
--
-- 멱등성: CREATE INDEX IF NOT EXISTS — 마이그레이터 재실행 안전.
--
-- @see packages/storage/migrations/022-system-prompts.sql (system_byte_size 컬럼 추가)
-- @see packages/storage/migrations/017-add-parent-tool-use-id.sql (parent_tool_use_id 컬럼·인덱스)
-- @see packages/server/src/cli/analyze.ts (T-08 백필 CLI)
-- @see .claude/docs/plans/anomaly-bloated-sys/adr.md ADR-001 / ADR-002
-- =============================================================================

-- 1) system_byte_size NULL 행만 골라내는 partial index — 백필 SELECT 가속.
--    proxy_requests는 7k+ rows. NULL 행만 인덱싱하면 풀스캔 회피.
CREATE INDEX IF NOT EXISTS idx_proxy_requests_system_byte_null
  ON proxy_requests(timestamp DESC)
  WHERE system_byte_size IS NULL;

-- 2) tool_use_id 단일 인덱스 — agent-spike의 WITH RECURSIVE가 부모 tool_use_id 기준
--    자식(parent_tool_use_id = parent.tool_use_id) 조인을 빠르게 펼치도록 보조.
--    이미 v018-cleanup-and-correlation에서 추가됐을 가능성이 있으나 IF NOT EXISTS 멱등.
CREATE INDEX IF NOT EXISTS idx_requests_tool_use_id
  ON requests(tool_use_id)
  WHERE tool_use_id IS NOT NULL;

-- 3) 세션 + 타임스탬프 복합 인덱스 — 세션 단위 anomaly 계산 시 정렬·범위 스캔 가속.
CREATE INDEX IF NOT EXISTS idx_requests_session_timestamp
  ON requests(session_id, timestamp DESC);
