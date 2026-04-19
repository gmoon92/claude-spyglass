-- Migration 001: 초기 스키마 생성
-- 세션 및 요청 기본 테이블 생성
-- (WAL 모드 및 PRAGMA 설정은 connection.ts의 enableWalMode()에서 처리)

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_name TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  total_tokens INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_name);

CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('prompt', 'tool_call', 'system')),
  tool_name TEXT,
  model TEXT,
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  tokens_total INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  payload TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_requests_session ON requests(session_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_requests_type ON requests(type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_requests_tokens ON requests(tokens_total DESC);
CREATE INDEX IF NOT EXISTS idx_requests_session_type ON requests(session_id, type);
