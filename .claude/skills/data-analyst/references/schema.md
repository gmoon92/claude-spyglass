# Spyglass SQLite 스키마 레퍼런스

**파일**: `packages/storage/src/schema.ts`  
**DB 경로**: `~/.spyglass/spyglass.db` (env: `SPYGLASS_DB_PATH`)  
**현재 버전**: v11

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

## ERD

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│    sessions     │         │    requests     │         │ claude_events   │
├─────────────────┤         ├─────────────────┤         ├─────────────────┤
│ PK id           │◄────────┤ FK session_id   │         │ PK id           │
│    project_name │         │    type         │         │    event_id     │
│    started_at   │         │    tool_name    │         │    event_type   │
│    ended_at     │         │    tool_detail  │         │    session_id   │
│    total_tokens │         │    tokens_*     │         │    timestamp    │
│    created_at   │         │    duration_ms  │         │    payload      │
└─────────────────┘         │    payload      │         └─────────────────┘
                            │    ...          │
                            └─────────────────┘
```

---

## 테이블 DDL

### sessions

| 목적 | Claude Code 세션 단위 추적 |
|------|--------------------------|
| 레코드 수 (참고) | 20개 |
| 주요 프로젝트 (참고) | claude-spyglass(16), rv-iso(3) |

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

**컬럼 상세**

| 컬럼명 | 타입 | 제약조건 | 설명 |
|--------|------|----------|------|
| `id` | TEXT | PRIMARY KEY | 세션 고유 ID (Claude Code에서 생성) |
| `project_name` | TEXT | NOT NULL | 프로젝트명 (cwd의 basename) |
| `started_at` | INTEGER | NOT NULL | 세션 시작 시간 (Unix ms) |
| `ended_at` | INTEGER | NULL | 세션 종료 시간 (NULL = 활성 세션) |
| `total_tokens` | INTEGER | DEFAULT 0 | 세션 누적 토큰 수 |
| `created_at` | INTEGER | DEFAULT | 레코드 생성 시간 (Unix seconds) |

**관계**: 1:N → `requests`, 1:N → `claude_events`  
**참고**: 세션 종료는 `SessionEnd` 또는 `Stop` 훅으로 감지

---

### requests

| 목적 | 개별 요청/도구 호출 상세 기록 |
|------|------------------------------|
| 레코드 수 (참고) | 3,527개 |
| 요청 타입 분포 (참고) | tool_call(97.1%), prompt(3.0%) |

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
  tool_use_id TEXT,                        -- v8
  event_type  TEXT,                        -- v8
  tokens_confidence TEXT DEFAULT 'high',   -- v11
  tokens_source     TEXT DEFAULT 'transcript', -- v11
  created_at  INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_requests_session      ON requests(session_id, timestamp DESC);
CREATE INDEX idx_requests_type         ON requests(type, timestamp DESC);
CREATE INDEX idx_requests_tokens       ON requests(tokens_total DESC);
CREATE INDEX idx_requests_session_type ON requests(session_id, type);
CREATE INDEX idx_requests_turn         ON requests(turn_id);
CREATE INDEX idx_requests_tool_use_id  ON requests(tool_use_id) WHERE tool_use_id IS NOT NULL;
```

**컬럼 상세**

| 컬럼명 | 타입 | 추가 버전 | 설명 |
|--------|------|-----------|------|
| `id` | TEXT | v1 | 요청 고유 ID (`p-{ts}-{rand}` 또는 `t-{ts}-{rand}`) |
| `session_id` | TEXT FK | v1 | 세션 참조 (sessions.id) |
| `timestamp` | INTEGER | v1 | 요청 발생 시간 (Unix ms) |
| `type` | TEXT | v1 | `prompt` / `tool_call` / `system` |
| `tool_name` | TEXT? | v1 | 도구명 (tool_call인 경우) |
| `model` | TEXT? | v1 | 사용된 AI 모델명 |
| `tokens_input` | INTEGER | v1 | 입력 토큰 수 |
| `tokens_output` | INTEGER | v1 | 출력 토큰 수 |
| `tokens_total` | INTEGER | v1 | 총 토큰 수 |
| `duration_ms` | INTEGER | v1 | 실행 시간 (밀리초) |
| `payload` | TEXT? | v1 | 원본 훅 페이로드 (JSON 문자열) |
| `tool_detail` | TEXT? | v2 | 도구 파라미터 요약 |
| `turn_id` | TEXT? | v3 | 턴 그룹핑 ID (`{session_id}-T{N}`) |
| `source` | TEXT? | v4 | 데이터 출처 추적 |
| `cache_creation_tokens` | INTEGER | v5 | 캐시 생성 토큰 |
| `cache_read_tokens` | INTEGER | v5 | 캐시 읽기 토큰 |
| `preview` | TEXT? | v7 | 프롬프트 내용 미리보기 |
| `tool_use_id` | TEXT? | v8 | Pre/Post 툴 페어링 키 |
| `event_type` | TEXT? | v8 | 이벤트 서브타입 (`pre_tool`, `tool`) |
| `tokens_confidence` | TEXT | v11 | `'high'`(정상) / `'error'`(parseTranscript 실패) |
| `tokens_source` | TEXT | v11 | `'transcript'`(정상 추출) / `'unavailable'`(파일 없음·파싱 실패) |

**tool_detail 포맷**

| 도구 | 포맷 | 예시 |
|------|------|------|
| Skill | `{skill-name}` | `data-analyst` |
| Agent | `{description}` | `"행위이력 저장/조회 계획 초안"` |
| Bash | `{command}` (80자 truncate) | `git status` |
| Read/Edit/Write | `{file_path}` | `/src/index.ts` |
| Grep/Glob | `{pattern} [in {path}]` | `*.ts in src/` |

