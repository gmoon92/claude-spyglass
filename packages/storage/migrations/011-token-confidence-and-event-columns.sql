-- Migration 011: 토큰 신뢰도 추적 및 훅 이벤트 컬럼 추가
--
-- (1) requests: 토큰 신뢰도 추적
--   - tokens_confidence: 'high' (정상) | 'error' (파싱 실패)
--   - tokens_source: 'transcript' (정상 추출) | 'unavailable' (파일 없음/파싱 실패)
--
-- (2) claude_events: 훅 확장 정규화
--   27개 HOOK_EVENTS 등록 후 SessionStart/End/Stop/Task/Notification/Permission
--   이벤트의 공통 필드를 컬럼으로 승격하여 json_extract 없이 조회 가능
--   reason은 SQL 예약어 충돌 회피 위해 end_reason으로 매핑

ALTER TABLE requests ADD COLUMN tokens_confidence TEXT DEFAULT 'high';
ALTER TABLE requests ADD COLUMN tokens_source TEXT DEFAULT 'transcript';
ALTER TABLE claude_events ADD COLUMN permission_mode TEXT;
ALTER TABLE claude_events ADD COLUMN source TEXT;
ALTER TABLE claude_events ADD COLUMN end_reason TEXT;
ALTER TABLE claude_events ADD COLUMN model TEXT;
ALTER TABLE claude_events ADD COLUMN stop_hook_active INTEGER;
ALTER TABLE claude_events ADD COLUMN task_id TEXT;
ALTER TABLE claude_events ADD COLUMN task_subject TEXT;
ALTER TABLE claude_events ADD COLUMN notification_type TEXT;
