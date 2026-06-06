-- =============================================================================
-- 058 — claude_events 글로벌 최신순 인덱스 (read-perf, /api/events 가속)
-- =============================================================================
-- 배경 (실측 — 2026-06-07, /api/events?limit=50 프로파일):
--   콜드 327ms / 웜에서도 풀스캔. EXPLAIN:
--     SCAN claude_events + USE TEMP B-TREE FOR ORDER BY (timestamp DESC)
--   원인: getRecentEvents 의 무필터 글로벌 `ORDER BY timestamp DESC LIMIT ?` 가
--         인덱스를 못 탄다. 기존 인덱스는 (session_id, timestamp)·(event_type, timestamp)
--         복합뿐이라 선두 컬럼 없는 글로벌 정렬에는 쓸 수 없어 13,861 행 풀스캔 후
--         TEMP B-TREE 정렬. payload BLOB 하이드레이션까지 겹쳐 콜드 폴트인.
--
-- 결정 — 단독 timestamp 내림차순 인덱스:
--
-- idx_events_timestamp  ON claude_events(timestamp DESC)
--
--   `ORDER BY timestamp DESC LIMIT N` 을 인덱스 역방향 N 행 seek 로 충족.
--   SCAN + TEMP B-TREE 제거. payload 제외 시 6ms 실측 근거 → 327ms → 10ms대 기대.
--
-- 멱등성: CREATE INDEX IF NOT EXISTS — 재실행 안전. migrator duplicate-skip 호환.
-- 안전성: 인덱스 추가만(additive). 파괴적 변경 없음. R7 비대상.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_events_timestamp
  ON claude_events(timestamp DESC);

ANALYZE claude_events;