**도구별 사용 통계 (Top 10, 참고용)**

| 도구명 | 사용 횟수 |
|--------|----------|
| Bash | 1,521 |
| Read | 859 |
| Edit | 401 |
| Write | 136 |
| Grep | 124 |
| Glob | 110 |
| mcp__sequential-thinking | 67 |
| Agent | 60 |
| Skill | 44 |
| ToolSearch | 33 |

---

### claude_events (v6, v11 정규화)

| 목적 | Claude Code 훅의 원본 페이로드 + 정규화 필드 보관 |
|------|--------------------------------------------|
| 수집 범위 | 27개 HOOK_EVENTS 전체 (2026-04-20~ 확장) |

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
  schema_version INTEGER DEFAULT 1,
  -- v11 정규화 컬럼
  permission_mode   TEXT,     -- SessionStart, PermissionRequest
  source            TEXT,     -- SessionStart (startup|resume|compact)
  end_reason        TEXT,     -- SessionEnd, Stop (reason 필드 매핑)
  model             TEXT,     -- Stop, SessionStart (claude-opus-4-7 등)
  stop_hook_active  INTEGER,  -- Stop (boolean → 0/1)
  task_id           TEXT,     -- TaskCreated/Completed (tool_use_id 또는 task_id)
  task_subject      TEXT,     -- TaskCreated (description 또는 subject)
  notification_type TEXT      -- Notification
);

CREATE INDEX idx_events_session_time ON claude_events(session_id, timestamp);
CREATE INDEX idx_events_type_time    ON claude_events(event_type, timestamp);
```

**27개 이벤트 → 정규화 컬럼 매핑 (v11)**

| event_type | 사용 컬럼 | payload 전용 필드 |
|---|---|---|
| SessionStart | source, permission_mode, model | transcript_path, agents, mcp_servers |
| SessionEnd | end_reason, model | (간단) |
| Stop | end_reason, model, stop_hook_active | (간단) |
| StopFailure | end_reason | error |
| TaskCreated | task_id, task_subject | description, prompt, agent_type |
| TaskCompleted | task_id | success, output_path |
| SubagentStart | agent_id, agent_type | (기본 필드만) |
| SubagentStop | agent_id, end_reason | (기본 필드만) |
| Notification | notification_type | title, message |
| PermissionRequest | permission_mode | tool_name, tool_input |
| PermissionDenied | permission_mode | tool_name, reason |
| PreCompact / PostCompact | (기본 필드만) | messages_count, before/after |
| InstructionsLoaded | (기본 필드만) | files |
| WorktreeCreate / WorktreeRemove | cwd | path |
| CwdChanged / FileChanged | cwd | old_cwd, path |
| UserPromptSubmit | — (→ requests로 이동) | prompt |
| PreToolUse | — (타이밍 파일) | tool_name |
| PostToolUse / PostToolUseFailure | — (→ requests) | tool_name, result |

**이벤트 → 저장 위치 매핑**

| 이벤트 | 엔드포인트 | 저장 테이블 |
|--------|-----------|------------|
| UserPromptSubmit | /collect | requests |
| PreToolUse | 타이밍 파일만 | 없음 (의도적) |
| PostToolUse / PostToolUseFailure | /collect | requests |
| 나머지 23개 훅 | /events | claude_events |

---

## 마이그레이션 이력

| 버전 | 변경 내용 |
|------|-----------|
| v1 | 초기 스키마 (sessions, requests) |
| v2 | `requests.tool_detail` 컬럼 추가 |
| v3 | `requests.turn_id` 컬럼 추가 + 기존 데이터 소급 적용 |
| v4 | `requests.source` 컬럼 추가 |
| v5 | `requests.cache_creation_tokens`, `cache_read_tokens` 추가 |
| v6 | `claude_events` 테이블 신규 추가 |
| v7 | `requests.preview` 컬럼 추가 |
| v8 | `requests.tool_use_id`, `event_type` 추가 |
| v9 | Skill/Agent `tool_detail` 개선 |
| v10 | (기존 확장 — 상세 생략) |
| v11 | `requests`에 `tokens_confidence`, `tokens_source` / `claude_events`에 정규화 컬럼 8개 (`permission_mode`, `source`, `end_reason`, `model`, `stop_hook_active`, `task_id`, `task_subject`, `notification_type`) |

## 마이그레이션 코드 패턴

```typescript
// packages/storage/src/schema.ts
export const SCHEMA_VERSION = 9;

export function runMigrations(db: Database): void {
  const version = db.pragma('user_version', { simple: true }) as number;

  if (version < 2) {
    db.exec(`ALTER TABLE requests ADD COLUMN tool_detail TEXT`);
    db.pragma('user_version = 2');
  }
  if (version < 3) {
    db.exec(`ALTER TABLE requests ADD COLUMN turn_id TEXT`);
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
  if (version < 8) {
    db.exec(`ALTER TABLE requests ADD COLUMN tool_use_id TEXT`);
    db.exec(`ALTER TABLE requests ADD COLUMN event_type TEXT`);
    db.pragma('user_version = 8');
  }
  if (version < 9) {
    // Skill/Agent tool_detail 개선
    db.pragma('user_version = 9');
  }
  // 다음 마이그레이션: if (version < 10) { ... }
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

### 이벤트 타입별 통계
```sql
SELECT event_type, COUNT(*) as count
FROM claude_events
GROUP BY event_type
ORDER BY count DESC;
```

### Pre/Post 툴 쌍 분석 (v8+)
```sql
SELECT tool_use_id, event_type, tool_name, duration_ms
FROM requests
WHERE tool_use_id IS NOT NULL
ORDER BY tool_use_id, timestamp;
```
