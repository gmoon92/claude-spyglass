-- Migration 012: 타임스탐프 인덱스 및 visible_requests VIEW 생성
--
-- - timestamp 단독 인덱스 추가: 시간 범위 조회 최적화
-- - visible_requests VIEW 생성: pre_tool 필터링 로직 캡슐화
--   쿼리에서 중복되는 필터 조건을 제거하고 VIEW로 통일

CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp DESC);

DROP VIEW IF EXISTS visible_requests;
CREATE VIEW visible_requests AS
SELECT * FROM requests
WHERE event_type IS NULL
   OR event_type != 'pre_tool'
   OR tool_name = 'Agent';
