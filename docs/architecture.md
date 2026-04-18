# spyglass 아키텍처 문서

> Version: 0.1.10
> Last Updated: 2026-04-18
> Status: ✅ 현행

> **이 문서는 현행 구현을 반영한 프로젝트 전체 아키텍처 문서입니다.**
> 기능별 ADR/plan/tasks는 `.claude/docs/plans/<feature>/`를 참고하세요.

---

## 1. 개요

### 1.1 프로젝트 정보

| 항목 | 내용 |
|------|------|
| **이름** | spyglass |
| **버전** | 0.1.10 |
| **설명** | Claude Code 실행 과정 가시화 도구 - 토큰 누수 탐지 |
| **개발 방식** | AI 에이전트 기반 (Claude Code) |

### 1.2 목표

- Claude Code의 요청/응답 흐름을 실시간으로 관찰
- 훅 기반으로 프록시 없이 가볍게 동작
- 토큰 사용량을 시각적으로 모니터링하여 누수 지점 식별

### 1.3 핵심 가치 제안

| 가치 | 설명 |
|------|------|
| **투명성** | Claude Code의 실행 과정을 실시간으로 가시화 |
| **효율성** | 토큰 낭비 지점을 빠르게 식별하여 개발 비용 절감 |
| **인사이트** | 요청별/스킬별 토큰 사용 패턴 분석 |
| **편의성** | 터미널에서 즉시 확인, 별도 브라우저 불필요 |

---

## 2. 시스템 아키텍처

### 2.1 전체 구조

