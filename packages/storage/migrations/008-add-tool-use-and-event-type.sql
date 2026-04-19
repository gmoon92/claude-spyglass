-- Migration 008: tool_use_id와 event_type 컬럼 추가
-- tool_use_id: Pre/Post 페어링 키, event_type: pre_tool | tool | null
-- Upsert 패턴: PreToolUse → event_type='pre_tool', PostToolUse → event_type='tool'
-- 기존 데이터: id LIKE 'p-%' → event_type='pre_tool', id LIKE 't-%' → event_type='tool'

ALTER TABLE requests ADD COLUMN tool_use_id TEXT DEFAULT NULL;
ALTER TABLE requests ADD COLUMN event_type TEXT DEFAULT NULL;
UPDATE requests SET event_type = 'pre_tool' WHERE id LIKE 'p-%' AND type = 'tool_call';
UPDATE requests SET event_type = 'tool' WHERE id LIKE 't-%' AND type = 'tool_call';
CREATE INDEX IF NOT EXISTS idx_requests_tool_use_id ON requests(tool_use_id) WHERE tool_use_id IS NOT NULL;
