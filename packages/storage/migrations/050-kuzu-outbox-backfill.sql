-- Migration 050: Backfill kuzu_outbox with historical sessions / requests
--
-- Purpose:
--   049 가 도입한 트리거는 AFTER INSERT 만이라, 도입 *이전* 에 누적된 historical
--   sessions / requests 는 outbox 에 영원히 등장하지 않고, 결과적으로 그래프 DB
--   (LadybugDB) 가 비어 있는 상태로 남는다. 본 마이그레이션은 한 번만 실행되어
--   누락된 모든 row 를 outbox 에 채워 sync worker 가 cursor 기반으로 순차 처리하게
--   한다.
--
-- 안전성:
--   - INSERT 시 049 와 동일한 (source, event_id, op) 트리플을 사용해 enrich 측 분기가
--     일관되게 유지된다. `op='insert'` 로 통일 — 049 트리거도 동일.
--   - NOT EXISTS 절로 *outbox 에 이미 있는 행은 skip*. 049 트리거가 한 번이라도 작동했다면
--     해당 row 는 이미 outbox 에 있으므로 본 마이그레이션이 중복 추가하지 않는다.
--   - sync worker 의 Cypher MERGE 자체도 idempotent 라 중복 outbox 행이 들어가도
--     데이터 손상은 없지만, outbox 크기와 worker 부하를 줄이려 NOT EXISTS 필터링.
--   - `_migrations` 메타테이블이 본 파일을 *단 한 번만* 실행함을 보장 — 재실행 위험 0.
--
-- 성능 (사용자 측정 기준):
--   - sessions: 수십 행 — 무시할 비용.
--   - requests: 본 환경 11,198 행. (source, event_id) 인덱스 없으면 NOT EXISTS 가
--     매우 느려 위쪽에서 인덱스 추가. 대형 환경(수백만 행) 에서도 동일하게 작동.
--
-- 결과:
--   부팅 시 자동 실행 → outbox 에 historical row 추가 → 그래프 sync worker 가 다음
--   tick 부터 BATCH_LIMIT=500 씩 처리. 200ms tick × 500 = 초당 ~2,500 row.
--   100만 행 기준 ~7 분 백그라운드 적재. 사용자 인터랙션 봉쇄 없음.
--
-- Rollback:
--   본 마이그레이션은 데이터를 *추가* 만 한다. 롤백 시:
--     DELETE FROM kuzu_outbox WHERE id > <pre-050-max-id>;
--   다만 일반적으로 outbox 는 throw-away 캐시 큐 — 롤백 필요성이 낮다.

-- =============================================================================
-- 1) NOT EXISTS 서브쿼리 성능 보장용 복합 인덱스
-- =============================================================================
-- 049 는 (id) 인덱스만 정의해, source/event_id 로 lookup 시 풀스캔 가능. backfill 의
-- NOT EXISTS 절이 모든 source row 마다 outbox 전체를 훑게 되므로 N×M 복잡도. 본
-- 인덱스로 O(N log M) 로 떨어뜨린다. 이후 sync worker 의 `id > cursor` 패턴에는
-- 이 인덱스가 사용되지 않고, 049 의 (id) 인덱스가 계속 활용된다.
CREATE INDEX IF NOT EXISTS idx_kuzu_outbox_source_event ON kuzu_outbox(source, event_id);

-- =============================================================================
-- 2) sessions backfill
-- =============================================================================
-- 그래프의 Session 노드 1개 ↔ SQLite sessions 1행. enrich 가 SELECT 로 직접 row 를
-- 읽어 Session props 를 채우므로, source row 가 살아있는 한 항상 정확한 적재.
INSERT INTO kuzu_outbox(source, event_id, op)
SELECT 'sessions', s.id, 'insert'
  FROM sessions s
 WHERE NOT EXISTS (
   SELECT 1 FROM kuzu_outbox o
    WHERE o.source = 'sessions' AND o.event_id = s.id
 );

-- =============================================================================
-- 3) requests backfill
-- =============================================================================
-- 그래프의 Event / ToolCall / Turn / Agent / MetaDocument / USES 모두 *requests*
-- row 에서 파생된다 (enrich.ts::enrichRequest). 따라서 requests backfill 이 본 마이그
-- 레이션의 *주된 목적* — flow 차트 시각화가 historical 데이터까지 커버하게 만든다.
INSERT INTO kuzu_outbox(source, event_id, op)
SELECT 'requests', r.id, 'insert'
  FROM requests r
 WHERE NOT EXISTS (
   SELECT 1 FROM kuzu_outbox o
    WHERE o.source = 'requests' AND o.event_id = r.id
 );