```
┌─────────────────────────────────────────────────────────────────┐
│                        Claude Code Session                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ UserPrompt   │  │ PostToolUse  │  │ 기타 25종 이벤트      │  │
│  │    훅        │  │    훅        │  │     (와일드카드)      │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         └──────────────────┼─────────────────────┘              │
│                            ▼                                    │
│                   ┌─────────────────┐                           │
│                   │ spyglass-collect │  (Bash)                  │
│                   │    스크립트      │  async, timeout=1ms      │
│                   └────────┬────────┘                           │
└────────────────────────────┼────────────────────────────────────┘
                             │ HTTP /collect | /events
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    spyglass Server (Bun)                         │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   /collect   │  │  REST API    │  │      SSE             │  │
│  │   (POST)     │  │  (/api/*)    │  │    (/events)         │  │
│  │              │  │              │  │                      │  │
│  │  수신 → 저장  │  │  조회/통계   │  │  실시간 브로드캐스트   │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                 │                     │              │
│  ┌──────┴───────┐         │                     │              │
│  │  /events     │         │                     │              │
│  │  (POST)      │         │                     │              │
│  │ raw 이벤트 저장│         │                     │              │
│  └──────────────┘         │                     │              │
│                           ▼                                    │
│                    ┌──────────────┐                            │
│                    │   SQLite     │  (WAL Mode)                │
│                    │  (~/.spyglass│   spyglass.db)             │
│                    └──────────────┘                            │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              spyglass TUI (Ink + React) / Web Dashboard          │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 데이터 흐름

1. **기존 수집** (UserPromptSubmit / PostToolUse): `spyglass-collect.sh` → `/collect` → sessions/requests 테이블
2. **와일드카드 수집** (25종 전체 이벤트): `spyglass-collect.sh` → `/events` → claude_events 테이블
3. **실시간**: 서버 → SSE `/events` (GET) → TUI/Web
4. **조회**: TUI/Web → REST API `/api/*` → SQLite

### 2.3 컴포넌트 매트릭스

| 컴포넌트 | 기술 | 역할 | 파일 |
|---------|------|------|------|
| 훅 스크립트 | Bash | 이벤트 수집 및 전송 | `hooks/spyglass-collect.sh` |
| Collector | Bun HTTP | 기존 방식 데이터 수신 | `packages/server/src/collect.ts` |
| Events | Bun HTTP | Raw 이벤트 수신 | `packages/server/src/events.ts` |
| Storage | SQLite | 데이터 영속화 | `packages/storage/src/` |
| API Server | Bun HTTP | REST API 제공 | `packages/server/src/api.ts` |
| SSE Server | Bun HTTP | 실시간 스트리밍 | `packages/server/src/sse.ts` |
| TUI | Ink (React) | 터미널 UI | `packages/tui/src/` |
| Web Dashboard | HTML + Canvas | 브라우저 대시보드 | `packages/web/index.html` |

---

## 3. 데이터 모델

### 3.1 ERD

```
┌─────────────────────┐         ┌─────────────────────┐
│      sessions       │         │      requests       │
├─────────────────────┤         ├─────────────────────┤
│ id (PK)             │◄───────│ session_id (FK)     │
│ project_name        │   1:N   │ id (PK)             │
│ started_at          │         │ timestamp           │
│ ended_at            │         │ type                │
│ total_tokens        │         │ tool_name           │
│ created_at          │         │ model               │
└─────────────────────┘         │ tokens_*            │
                                │ duration_ms         │
                                │ payload             │
                                │ cache_*_tokens      │
                                └─────────────────────┘

┌──────────────────────────────────────┐
│          claude_events               │  ← 와일드카드 수집 (독립)
├──────────────────────────────────────┤
│ id (PK, AUTOINCREMENT)               │
│ event_id (UNIQUE, TEXT)              │
│ event_type (TEXT)                    │
│ session_id (TEXT)                    │
│ transcript_path (TEXT)               │
│ cwd (TEXT)                           │
│ agent_id (TEXT)                      │
│ agent_type (TEXT)                    │
│ timestamp (INTEGER, epoch ms)        │
│ payload (TEXT, JSON)                 │
│ schema_version (INTEGER)             │
└──────────────────────────────────────┘
```

### 3.2 테이블 스키마

#### sessions

| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|----------|------|
| id | TEXT | PRIMARY KEY | 세션 UUID |
| project_name | TEXT | NOT NULL | 프로젝트명 |
| started_at | INTEGER | NOT NULL | 시작 타임스탬프 (ms) |
| ended_at | INTEGER | NULL | 종료 타임스탬프 (ms) |
| total_tokens | INTEGER | DEFAULT 0 | 총 토큰 수 |
| created_at | INTEGER | DEFAULT CURRENT_TIMESTAMP | 생성 시간 |

> `INSERT OR IGNORE` 적용 — 재시작/동시 요청 시 FK 오류 방지

#### requests

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | TEXT PK | 요청 UUID |
| session_id | TEXT FK | 세션 ID |
| timestamp | INTEGER | 요청 타임스탬프 (ms) |
| type | TEXT | prompt / tool_call / system |
| tool_name | TEXT | 도구명 |
| tool_detail | TEXT | 도구 상세 (파일경로, 명령어) |
| turn_id | TEXT | 턴 ID (`<session_id>-T<순번>`) |
| model | TEXT | 모델명 |
| tokens_input | INTEGER | 입력 토큰 |
| tokens_output | INTEGER | 출력 토큰 |
| tokens_total | INTEGER | 총 토큰 |
| duration_ms | INTEGER | 처리 시간 (ms) |
| payload | TEXT | 추가 데이터 (JSON) |
| source | TEXT | 데이터 출처 |
| cache_creation_tokens | INTEGER | 캐시 생성 토큰 |
| cache_read_tokens | INTEGER | 캐시 읽기 토큰 |

**스키마 버전**: v5 (cache_creation_tokens, cache_read_tokens 추가)

#### claude_events

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | INTEGER PK AUTOINCREMENT | 내부 ID |
| event_id | TEXT UNIQUE | UUID (중복 방지) |
| event_type | TEXT | hook_event_name 값 |
| session_id | TEXT | 세션 ID |
| transcript_path | TEXT | transcript 경로 |
| cwd | TEXT | 작업 디렉토리 |
| agent_id | TEXT | 에이전트 ID |
| agent_type | TEXT | 에이전트 유형 |
| timestamp | INTEGER | epoch milliseconds |
| payload | TEXT | 이벤트별 고유 데이터 (JSON) |
| schema_version | INTEGER | DEFAULT 1 |

**인덱스**: `idx_events_session_time`, `idx_events_type_time`

---

## 4. API 스펙

### 4.1 Collect API

#### POST /collect

기존 방식 훅 데이터 수신 (UserPromptSubmit / PostToolUse).

**Request Body**:
```json
{
  "id": "req-uuid",
  "session_id": "session-uuid",
  "project_name": "my-project",
  "timestamp": 1713312000000,
  "request_type": "prompt",
  "model": "claude-sonnet",
  "tokens_input": 100,
  "tokens_output": 50,
  "tokens_total": 150,
  "cache_creation_tokens": 1941,
  "cache_read_tokens": 85020
}
```

#### POST /events

와일드카드 이벤트 수신 (25종 전체). claude_events 테이블에 저장.

**Request Body** (Claude Code hook payload 그대로):
```json
{
  "hook_event_name": "PreToolUse",
  "session_id": "session-uuid",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/project",
  "tool_name": "Bash",
  "tool_input": {"command": "ls"}
}
```

### 4.2 REST API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/sessions` | 세션 목록 |
| GET | `/api/sessions/:id` | 세션 상세 |
| GET | `/api/sessions/active` | 활성 세션 |
| GET | `/api/requests` | 요청 목록 |
| GET | `/api/requests/top` | 토큰 상위 요청 |
| GET | `/api/stats/sessions` | 세션 통계 |
| GET | `/api/stats/requests` | 요청 통계 |
| GET | `/api/dashboard` | 통합 대시보드 |

**공통 Query Parameters**: `limit`, `start_date`, `end_date` (날짜 필터)

### 4.3 SSE API

#### GET /events

```
event: new_request
data: {"type": "new_request", "timestamp": ..., "data": {...}}

event: ping
data: {"type": "ping", "timestamp": ..., "data": {"connections": 2}}
```

---

## 5. 개발 스펙

### 5.1 기술 스택

| 구성요소 | 기술 | 버전 |
|---------|------|------|
| 런타임 | Bun | 1.2.8+ |
| 언어 | TypeScript | 5.0+ |
| TUI | Ink | 5.2.0 |
| 저장소 | SQLite | 3.40+ (WAL Mode) |

### 5.2 프로젝트 구조

```
spyglass/
├── hooks/
│   └── spyglass-collect.sh         # 데이터 수집 (Bash)
├── packages/
│   ├── storage/src/
│   │   ├── schema.ts               # 테이블 스키마
│   │   ├── connection.ts           # DB 연결
│   │   ├── index.ts
│   │   └── queries/
│   │       ├── session.ts
│   │       ├── request.ts
│   │       └── event.ts            # claude_events CRUD (v0.1.10+)
│   ├── server/src/
│   │   ├── index.ts
│   │   ├── collect.ts              # /collect 엔드포인트
│   │   ├── events.ts               # /events 엔드포인트 (v0.1.10+)
│   │   ├── api.ts
│   │   └── sse.ts
│   ├── tui/src/
│   └── web/index.html
├── .githooks/
│   ├── post-push                   # git push 이후 자동 문서 현행화
│   └── doc-sync-prompt.md
└── docs/
    ├── spec.md                     # 현행 스펙 (본 문서)
    ├── adr.md                      # 현행 ADR
    └── planning/                   # 초기 개발 레거시 (수정 금지)
```

### 5.3 환경변수

| 환경변수 | 기본값 | 설명 |
|----------|--------|------|
| `SPYGLASS_HOST` | `127.0.0.1` | 서버 호스트 |
| `SPYGLASS_PORT` | `9999` | 서버 포트 |
| `SPYGLASS_DB_PATH` | `~/.spyglass/spyglass.db` | DB 경로 |
| `SPYGLASS_LOG_DIR` | `~/.spyglass/logs` | 로그 디렉토리 |
| `SPYGLASS_RETENTION_DAYS` | `90` | 데이터 보존 기간 (일) |

### 5.4 실행 명령어

```bash
bun run dev      # 서버 시작
bun run stop     # 서버 종료
bun run status   # 서버 상태
bun run tui      # TUI 실행
bun test         # 테스트
```

---

## 6. 변경 이력

| 날짜 | 버전 | 변경 내용 |
|------|------|----------|
| 2026-04-17 | 0.1.0-MVP | 초기 MVP (Storage, Hooks, Server, TUI, SSE) |
| 2026-04-17 | 0.1.1~0.1.7 | 웹 대시보드, TUI 안정화, tool_detail, turn_id 등 |
| 2026-04-18 | 0.1.8 | 토큰 수집 방식 교체 (transcript JSONL 파싱) |
| 2026-04-18 | 0.1.9 | 데이터 보존 정책 자동 실행, 날짜 필터 지원 |
| 2026-04-18 | 0.1.10 | 와일드카드 이벤트 수집 — claude_events 테이블 + /events 엔드포인트 추가 |

---

*현행화 담당: doc-spec 스킬 / git post-push hook*
