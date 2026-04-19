-- Migration 006: claude_events 테이블 생성
-- raw 훅 페이로드를 전체 수집하기 위한 claude_events 테이블 생성

CREATE TABLE IF NOT EXISTS claude_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    session_id TEXT NOT NULL,
    transcript_path TEXT,
    cwd TEXT,
    agent_id TEXT,
    agent_type TEXT,
    timestamp INTEGER NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    schema_version INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_events_session_time ON claude_events(session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_events_type_time ON claude_events(event_type, timestamp);
