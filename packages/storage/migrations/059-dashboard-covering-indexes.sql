-- =============================================================================
-- 059 — 대시보드 집계 커버링 인덱스 (read-perf, /api/dashboard 콜드 가속)
-- =============================================================================
-- 배경 (실측 — 2026-06-07, /api/dashboard 콜드 827ms 프로파일):
--   requests 는 11,214 행이지만 테이블 B-tree 81MB — payload BLOB(57MB)이 행에 인라인.
--   getToolStats / getStripStats(오류율)는 인덱스에 없는 컬럼(tokens_total, duration_ms,
--   tool_detail, tokens_confidence)을 집계하므로, 매칭된 ~8,700 tool_call 행의 풀 테이블
--   페이지를 walk → 그 페이지에 섞인 56MB BLOB 을 콜드 디스크에서 폴트인.
--   증거: SELECT COUNT(*)=0.01s(커버링) vs SELECT SUM(tokens_total)=0.17s(행 페이지 walk, 17×).
--
-- 결정 — 두 집계의 SELECT 컬럼을 leaf 에 실어 BLOB 페이지 접근 자체를 제거:
--
-- (1) idx_requests_toolstats_covering
--     ON requests(tool_name, tokens_confidence, tokens_total, duration_ms, tool_detail)
--     WHERE type='tool_call' AND tool_name IS NOT NULL AND (event_type IS NULL OR event_type='tool')
--   - getToolStats(aggregate-tool.ts:43-67) 의 WHERE 와 partial 술어가 구문 동치 →
--     옵티마이저가 채택. tool_name 선두로 GROUP BY 정렬 제공(TEMP B-TREE 제거).
--     집계 컬럼(tokens_confidence/total/duration_ms/tool_detail)을 모두 커버 → 행 페이지 미접근.
--   - getSessionToolStats / getProjectToolStats 도 동일 WHERE 골격이라 함께 수혜.
--
-- (2) idx_requests_striperr_covering
--     ON requests(tool_detail)
--     WHERE type='tool_call' AND event_type='tool'
--   - getStripStats 오류율(aggregate-strip.ts:61-77) 의 tool_detail LIKE 집계를 leaf 로 커버.
--   - tool_detail 단독 컬럼이 핵심: (event_type, tool_detail) 처럼 선두에 상수 컬럼을 두면
--     옵티마이저가 기존 idx_requests_type_event_ts(type,event_type,timestamp) 를 선호해
--     tool_detail 을 행 페이지에서 walk(=BLOB 폴트인). tool_detail 단독 partial 인덱스는
--     "SCAN USING COVERING INDEX" 로 채택되어 행 페이지 접근이 완전히 사라짐(EXPLAIN 검증 완료).
--   - P95 duration 분기는 기존 idx_requests_tool_duration_partial 이 이미 커버 → 추가 불요.
--
-- 멱등성: CREATE INDEX IF NOT EXISTS — 재실행 안전. migrator duplicate-skip 호환.
-- 안전성: 인덱스 추가만(additive). 파괴적 변경 없음. R7 비대상. 쓰기 영향 미미
--         (현 hook post p95 2-6ms 는 fsync 지배 — 인덱스 leaf 갱신 무시 가능).
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_requests_toolstats_covering
  ON requests(tool_name, tokens_confidence, tokens_total, duration_ms, tool_detail)
  WHERE type = 'tool_call'
    AND tool_name IS NOT NULL
    AND (event_type IS NULL OR event_type = 'tool');

CREATE INDEX IF NOT EXISTS idx_requests_striperr_covering
  ON requests(tool_detail)
  WHERE type = 'tool_call' AND event_type = 'tool';

ANALYZE requests;
