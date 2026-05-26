-- Migration 051: kuzu_outbox AFTER UPDATE trigger — pre_tool → tool 전환 sync
-- Purpose: 049 마이그레이션은 AFTER INSERT 트리거만 등록 → PostToolUse 가 같은 행을
--          UPDATE 하는 Upsert 경로(persist.ts::mergePostToolIntoPreTool)에서 outbox 에
--          새 row 가 발행되지 않아 그래프 sync 가 PreToolUse 시점 데이터에 freeze 되는
--          이슈가 있었다.
--          본 마이그레이션은 event_type 이 'pre_tool' → 'tool' 로 바뀌는 UPDATE 만
--          정확히 capture 해 outbox 에 op='update' row 를 발행한다.
--
-- 함께 변경된 곳:
--   - packages/storage-graph/src/sync/enrich.ts
--     · enrichOutboxRow 가 row.op === 'update' 도 insert 와 동일 path 처리.
--     · enrichRequest 에서 event_type === 'pre_tool' 행은 그래프 op 0개 반환 — 강제
--       종료로 PostToolUse 가 끝내 오지 않은 미완성 행은 그래프에 적재되지 않는다.
--
-- 안전성:
--   - 본 마이그레이션도 trigger 추가만 — 기존 스키마 변경 없음, 데이터 손실 위험 0.
--   - 트리거 조건이 매우 좁다(pre_tool → tool 단방향) — 다른 모든 UPDATE 는 무영향.
--   - outbox 의 'update' op 는 049 의 CHECK 제약에서 이미 허용된 값이라 별도 변경 불필요.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_requests_pre_to_tool_outbox;

CREATE TRIGGER IF NOT EXISTS trg_requests_pre_to_tool_outbox
AFTER UPDATE OF event_type ON requests
WHEN OLD.event_type = 'pre_tool' AND NEW.event_type = 'tool'
BEGIN
  INSERT INTO kuzu_outbox(source, event_id, op)
  VALUES ('requests', CAST(NEW.id AS TEXT), 'update');
END;
