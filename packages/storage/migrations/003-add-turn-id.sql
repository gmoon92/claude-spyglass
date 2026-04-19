-- Migration 003: turn_id 컬럼 추가 및 데이터 채워넣기
-- requests 테이블에 turn_id 컬럼 추가 및 기존 데이터에 turn 번호 매기기
-- turn_id 포맷: "<session_id>-T<순번>" (예: "abc123-T1")

ALTER TABLE requests ADD COLUMN turn_id TEXT;
CREATE INDEX IF NOT EXISTS idx_requests_turn ON requests(turn_id);

UPDATE requests
SET turn_id = session_id || '-T' || ((
  SELECT COUNT(*)
  FROM requests r2
  WHERE r2.session_id = requests.session_id
    AND r2.type = 'prompt'
    AND r2.timestamp < requests.timestamp
) + 1)
WHERE type = 'prompt';

UPDATE requests
SET turn_id = (
  SELECT r2.turn_id
  FROM requests r2
  WHERE r2.session_id = requests.session_id
    AND r2.type = 'prompt'
    AND r2.timestamp <= requests.timestamp
  ORDER BY r2.timestamp DESC
  LIMIT 1
)
WHERE type IN ('tool_call', 'system')
  AND turn_id IS NULL;
