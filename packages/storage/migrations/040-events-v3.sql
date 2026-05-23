-- =============================================================================
-- 040 — events_v3: append-only 이벤트 ledger (storage-redesign-v3 Phase 2)
-- =============================================================================
-- 배경 (.claude/docs/plans/storage-redesign-v3/redesign-plan.md R1):
--   기존 legacy 경로는 `requests` 테이블에 INSERT + UPDATE 둘 다 허용한다.
--   - PreToolUse → INSERT (event_type='pre_tool')
--   - PostToolUse → 같은 row UPDATE (event_type='tool', tokens/duration 채움)
--   이는 source-of-truth 와 query-model 역할 혼재로 CQRS 위반이며,
--   read 시점에 ACTIVE_REQUEST_FILTER_SQL 같은 우회 필터 강제 등 부작용 다수.
--
-- 결정 — events_v3 는 옵저버빌리티 단일 SoT(R1):
--   - append-only 강제. UPDATE / DELETE 트리거로 차단.
--   - event_id UNIQUE + INSERT OR IGNORE → idempotent (hook 재전송 안전).
--   - 모든 hook payload 가 하나의 테이블 row 로 통일된다.
--     event_kind 컬럼으로 구분: hook_pre_tool, hook_post_tool, hook_prompt 등.
--   - projection (request_view / turn_view / agent_chain_view) 은 본 테이블을 읽어
--     materialize 한다. projection 이 깨져도 본 테이블에서 재build 가능 (R2).
--
-- Append-only 강제 (R1):
--   - trg_events_v3_no_update : BEFORE UPDATE → RAISE(ABORT)
--   - trg_events_v3_no_delete : BEFORE DELETE → RAISE(ABORT)
--   - 둘 다 무조건 차단 — schema 레벨 방어선이라 application 우회 불가.
--
-- 인덱스 전략 (read-optimized):
--   - (session_id, timestamp): 세션별 이벤트 스트림 조회.
--   - (event_kind, timestamp): kind 별 (예: tool_use 만) 시계열 조회.
--   - (tool_use_id) WHERE NOT NULL: pre/post 페어링 조회.
--   - (id ASC): watermark traversal — projection worker 가
--     `WHERE id > last_event_id ORDER BY id LIMIT N` 형태로 배치 fetch.
--
-- 멱등성:
--   - CREATE TABLE / CREATE INDEX / CREATE TRIGGER 모두 IF NOT EXISTS.
--   - 트랜잭션은 migrator.transaction() 가 감싼다 — 파일 내 BEGIN/COMMIT 금지.
-- =============================================================================

CREATE TABLE IF NOT EXISTS events_v3 (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,         -- watermark traversal key (단조 증가 보장)
  event_id            TEXT NOT NULL UNIQUE,                       -- application-level idempotent key (hook 재전송 무시)
  session_id          TEXT NOT NULL,
  turn_id             TEXT,
  timestamp           INTEGER NOT NULL,                           -- ms epoch (legacy claude_events 와 단위 동일)
  event_kind          TEXT NOT NULL,                              -- 'hook_pre_tool' | 'hook_post_tool' | 'hook_prompt' | 'hook_response' | 'hook_system'
  tool_use_id         TEXT,                                       -- pre/post 페어링 키 (NULL 가능)
  parent_tool_use_id  TEXT,                                       -- 서브에이전트 체인 (NULL 가능)
  agent_id            TEXT,
  agent_type          TEXT,
  tool_name           TEXT,                                       -- 자주 읽는 필드는 컬럼화 (payload JSON 안에 중복 존재 OK)
  model               TEXT,
  payload_json        TEXT NOT NULL DEFAULT '{}',                 -- 전체 hook payload (raw + 정규화 결과 포함, JSON1 응용 가능)
  source              TEXT NOT NULL DEFAULT 'hook',               -- 'hook' | 'proxy' | 'cli-test'
  schema_version      INTEGER NOT NULL DEFAULT 1,
  created_at          INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
);

-- 세션별 이벤트 스트림 조회 (turn 렌더링 base)
CREATE INDEX IF NOT EXISTS idx_events_v3_session_ts
  ON events_v3(session_id, timestamp);

-- event_kind 별 시계열 조회 (예: hook_pre_tool 만)
CREATE INDEX IF NOT EXISTS idx_events_v3_kind_ts
  ON events_v3(event_kind, timestamp);

-- pre/post 페어링 + agent_chain 조회 (NULL 다수 — 부분 인덱스로 절약)
CREATE INDEX IF NOT EXISTS idx_events_v3_tool_use
  ON events_v3(tool_use_id) WHERE tool_use_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_v3_parent_tool_use
  ON events_v3(parent_tool_use_id) WHERE parent_tool_use_id IS NOT NULL;

-- watermark traversal — projection worker batch fetch
-- (id 는 PK 라 SQLite 가 자동 인덱스를 가지지만, 명시적 인덱스로 의도 표현)
CREATE INDEX IF NOT EXISTS idx_events_v3_id_asc ON events_v3(id);

-- =============================================================================
-- Append-only 강제 트리거 (R1) — schema 레벨 방어선
-- =============================================================================
-- 의도된 schema migration 자체는 트리거 회피 불가 → 본 테이블 자체에 DDL ALTER 만
-- 미래에 필요할 때 별 migration 으로 적용 (DROP TRIGGER → ALTER → CREATE TRIGGER 순).
-- =============================================================================

CREATE TRIGGER IF NOT EXISTS trg_events_v3_no_update
BEFORE UPDATE ON events_v3
BEGIN
  SELECT RAISE(ABORT, 'events_v3 is append-only — UPDATE forbidden (R1, storage-redesign-v3)');
END;

CREATE TRIGGER IF NOT EXISTS trg_events_v3_no_delete
BEFORE DELETE ON events_v3
BEGIN
  SELECT RAISE(ABORT, 'events_v3 is append-only — DELETE forbidden (R1, storage-redesign-v3)');
END;
