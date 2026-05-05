-- Migration 016: requests.type CHECK 제약에 'response' 추가
--
-- Stop 훅 이벤트의 last_assistant_message를 requests 테이블에 저장하기 위해
-- type 컬럼이 'response' 값을 허용하도록 CHECK 제약을 확장.
--
-- SQLite는 ALTER TABLE로 CHECK 제약 변경을 지원하지 않으므로 테이블 재생성 방식 사용.
-- migrator.ts가 트랜잭션으로 감싸 원자적으로 적용함.
--
-- 버전 014→016 사유:
--   다른 워크트리(proxy_requests)에서 014/015를 선점하여 운영 DB user_version=15 상태.
--   migrator.ts는 currentVersion 이하 마이그레이션을 skip하므로 014로 두면
--   운영 환경에서 영구히 적용되지 않음. 016으로 올려 정합성 확보.
--
-- ADR: ${CLAUDE_PROJECT_DIR}/.claude/docs/plans/subagent-children/adr.md
--   (response-collect ADR 통합)

-- 고아 requests 정리: sessions에 없는 session_id를 가진 행은 FOREIGN KEY 제약 위반이므로 사전 삭제
DELETE FROM requests WHERE session_id NOT IN (SELECT id FROM sessions);

ALTER TABLE requests RENAME TO requests_old_v013;

CREATE TABLE requests (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('prompt', 'tool_call', 'system', 'response')),
  tool_name TEXT,
  tool_detail TEXT,
  turn_id TEXT,
  model TEXT,
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  tokens_total INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  payload TEXT,
  source TEXT,
  cache_creation_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  preview TEXT,
  tool_use_id TEXT,
  event_type TEXT,
  tokens_confidence TEXT DEFAULT 'high',
  tokens_source TEXT DEFAULT 'transcript',
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

INSERT INTO requests (
  id, session_id, timestamp, type, tool_name, tool_detail, turn_id, model,
  tokens_input, tokens_output, tokens_total, duration_ms, payload, source,
  cache_creation_tokens, cache_read_tokens, preview, tool_use_id, event_type,
  tokens_confidence, tokens_source, created_at
)
SELECT
  id, session_id, timestamp, type, tool_name, tool_detail, turn_id, model,
  tokens_input, tokens_output, tokens_total, duration_ms, payload, source,
  cache_creation_tokens, cache_read_tokens, preview, tool_use_id, event_type,
  tokens_confidence, tokens_source, created_at
FROM requests_old_v013;

DROP TABLE requests_old_v013;

-- 인덱스 재생성
CREATE INDEX IF NOT EXISTS idx_requests_session      ON requests(session_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_requests_type         ON requests(type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_requests_tokens       ON requests(tokens_total DESC);
CREATE INDEX IF NOT EXISTS idx_requests_session_type ON requests(session_id, type);
CREATE INDEX IF NOT EXISTS idx_requests_timestamp    ON requests(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_requests_tool_use_id  ON requests(tool_use_id);

-- visible_requests VIEW 재생성 (테이블 재생성 시 VIEW가 잠재적으로 무효화되므로 명시적으로 재생성)
DROP VIEW IF EXISTS visible_requests;
CREATE VIEW visible_requests AS
SELECT * FROM requests
WHERE event_type IS NULL
   OR event_type != 'pre_tool'
   OR tool_name = 'Agent';
