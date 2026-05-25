-- Migration 049: Outbox table + AFTER INSERT triggers for graph projection sync
-- Purpose: SQLite SSoT → LadybugDB graph projection 의 incremental sync 채널.
--          requests / sessions 에 새 행이 들어올 때마다 outbox 행을 누적시키고,
--          storage-graph 의 sync worker 가 200ms tick 으로 cursor 기반 폴링하여
--          Ladybug 에 idempotent MERGE.
--
-- 안전성:
--   - 이번 마이그레이션은 *append-only* 테이블 + AFTER INSERT 트리거만 추가한다.
--   - 기존 테이블 schema 변경 없음 → 데이터 손실 위험 0.
--   - storage-graph 패키지가 import 안 된 채로도 outbox 누적은 무해 (단순 INSERT).
--   - sync worker 가 모드='off' 일 때는 outbox 만 자라지만, 별도 050 마이그레이션
--     으로 trigger 제거 또는 outbox TTL purge 를 도입할 수 있다.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_requests_to_kuzu_outbox;
--   DROP TRIGGER IF EXISTS trg_sessions_to_kuzu_outbox;
--   DROP INDEX IF EXISTS idx_kuzu_outbox_id;
--   DROP TABLE IF EXISTS kuzu_outbox;
--
-- @see ${CLAUDE_PROJECT_DIR}/.claude/.tmp/plans/spyglass/graph-db-research/05-migration-strategy.md
--      §2.2 Outbox + Cursor sequence diagram.

-- =============================================================================
-- kuzu_outbox — 그래프 sync 대기열
-- =============================================================================
-- 컬럼:
--   id        : 자동 증가. sync worker 의 cursor 기준 — 항상 단조 증가.
--   source    : 어느 SQLite 테이블에서 발생한 이벤트인지. enrich 시 분기.
--   event_id  : 소스 테이블의 PK (requests.id 는 INTEGER, sessions.id 는 TEXT).
--               두 타입을 모두 수용하기 위해 TEXT 로 저장.
--   op        : 'insert' | 'update' | 'delete'. 현재는 insert 만 사용,
--               향후 update/delete trigger 도입 시 확장 여지.
--   ts        : 발생 시각 (ms). 진단/모니터링 용.
CREATE TABLE IF NOT EXISTS kuzu_outbox (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  source    TEXT NOT NULL CHECK (source IN ('requests', 'sessions')),
  event_id  TEXT NOT NULL,
  op        TEXT NOT NULL CHECK (op IN ('insert', 'update', 'delete')),
  ts        INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
);

-- worker 의 SELECT WHERE id > cursor ORDER BY id LIMIT N 패턴을 위한 인덱스.
-- PRIMARY KEY 자체가 b-tree 라 redundant 일 수 있지만, sqlite_autoindex 명시는
-- 옵티마이저가 동일 인덱스를 인지하도록 보장한다.
CREATE INDEX IF NOT EXISTS idx_kuzu_outbox_id ON kuzu_outbox(id);

-- =============================================================================
-- AFTER INSERT 트리거 — requests
-- =============================================================================
-- requests 테이블은 Spyglass 의 핵심 append-only 이벤트 로그. 모든 hook / proxy 응답
-- 이 여기로 들어온다. tool_use_id 가 NULL 인 행(metadata, prompt only 등)도 포함되어
-- enrich 단계에서 적절한 노드/엣지로 변환된다.
--
-- 주의: BEGIN…END 블록은 migrator.ts 의 splitSqlStatements 가 보존하도록 작성됐다.
--       추가 statement 가 필요하면 같은 BEGIN…END 안에 ; 로 구분.
CREATE TRIGGER IF NOT EXISTS trg_requests_to_kuzu_outbox
AFTER INSERT ON requests
BEGIN
  INSERT INTO kuzu_outbox(source, event_id, op)
  VALUES ('requests', CAST(NEW.id AS TEXT), 'insert');
END;

-- =============================================================================
-- AFTER INSERT 트리거 — sessions
-- =============================================================================
-- Session 노드 자체는 requests 트리거에서 derived 로도 만들 수 있으나, 명시적으로
-- sessions 행 자체에 trigger 를 걸어 두면 enrich 단계가 단순해진다 (requests JOIN
-- 없이 sessions row 직접 사용).
CREATE TRIGGER IF NOT EXISTS trg_sessions_to_kuzu_outbox
AFTER INSERT ON sessions
BEGIN
  INSERT INTO kuzu_outbox(source, event_id, op)
  VALUES ('sessions', NEW.id, 'insert');
END;
