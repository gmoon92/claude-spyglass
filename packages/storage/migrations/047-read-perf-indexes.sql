-- =============================================================================
-- 047 — getTurnsBySession read 가속 인덱스 (read-perf sprint 1)
-- =============================================================================
-- 배경 (실측 — 2026-05-23 baseline, 5062 requests / 4137 proxy_requests 세션):
--   getTurnsBySession(session) p50=204ms p95=229ms p99=231ms.
--   EXPLAIN QUERY PLAN 진단:
--     - type='tool_call' 쿼리       : USE TEMP B-TREE FOR ORDER BY (turn_id, timestamp)
--     - type='response'  쿼리       : 동일 패턴
--     - turn summary    쿼리        : USE TEMP B-TREE FOR GROUP BY turn_id
--     - 합쳐진 SELECT (type IN ...) : LAST TERM OF ORDER BY (timestamp) TEMP B-TREE
--     - proxy_requests ROW_NUMBER × 3 : USE TEMP B-TREE FOR ORDER BY (timestamp)
--   임시 B-TREE 정렬이 핵심 비용 (큰 세션일수록 비례 증가).
--
-- 결정 — 복합 인덱스 4개 추가 (additive, 위험 0):
--
-- 1) idx_requests_session_type_turn_ts
--    (session_id, type, turn_id, timestamp ASC)
--    type 별 SELECT 가 ORDER BY (turn_id, timestamp) 를 인덱스로 충족.
--
-- 2) idx_requests_session_turn_active
--    (session_id, turn_id) WHERE turn_id IS NOT NULL
--    GROUP BY turn_id 가속 + summary 집계.
--
-- 3) idx_requests_session_turn_ts_active
--    (session_id, turn_id, timestamp) WHERE turn_id IS NOT NULL
--    type IN (...) 합쳐진 단일 SELECT 가 ORDER BY (turn_id, timestamp) 인덱스로 충족.
--    부분 인덱스로 작아짐.
--
-- 4) idx_proxy_requests_session_turn_ts
--    (session_id, turn_id, timestamp) WHERE turn_id IS NOT NULL
--    proxy_requests ROW_NUMBER OVER (PARTITION BY turn_id ORDER BY timestamp) 가 정렬 우회.
--    3 ROW_NUMBER 쿼리 (system_hash ASC / system_reminder DESC / anthropic_beta ASC) 모두 이 인덱스 활용.
--    DESC 방향은 SQLite 가 자동으로 reverse scan 처리.
--
-- 멱등성: CREATE INDEX IF NOT EXISTS — 재실행 안전.
-- ANALYZE 로 planner 가 새 인덱스를 즉시 인식하도록 통계 갱신.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_requests_session_type_turn_ts
  ON requests(session_id, type, turn_id, timestamp);

CREATE INDEX IF NOT EXISTS idx_requests_session_turn_active
  ON requests(session_id, turn_id)
  WHERE turn_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_requests_session_turn_ts_active
  ON requests(session_id, turn_id, timestamp)
  WHERE turn_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_proxy_requests_session_turn_ts
  ON proxy_requests(session_id, turn_id, timestamp)
  WHERE turn_id IS NOT NULL;

ANALYZE requests;
ANALYZE proxy_requests;
