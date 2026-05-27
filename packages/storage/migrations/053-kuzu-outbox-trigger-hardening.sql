-- Migration 053: kuzu_outbox 트리거 하드닝 — write 경로 격리
--
-- Purpose:
--   049/051 의 outbox 트리거는 `requests`/`sessions` 에 AFTER INSERT/UPDATE 로 붙어
--   메인 write 와 *같은 트랜잭션* 안에서 실행된다. SQLite 트리거 본문이 throw 하면
--   부모 DML(=로그 데이터 INSERT/UPDATE)이 롤백된다 → 흐름 차트 작업 중 트리거를
--   건드려 로그/대시보드 데이터가 미노출되는 회귀가 관찰됨.
--
--   본 마이그레이션은 트리거 3종을 재정의하여 outbox 쓰기가 메인 write 를 롤백하지
--   못하게 한다:
--     · INSERT OR IGNORE         — CHECK/UNIQUE/NOT NULL 제약 위반을 조용히 무시.
--     · WHEN NEW.id IS NOT NULL  — id 결손 시 트리거 자체를 건너뜀(방어적 가드).
--
-- 한계:
--   SQLite 트리거는 try/catch 가 없어 디스크풀 등 I/O 에러까지 격리하지는 못한다.
--   현실적 throw 원인은 제약 위반이므로 OR IGNORE + 가드로 충분.
--
-- 안전성:
--   트리거 정의만 교체 — 스키마/데이터 변경 0. DROP IF EXISTS 후 CREATE 라 멱등.
--
-- Rollback (049/051 정의로 복귀):
--   049/051 의 CREATE TRIGGER 문을 다시 실행.

DROP TRIGGER IF EXISTS trg_requests_to_kuzu_outbox;
CREATE TRIGGER trg_requests_to_kuzu_outbox
AFTER INSERT ON requests
WHEN NEW.id IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO kuzu_outbox(source, event_id, op)
  VALUES ('requests', CAST(NEW.id AS TEXT), 'insert');
END;

DROP TRIGGER IF EXISTS trg_sessions_to_kuzu_outbox;
CREATE TRIGGER trg_sessions_to_kuzu_outbox
AFTER INSERT ON sessions
WHEN NEW.id IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO kuzu_outbox(source, event_id, op)
  VALUES ('sessions', NEW.id, 'insert');
END;

DROP TRIGGER IF EXISTS trg_requests_pre_to_tool_outbox;
CREATE TRIGGER trg_requests_pre_to_tool_outbox
AFTER UPDATE OF event_type ON requests
WHEN OLD.event_type = 'pre_tool' AND NEW.event_type = 'tool' AND NEW.id IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO kuzu_outbox(source, event_id, op)
  VALUES ('requests', CAST(NEW.id AS TEXT), 'update');
END;
