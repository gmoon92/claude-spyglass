# Spyglass SQLite 스키마 레퍼런스

**파일**: `packages/storage/src/schema.ts`  
**DB 경로**: `~/.spyglass/spyglass.db` (env: `SPYGLASS_DB_PATH`)  
**현재 버전**: v7

---

## PRAGMA 설정

```sql
PRAGMA journal_mode = WAL;      -- 동시 읽기/쓰기
PRAGMA busy_timeout = 5000;     -- 잠금 5초 대기
PRAGMA synchronous = NORMAL;    -- 성능 vs 안정성 균형
PRAGMA cache_size = -64000;     -- 64MB 페이지 캐시
PRAGMA foreign_keys = ON;       -- FK 제약 활성화
```

---

## 테이블 DDL

### sessions

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT    PRIMARY KEY,
  project_name TEXT   NOT NULL,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  total_tokens INTEGER DEFAULT 0,
  created_at  INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_sessions_started_at ON sessions(started_at DESC);
CREATE INDEX idx_sessions_project    ON sessions(project_name);
```

### requests

```sql
CREATE TABLE IF NOT EXISTS requests (
  id          TEXT    PRIMARY KEY,
  session_id  TEXT    NOT NULL,
  timestamp   INTEGER NOT NULL,
  type        TEXT    NOT NULL CHECK (type IN ('prompt', 'tool_call', 'system')),
  tool_name   TEXT,
  tool_detail TEXT,                        -- v2
  turn_id     TEXT,                        -- v3
  model       TEXT,
  tokens_input   INTEGER DEFAULT 0,
  tokens_output  INTEGER DEFAULT 0,
  tokens_total   INTEGER DEFAULT 0,
  duration_ms    INTEGER DEFAULT 0,
  payload     TEXT,
  source      TEXT,                        -- v4
  cache_creation_tokens INTEGER DEFAULT 0, -- v5
  cache_read_tokens     INTEGER DEFAULT 0, -- v5
  preview     TEXT,                        -- v7
  created_at  INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_requests_session      ON requests(session_id, timestamp DESC);
CREATE INDEX idx_requests_type         ON requests(type, timestamp DESC);
CREATE INDEX idx_requests_tokens       ON requests(tokens_total DESC);
CREATE INDEX idx_requests_session_type ON requests(session_id, type);
CREATE INDEX idx_requests_turn         ON requests(turn_id);
```

### claude_events (v6)

```sql
CREATE TABLE IF NOT EXISTS claude_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id       TEXT    NOT NULL UNIQUE,
  event_type     TEXT    NOT NULL,
  session_id     TEXT    NOT NULL,
  transcript_path TEXT,
  cwd            TEXT,
  agent_id       TEXT,
  agent_type     TEXT,
  timestamp      INTEGER NOT NULL,
  payload        TEXT    NOT NULL DEFAULT '{}',
  schema_version INTEGER DEFAULT 1
);

CREATE INDEX idx_events_session_time ON claude_events(session_id, timestamp);
CREATE INDEX idx_events_type_time    ON claude_events(event_type, timestamp);
```

---

## 마이그레이션 코드 패턴

```typescript
// packages/storage/src/schema.ts
export const SCHEMA_VERSION = 7;

export function runMigrations(db: Database): void {
  const version = db.pragma('user_version', { simple: true }) as number;

  if (version < 2) {
    db.exec(`ALTER TABLE requests ADD COLUMN tool_detail TEXT`);
    db.pragma('user_version = 2');
  }
  if (version < 3) {
    db.exec(`ALTER TABLE requests ADD COLUMN turn_id TEXT`);
    // 기존 데이터 소급: prompt 순번으로 turn_id 생성
    db.pragma('user_version = 3');
  }
  if (version < 4) {
    db.exec(`ALTER TABLE requests ADD COLUMN source TEXT`);
    db.pragma('user_version = 4');
  }
  if (version < 5) {
    db.exec(`ALTER TABLE requests ADD COLUMN cache_creation_tokens INTEGER DEFAULT 0`);
    db.exec(`ALTER TABLE requests ADD COLUMN cache_read_tokens INTEGER DEFAULT 0`);
    db.pragma('user_version = 5');
  }
  if (version < 6) {
    db.exec(`CREATE TABLE IF NOT EXISTS claude_events (...)`);
    db.pragma('user_version = 6');
  }
  if (version < 7) {
    db.exec(`ALTER TABLE requests ADD COLUMN preview TEXT`);
    db.pragma('user_version = 7');
  }
  // 다음 마이그레이션: if (version < 8) { ... }
}
```

---

## 주요 집계 쿼리

### 프로젝트별 세션 통계
```sql
SELECT project_name,
       COUNT(*) as session_count,
       SUM(total_tokens) as total_tokens,
       AVG(total_tokens) as avg_tokens,
       MAX(started_at) as last_active
FROM sessions
GROUP BY project_name
ORDER BY total_tokens DESC;
```

### 도구별 사용 통계
```sql
SELECT tool_name,
       COUNT(*) as call_count,
       SUM(tokens_total) as total_tokens,
       AVG(duration_ms) as avg_duration_ms
FROM requests
WHERE type = 'tool_call' AND tool_name IS NOT NULL
GROUP BY tool_name
ORDER BY call_count DESC;
```

### 시간별 요청 분포
```sql
SELECT strftime('%H', datetime(timestamp/1000, 'unixepoch')) as hour,
       COUNT(*) as request_count,
       SUM(tokens_total) as total_tokens
FROM requests
GROUP BY hour
ORDER BY hour;
```

### 턴별 그룹핑 (turn_id)
```sql
SELECT turn_id,
       COUNT(*) as event_count,
       SUM(tokens_total) as turn_tokens,
       MIN(timestamp) as started,
       MAX(timestamp) as ended
FROM requests
WHERE session_id = ? AND turn_id IS NOT NULL
GROUP BY turn_id
ORDER BY started;
```

### 캐시 효율성 분석
```sql
SELECT
  SUM(cache_read_tokens) as cache_hits,
  SUM(cache_creation_tokens) as cache_misses,
  SUM(tokens_input) as total_input,
  ROUND(100.0 * SUM(cache_read_tokens) / NULLIF(SUM(tokens_input), 0), 1) as cache_hit_rate
FROM requests
WHERE type = 'prompt';
```
