-- Migration 055: kuzu_outbox Dead-Letter Queue 컬럼 — 그래프 sync HoL 블로킹 격리
--
-- Purpose:
--   049/051/053 의 outbox 는 sync worker 가 cursor 기반으로 순차 처리하는데, enrich/merge
--   단계에서 특정 row(독성 op) 하나가 반복 실패하면 cursor 가 그 앞에서 멈추고 배치 전체가
--   재시도에 갇힌다(Head-of-Line 블로킹). 누적 실패가 circuit-breaker 임계(연속 3회)를
--   넘기면 그래프가 1시간 OPEN 으로 freeze — 정상 row 까지 적재가 막힌다.
--
--   본 마이그레이션은 outbox 행에 재시도 메타를 부여해, worker 가 실패 row 를 일정 횟수
--   재시도 후 DLQ(dead=1) 로 격리하고 정상 row 의 cursor 는 계속 전진시키도록 한다.
--
-- 함께 변경되는 곳 (코드):
--   - packages/storage-graph/src/sync/merge.ts
--       · mergeOps 가 op 단위 try/catch 로 실패를 수집해 { failed } 반환 (중단 없음).
--   - packages/storage-graph/src/sync/worker.ts
--       · tick 이 batch 를 row 단위로 enrich→merge, 실패 row 는 attempts++/last_error 기록,
--         attempts >= MAX(5) 시 dead=1. cursor 는 "최저 미해결(retryable) 실패 row id 직전"
--         까지만 전진. readOutboxBatch 는 dead=0 만 읽음.
--       · getSyncWorkerStatus 에 deadLetterCount 노출.
--
-- 컬럼:
--   attempts   : merge 실패 누적 횟수. worker 가 실패 시마다 +1.
--   last_error : 마지막 실패 메시지(진단용, 길이 절단 저장).
--   dead       : 1=DLQ 격리됨(영구 skip). 0=정상/재시도 대기.
--
-- 안전성:
--   - ALTER TABLE ADD COLUMN (DEFAULT 상수) — 기존 데이터 무손실. 기존 행은 모두
--     attempts=0/dead=0 으로 초기화되어 종전과 동일하게 처리된다.
--   - migrator.ts 가 본 파일을 db.transaction 으로 감싸 원자 적용.
--   - sync worker 의 MERGE 는 여전히 idempotent — dead 격리 전까지의 재시도는 데이터 손상 0.
--
-- Rollback:
--   -- SQLite 는 DROP COLUMN 을 3.35+ 에서 지원하나, 본 컬럼들은 무해(default 0/null)하므로
--   -- 일반적으로 롤백 불필요. 필요 시:
--   --   ALTER TABLE kuzu_outbox DROP COLUMN dead;
--   --   ALTER TABLE kuzu_outbox DROP COLUMN last_error;
--   --   ALTER TABLE kuzu_outbox DROP COLUMN attempts;
--   --   DROP INDEX IF EXISTS idx_kuzu_outbox_live;

ALTER TABLE kuzu_outbox ADD COLUMN attempts   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE kuzu_outbox ADD COLUMN last_error TEXT;
ALTER TABLE kuzu_outbox ADD COLUMN dead       INTEGER NOT NULL DEFAULT 0;

-- worker 의 hot read path 는 `WHERE id > cursor AND dead = 0 ORDER BY id LIMIT 500`.
-- dead=0 행만 인덱싱하는 부분 인덱스로 DLQ 격리분이 스캔 대상에서 빠지게 한다.
CREATE INDEX IF NOT EXISTS idx_kuzu_outbox_live ON kuzu_outbox(id) WHERE dead = 0;
