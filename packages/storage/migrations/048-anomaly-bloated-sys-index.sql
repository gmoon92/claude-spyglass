-- =============================================================================
-- 048 — getSessionSystemContextMeta 가속 인덱스 (read-perf sprint 1)
-- =============================================================================
-- 배경 (실측 — 2026-05-23, /api/requests + enrichWithAnomalies 프로파일):
--   페이지 200건 anomaly enrich 시 getSessionSystemContextMeta(session) 가 14.74ms p95
--   (세션 2개 × ~7ms). enrichWithAnomalies 전체 비용의 95% 차지.
--   EXPLAIN: SEARCH proxy_requests USING idx_proxy_requests_session_id
--           + USE TEMP B-TREE FOR ORDER BY (system_byte_size DESC, timestamp DESC).
--   원인: ORDER BY (system_byte_size DESC, timestamp DESC) 가 인덱스로 안 풀리고
--         4137 행 메모리 정렬. system_byte_size 가 큰 컬럼은 아니지만 4137 행 정렬은 부담.
--
-- 결정 — 부분 복합 인덱스:
--
-- idx_proxy_requests_session_sysbytes
--   (session_id, system_byte_size DESC, timestamp DESC)
--   WHERE system_byte_size IS NOT NULL
--
--   ORDER BY (system_byte_size DESC, timestamp DESC) + LIMIT 1 을 인덱스 끝에서 직접 회수.
--   TEMP B-TREE 제거.
--   부분 인덱스 — NULL 행 제외해 인덱스 크기 절약.
--
-- 멱등성: CREATE INDEX IF NOT EXISTS — 재실행 안전.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_proxy_requests_session_sysbytes
  ON proxy_requests(session_id, system_byte_size DESC, timestamp DESC)
  WHERE system_byte_size IS NOT NULL;

ANALYZE proxy_requests;
