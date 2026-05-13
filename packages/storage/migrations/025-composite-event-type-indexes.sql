-- =============================================================================
-- 025 — 집계·세션·tool 통계 쿼리용 복합 인덱스 (perf pass — P1)
-- =============================================================================
-- 배경:
--   대시보드/턴뷰/요청 평면 뷰의 집계 쿼리(getRequestStats, getToolStats, getStripStats,
--   getAvgPromptDurationMs, listVisibleSessions 등)는 다음 패턴을 반복한다:
--     - WHERE type = 'tool_call' AND (event_type IS NULL OR event_type = 'tool')
--     - WHERE type = 'prompt' ORDER BY timestamp
--     - WHERE session_id = ? AND type = 'prompt' ORDER BY timestamp ASC LIMIT 1 (상관 서브쿼리)
--   기존 인덱스(idx_requests_type, idx_requests_session)는 단일 컬럼이라 위 패턴에서
--   인덱스 prefix만 잡히고, event_type 필터·정렬은 인덱스 외 작업으로 떨어진다.
--
-- 정책:
--   - 데이터 증가 시 풀스캔/임시정렬을 차단하는 구조적 안전망.
--   - partial index는 tool_call + event_type='tool' + duration_ms>0 만 인덱스화 → 인덱스 크기 최소화.
--   - IF NOT EXISTS — 멱등 보장. 마이그레이터 재실행 안전.
--
-- 변경 영향:
--   - getRequestStats, getRequestStatsByType, getToolStats, getStripStats,
--     getAvgPromptDurationMs, listVisibleSessions의 EXPLAIN QUERY PLAN이
--     'SCAN requests' → 'SEARCH requests USING INDEX' 로 전환됨.
--   - 데이터 적을 땐 체감 0, 수천~수만 행 이상에서 효과 본격화.
-- =============================================================================

-- P1-A: type + event_type + timestamp DESC 복합
-- 핵심 집계 함수(getRequestStats, getRequestStatsByType 등) 다수가 type/event_type 필터 + 최신 정렬.
-- timestamp DESC 정렬 비용도 인덱스에서 흡수.
CREATE INDEX IF NOT EXISTS idx_requests_type_event_ts
  ON requests(type, event_type, timestamp DESC);

-- P1-B: tool_call + event_type='tool' + duration_ms ASC partial
-- getStripStats P95 계산용. duration_ms ASC 정렬을 인덱스 순서 그대로 사용 → 정렬 비용 0.
-- WHERE 절이 명시적이라 인덱스 크기는 매우 작음 (tool_call+tool 행 한정).
CREATE INDEX IF NOT EXISTS idx_requests_tool_duration_partial
  ON requests(duration_ms ASC)
  WHERE type = 'tool_call' AND event_type = 'tool' AND duration_ms > 0;

-- P1-C: session_id + type + timestamp ASC
-- listVisibleSessions의 상관 서브쿼리 패턴(첫 prompt 시각 조회)에 직접 매칭.
-- 기존 idx_requests_session(session_id, timestamp DESC)은 ASC가 필요한 이 쿼리엔 부적합 — 별도 인덱스.
CREATE INDEX IF NOT EXISTS idx_requests_session_type_ts_asc
  ON requests(session_id, type, timestamp ASC);

-- ANALYZE — 옵티마이저가 새 인덱스의 카디널리티를 학습해 partial index 등을 정확히 선택하도록.
-- 인덱스 추가만으로는 통계가 없어 SQLite가 비용 산정에 보수적이라 다른 인덱스를 잘못 선택할 수 있음.
ANALYZE requests;
