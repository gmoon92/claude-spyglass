# spyglass 최종 스펙 문서

> Version: 0.1.9  
> Last Updated: 2026-04-18  
> Status: ✅ 완료

---

## 1. 개요

### 1.1 프로젝트 정보

| 항목 | 내용 |
|------|------|
| **이름** | spyglass |
| **버전** | 0.1.9 |
| **설명** | Claude Code 실행 과정 가시화 도구 - 토큰 누수 탐지 |
| **개발 기간** | 2026-04-17 (1일) |
| **개발 방식** | AI 순차 개발 (Claude Code) |

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
│  │ UserPrompt   │  │ PostToolUse  │  │ Notification        │  │
│  │    훅        │  │    훅        │  │     훅              │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         └──────────────────┼─────────────────────┘              │
│                            ▼                                    │
│                   ┌─────────────────┐                           │
│                   │ spyglass-collect │  (Bash)                  │
│                   │    스크립트      │  async, timeout=1ms      │
│                   └────────┬────────┘                           │
└────────────────────────────┼────────────────────────────────────┘
                             │ HTTP /events
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
│         └─────────────────┼─────────────────────┘              │
│                           ▼                                    │
│                    ┌──────────────┐                            │
│                    │   SQLite     │  (WAL Mode)                │
│                    │  (~/.spyglass│   spyglass.db)             │
│                    └──────────────┘                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    spyglass TUI (Ink + React)                    │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Live Tab   │  │ History Tab  │  │   Analysis Tab       │  │
│  │              │  │              │  │                      │  │
│  │ • 실시간 토큰 │  │ • 세션 목록   │  │ • TOP 소모 요청      │  │
│  │ • 프로그레스 │  │ • 검색/필터   │  │ • 타입별 통계        │  │
│  │ • 요청 목록 │  │ • 세션 상세   │  │ • 도구별 통계        │  │
│  │ • SSE 연결  │  │              │  │                      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 데이터 흐름

1. **수집**: Claude Code 훅 → `spyglass-collect.sh` → `/collect` 엔드포인트
2. **저장**: 서버 → SQLite (Session, Request 테이블)
3. **실시간**: 서버 → SSE `/events` → TUI
4. **조회**: TUI → REST API `/api/*` → SQLite

### 2.3 컴포넌트 매트릭스

| 컴포넌트 | 기술 | 역할 | 파일 |
|---------|------|------|------|
| 훅 스크립트 | Bash | 이벤트 수집 및 전송 | `hooks/spyglass-collect.sh` |
| Collector | Bun HTTP | 데이터 수신 및 처리 | `packages/server/src/collect.ts` |
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
└─────────────────────┘         │ tokens_input        │
                                │ tokens_output       │
                                │ tokens_total        │
                                │ duration_ms         │
                                │ payload             │
                                │ created_at          │
                                └─────────────────────┘
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

**인덱스**:
- `idx_sessions_started_at` (started_at DESC)
- `idx_sessions_project` (project_name)

#### requests

| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|----------|------|
| id | TEXT | PRIMARY KEY | 요청 UUID |
| session_id | TEXT | NOT NULL, FK | 세션 ID |
| timestamp | INTEGER | NOT NULL | 요청 타임스탬프 (ms) |
| type | TEXT | NOT NULL, CHECK | 요청 타입 (prompt/tool_call/system) |
| tool_name | TEXT | NULL | 도구명 (tool_call인 경우) |
| tool_detail | TEXT | NULL | 도구 상세 (파일경로, 명령어 등) |
| turn_id | TEXT | NULL | 턴 ID (`<session_id>-T<순번>`) |
| model | TEXT | NULL | 모델명 (prompt인 경우) |
| tokens_input | INTEGER | DEFAULT 0 | 입력 토큰 |
| tokens_output | INTEGER | DEFAULT 0 | 출력 토큰 |
| tokens_total | INTEGER | DEFAULT 0 | 총 토큰 |
| duration_ms | INTEGER | DEFAULT 0 | 처리 시간 (ms) |
| payload | TEXT | NULL | 추가 데이터 (JSON) |
| source | TEXT | NULL | 데이터 출처 (claude-code-hook) |
| cache_creation_tokens | INTEGER | DEFAULT 0 | 캐시 생성 토큰 (v5) |
| cache_read_tokens | INTEGER | DEFAULT 0 | 캐시 읽기 토큰 (v5) |
| created_at | INTEGER | DEFAULT CURRENT_TIMESTAMP | 생성 시간 |

**인덱스**:
- `idx_requests_session` (session_id, timestamp DESC)
- `idx_requests_type` (type, timestamp DESC)
- `idx_requests_tokens` (tokens_total DESC)
- `idx_requests_session_type` (session_id, type)

**스키마 마이그레이션 이력**:

| 버전 | 변경 내용 |
|------|----------|
| v1 | 초기 스키마 |
| v2 | tool_detail 컬럼 추가 |
| v3 | turn_id 컬럼 추가 + 기존 데이터 소급 적용 |
| v4 | source 컬럼 추가 |
| v5 | cache_creation_tokens, cache_read_tokens 추가 |

### 3.3 타입 정의

```typescript
// Session
interface Session {
  id: string;
  project_name: string;
  started_at: number;
  ended_at: number | null;
  total_tokens: number;
  created_at?: number;
}

// Request
interface Request {
  id: string;
  session_id: string;
  timestamp: number;
  type: 'prompt' | 'tool_call' | 'system';
  tool_name?: string;
  tool_detail?: string;
  turn_id?: string;
  model?: string;
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  duration_ms: number;
  payload?: string;
  source?: string;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  created_at?: number;
}
```

---

## 4. API 스펙

### 4.1 Collect API

#### POST /collect

훅에서 데이터를 수신하여 저장합니다.

**Request Body**:
```json
{
  "id": "req-uuid",
  "session_id": "session-uuid",
  "project_name": "my-project",
  "timestamp": 1713312000000,
  "event_type": "prompt",
  "request_type": "prompt",
  "model": "claude-sonnet",
  "tokens_input": 100,
  "tokens_output": 50,
  "tokens_total": 150,
  "cache_creation_tokens": 1941,
  "cache_read_tokens": 85020,
  "source": "claude-code-hook"
}
```

**Response**:
```json
{
  "success": true,
  "request_id": "req-uuid",
  "session_id": "session-uuid",
  "saved": true
}
```

### 4.2 REST API

#### GET /api/sessions

세션 목록을 조회합니다.

**Query Parameters**:
- `limit` (number, optional): 최대 개수 (기본: 100)

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "session-uuid",
      "project_name": "my-project",
      "started_at": 1713312000000,
      "ended_at": null,
      "total_tokens": 1500
    }
  ],
  "meta": { "total": 1, "limit": 100 }
}
```

#### GET /api/sessions/:id

특정 세션을 조회합니다.

**Response**:
```json
{
  "success": true,
  "data": { /* Session object */ }
}
```

#### GET /api/sessions/active

활성 세션(ended_at이 NULL) 목록을 조회합니다.

#### GET /api/requests

요청 목록을 조회합니다.

**Query Parameters**:
- `limit` (number, optional): 최대 개수 (기본: 100)

#### GET /api/requests/top

토큰 사용량 상위 요청을 조회합니다.

**Query Parameters**:
- `limit` (number, optional): 최대 개수 (기본: 10)
- `session_id` (string, optional): 특정 세션 필터

#### GET /api/stats/sessions

세션 통계를 조회합니다.

**Response**:
```json
{
  "success": true,
  "data": {
    "total_sessions": 10,
    "total_tokens": 50000,
    "avg_tokens_per_session": 5000,
    "active_sessions": 3
  }
}
```

#### GET /api/stats/requests

요청 통계를 조회합니다.

**Response**:
```json
{
  "success": true,
  "data": {
    "total_requests": 100,
    "total_tokens_input": 30000,
    "total_tokens_output": 20000,
    "total_tokens": 50000,
    "avg_tokens_per_request": 500,
    "avg_duration_ms": 1200
  }
}
```

#### GET /api/dashboard

통합 대시보드 데이터를 조회합니다.

**Response**:
```json
{
  "success": true,
  "data": {
    "summary": {
      "totalSessions": 10,
      "totalRequests": 100,
      "totalTokens": 50000,
      "activeSessions": 3
    },
    "sessions": { /* SessionStats */ },
    "requests": { /* RequestStats */ },
    "projects": [ /* ProjectStats[] */ ],
    "tools": [ /* ToolStats[] */ ],
    "types": [ /* TypeStats[] */ ],
    "active": [ /* Session[] */ ]
  }
}
```

### 4.3 SSE API

#### GET /events

Server-Sent Events 스트림을 연결합니다.

**Event Format**:
```
event: new_request
data: {"type": "new_request", "timestamp": 1713312000000, "data": {...}}

event: ping
data: {"type": "ping", "timestamp": 1713312003000, "data": {"connections": 2}}
```

> 변경 이력: 기존 `data: {...}\n\n` 단순 포맷에서 `event: type\ndata: {...}\n\n` named event 포맷으로 변경 (2026-04-17).

**Event Types**:
- `new_request`: 새 요청 수신
- `session_update`: 세션 업데이트
- `token_update`: 토큰 수 업데이트
- `stats_update`: 통계 업데이트
- `ping`: 30초 간격 하트비트

---

## 5. TUI 스펙

### 5.1 화면 구성

```
┌─────────────────────────────────────────────────────────────────┐ ← Header (1줄)
│ spyglass                          ● LIVE  |  Sessions: 3        │
├─────────────────────────────────────────────────────────────────┤ ← TabBar (1줄)
│ [F1:Live] [F2:History] [F3:Analysis] [F4:Settings]              │
├──────────────┬──────────────────────────────────────────────────┤ ← Main
│              │                                                  │
│   Sidebar    │              Tab Content                         │
│   (25%)      │              (75%)                               │
│              │                                                  │
├──────────────┴──────────────────────────────────────────────────┤ ← Footer (1줄)
│ ↑↓ Navigate | Enter Select | / Search | A Ack | q Quit         │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 탭 구성

| 탭 | 단축키 | 내용 |
|----|--------|------|
| **Live** | F1 | 실시간 카운터 + 현재 세션 모니터링 |
| **History** | F2 | 과거 세션 목록 + 검색 + 필터 |
| **Analysis** | F3 | 요청별 분석 + 통계 + TOP 소모원 |
| **Settings** | F4 | 설정 화면 (Phase 2) |

### 5.3 키보드 단축키

| 키 | 동작 | 범위 |
|----|------|------|
| F1 | Live 탭으로 전환 | 전역 |
| F2 | History 탭으로 전환 | 전역 |
| F3 | Analysis 탭으로 전환 | 전역 |
| F4 | Settings 탭으로 전환 | 전역 |
| ↑/↓ | 목록 이동 | 목록 영역 |
| ←/→ | 섹션 전환 | Analysis 탭 |
| Enter | 선택/상세보기 | 목록 영역 |
| / | 검색 모드 시작 | History 탭 |
| ESC | 검색 모드 종료 | History 탭 |
| A | 알림 확인 | 전역 |
| q | 종료 | 전역 |

### 5.4 컴포넌트 목록

| 컴포넌트 | 파일 | 설명 |
|---------|------|------|
| Layout | `components/Layout.tsx` | Header, Sidebar, Main, Footer |
| TabBar | `components/TabBar.tsx` | F1~F4 탭 네비게이션 |
| LiveTab | `components/LiveTab.tsx` | 실시간 모니터링 화면 |
| HistoryTab | `components/HistoryTab.tsx` | 세션 히스토리 목록 |
| AnalysisTab | `components/AnalysisTab.tsx` | 통계 분석 화면 |
| ProgressBar | `components/ProgressBar.tsx` | 토큰 사용량 시각화 |
| RequestList | `components/RequestList.tsx` | 요청 목록 테이블 |
| AlertBanner | `components/AlertBanner.tsx` | 알림 배너 |

### 5.5 훅 목록

| 훅 | 파일 | 설명 |
|----|------|------|
| useKeyboard | `hooks/useKeyboard.ts` | 키보드 단축키 처리 |
| useSSE | `hooks/useSSE.ts` | SSE 클라이언트 연결 |
| useStats | `hooks/useStats.ts` | 통계 데이터 폧링 |
| useAlerts | `hooks/useAlerts.ts` | 알림 관리 |
| useAlertHistory | `hooks/useAlertHistory.ts` | 알림 히스토리 |

---

## 6. 알림 스펙

### 6.1 임계값 설정

```typescript
const ALERT_THRESHOLDS = {
  WARNING: 5000,    // 5K tokens - 주의
  CRITICAL: 10000,  // 10K tokens - 경고
} as const;
```

### 6.2 알림 레벨

| 레벨 | 조건 | 색상 | 아이콘 |
|------|------|------|--------|
| **정상** | < 5K 토큰 | 녹색 | 🟢 |
| **주의** | 5K ~ 10K 토큰 | 노란색 | 🟡 |
| **경고** | > 10K 토큰 | 빨간색 | 🔴 |

### 6.3 알림 UI

```
정상 상태:
🟢 System Normal

주의 상태:
🟡 WARNING: High Token Usage
Request used 7,234 tokens

경고 상태:
🔴 CRITICAL: Token Limit Exceeded
Request used 12,456 tokens (>10,000)
```

### 6.4 알림 동작

1. 요청 저장 시 토큰 수 체크
2. 임계값 초과 시 알림 생성
3. 상단 배너에 실시간 표시
4. A 키로 알림 확인 가능
5. 히스토리에 저장됨

---

## 7. 개발 스펙

### 7.1 기술 스택

| 구성요소 | 기술 | 버전 | 선택 이유 |
|---------|------|------|----------|
| 런타임 | Bun | 1.2.8+ | TypeScript 네이티브, 빠른 실행 |
| 언어 | TypeScript | 5.0+ | 타입 안정성, 개발자 경험 |
| TUI | Ink | 5.2.0 | React 패턴, ccflare 호환 |
| React | React | 18.3.1 | 컴포넌트 기반 개발 |
| 저장소 | SQLite | 3.40+ | zero-config, WAL 모드 지원 |
| 통신 | HTTP + SSE | - | 실시간 스트리밍 |

### 7.2 프로젝트 구조

```
spyglass/
├── hooks/                          # 훅 스크립트
│   └── spyglass-collect.sh         # 데이터 수집 스크립트 (Bash)
├── packages/                       # 모노레포 패키지
│   ├── storage/                    # SQLite 저장소
│   │   ├── src/
│   │   │   ├── schema.ts           # 테이블 스키마
│   │   │   ├── connection.ts       # DB 연결 관리
│   │   │   ├── index.ts            # 통합 모듈
│   │   │   ├── queries/
│   │   │   │   ├── session.ts      # Session CRUD
│   │   │   │   └── request.ts      # Request CRUD
│   │   │   └── __tests__/          # 단위 테스트
│   │   └── package.json
│   ├── server/                     # HTTP 서버
│   │   ├── src/
│   │   │   ├── index.ts            # 서버 진입점
│   │   │   ├── collect.ts          # /collect 엔드포인트
│   │   │   ├── api.ts              # REST API
│   │   │   ├── sse.ts              # SSE 스트리밍
│   │   │   └── __tests__/          # 통합 테스트
│   │   └── package.json
│   ├── tui/                        # 터미널 UI
│   │   ├── src/
│   │   │   ├── index.tsx           # TUI 진입점
│   │   │   ├── app.tsx             # 메인 앱
│   │   │   ├── components/         # UI 컴포넌트
│   │   │   └── hooks/              # 커스텀 훅
│   │   └── package.json
│   ├── web/                        # 웹 대시보드
│   │   └── index.html              # 빌드 없는 단일 파일 대시보드
│   └── types/                      # 공통 타입
│       └── package.json
├── docs/                           # 문서
│   └── planning/                   # 기획 문서
│       ├── 01-overview-plan.md     # 개발 계획
│       ├── 02-prd.md               # 제품 요구사항
│       ├── 03-adr.md               # 기술 결정 기록
│       ├── 04-tasks-ai.md          # AI 개발 작업
│       └── 05-spec.md              # 최종 스펙 (본 문서)
├── phases/                         # Phase별 상태
│   ├── phase-1-storage/status.json
│   ├── phase-2-hooks/status.json
│   └── ...
├── package.json                    # 루트 패키지
├── tsconfig.json                   # TypeScript 설정
└── README.md                       # 프로젝트 소개
```

### 7.3 개발 원칙

1. **순차 개발**: Phase 1 → Phase 2 → ... → Phase 7 순서로 개발
2. **원자성 커밋**: 각 Task 완료 시 즉시 커밋 + 태그
3. **검증 중심**: 각 Phase마다 완료 조건 통과 필수
4. **타입 안전**: 모든 코드 TypeScript strict 모드
5. **테스트**: 핵심 기능 단위 테스트 작성

### 7.4 Git Workflow

```
main
  └── phase/1-storage (tag: phase-1-storage-complete)
  └── phase/2-hooks (tag: phase-2-hooks-complete)
  └── phase/3-server (tag: phase-3-server-complete)
  └── phase/4-tui-base (tag: phase-4-tui-base-complete)
  └── phase/5-tui-live (tag: phase-5-tui-live-complete)
  └── phase/6-tui-history (tag: phase-6-tui-history-complete)
  └── phase/7-alerts (tag: phase-7-alerts-complete, v0.1.0-mvp)
```

**커밋 컨벤션**:
- `feat(phase-{N}-{task-id}): 설명` - 새 기능
- `test(phase-{N}-{task-id}): 설명` - 테스트
- `fix(phase-{N}-{task-id}): 설명` - 버그 수정

---

## 8. 배포 스펙

### 8.1 실행 환경

| 환경변수 | 기본값 | 설명 |
|----------|--------|------|
| `SPYGLASS_HOST` | `127.0.0.1` | 서버 호스트 |
| `SPYGLASS_PORT` | `9999` | 서버 포트 |
| `SPYGLASS_DB_PATH` | `~/.spyglass/spyglass.db` | 데이터베이스 경로 |
| `SPYGLASS_LOG_DIR` | `~/.spyglass/logs` | 로그 디렉토리 |
| `SPYGLASS_RETENTION_DAYS` | `90` | 세션 데이터 보존 기간 (일), 서버 시작 시 초과분 자동 삭제 |

### 8.2 실행 명령어

```bash
# 서버 데몬 시작
bun run packages/server/src/index.ts start

# 서버 상태 확인
bun run packages/server/src/index.ts status

# 서버 종료
bun run packages/server/src/index.ts stop

# TUI 실행
bun run packages/tui/src/index.tsx

# 웹 대시보드 접속 (서버 실행 후)
open http://localhost:9999

# 테스트
bun test

# 타입 체크
bun run typecheck
```

### 8.3 데이터 위치

- **SQLite DB**: `~/.spyglass/spyglass.db`
- **로그**: `~/.spyglass/logs/collect.log`
- **PID 파일**: `~/.spyglass/server.pid`

### 8.4 collect.log 포맷

```
[YYYY-MM-DD HH:MM:SS] [INFO] Event: {event_type}, Type: {request_type}, Tool: {tool_detail}, Project: {project_name}
```

`Tool` 필드는 `request_type`이 `tool_call`일 때만 출력되며, 툴 종류에 따라 세분화됩니다:

| tool_name | 로그 출력 예시 |
|-----------|--------------|
| `Skill` | `Tool: Skill(redmine)` |
| `Agent` | `Tool: Agent(pm)` |
| 그 외 | `Tool: Read`, `Tool: Bash`, `Tool: Edit` 등 |

```
# 예시
[14:25:08] [INFO] Event: tool, Type: tool_call, Tool: Skill(redmine), Project: rv-iso
[14:25:09] [INFO] Event: tool, Type: tool_call, Tool: Agent(pm), Project: rv-iso
[14:25:10] [INFO] Event: tool, Type: tool_call, Tool: Read, Project: rv-iso
[14:25:11] [INFO] Event: prompt, Type: prompt, Project: rv-iso
```

---

## 9. 테스트 스펙

### 9.1 테스트 구조

| 패키지 | 테스트 파일 | 커버리지 |
|--------|------------|----------|
| storage | `__tests__/connection.test.ts` | DB 연결 |
| storage | `__tests__/session.test.ts` | Session CRUD |
| storage | `__tests__/request.test.ts` | Request CRUD |
| server | `__tests__/collect.test.ts` | Collect API |
| server | `__tests__/server.test.ts` | HTTP 서버 |

### 9.2 테스트 실행

```bash
# 모든 테스트
bun test

# 특정 패키지
bun test packages/storage
bun test packages/server
```

---

## 10. 로드맵

### Phase 1 (MVP) ✅ 완료
- [x] SQLite 저장소 (WAL 모드)
- [x] 훅 기반 데이터 수집
- [x] HTTP 서버 + REST API
- [x] SSE 실시간 스트리밍
- [x] TUI 기본 구조 (Ink)
- [x] 실시간 토큰 카운터
- [x] 히스토리/분석 탭
- [x] 10K 토큰 알림

### Phase 2 (부분 완료)
- [ ] 히트맵/타임라인 시각화
- [ ] 동적 알림 임계값 (사용자 설정)
- [ ] 데이터 날짜 필터
- [ ] CSV/JSON 내보내기
- [ ] ccflare 통합
- [x] 웹 대시보드 (기본) — Canvas 기반 실시간 차트, SSE 연동 (2026-04-17)

### Phase 3 (예정)
- [ ] 고급 웹 대시보드
- [ ] 다중 계정 지원
- [ ] 로드밸런싱
- [ ] 고급 분석 (머신러닝)
- [ ] 클라우드 동기화

### Phase 8 (버그 수정 / 안정화, 2026-04-17 완료)
- [x] macOS `date +%s%3N` 미지원 → python3 밀리초 타임스탬프로 교체
- [x] `[[ -p /dev/stdin ]]` macOS 미동작 → `[[ ! -t 0 ]]`으로 교체
- [x] `classify_request_type` Claude Code hook 포맷 지원 추가
- [x] payload에서 `session_id` 자동 추출
- [x] SSE 이벤트 포맷 → named event (`event: type\ndata: {...}`) 변경
- [x] `GET /` → 웹 대시보드 HTML 서빙으로 변경

### Phase 9 (TUI 안정화, 2026-04-17 완료)
- [x] ink 5.x API 변경 대응 — `useStdoutDimensions` → `useStdout` 마이그레이션
- [x] `backgroundColor` prop 제거 — 텍스트 색상 + bold + `"> "` 접두어로 선택 상태 표시
- [x] 키보드 핸들러 수정 — `key.function` 미지원 → `key.name`으로 F1~F4 감지
- [x] JSX Transform 설정 — `/** @jsxImportSource react */` pragma 추가
- [x] `bunfig.toml` 추가 — JSX 및 build target 설정
- [x] `eventsource` 패키지 추가 — Bun SSE 지원
- [x] `react-devtools-core` 의존성 추가 — ink 5.x 호환
- [x] SQLite 타입 호환성 수정 — `SQLQueryBindings` 타입 단언
- [x] TUI 빌드 테스트 완료 — `bun build packages/tui/src/index.tsx` 성공
- [x] 서버 연동 테스트 완료 — API 데이터 수신 확인 (totalTokens: 5042)

### Phase 10 (데이터 신뢰성 P0 수정, 2026-04-18 완료)
- [x] **토큰 수집 방식 전면 교체** — `CLAUDE_API_USAGE_*` 환경변수는 Claude Code에 존재하지 않음 확인 → transcript JSONL 파싱으로 교체
- [x] `extract_usage_from_transcript()` 구현 — `transcript_path` JSONL에서 마지막 assistant 메시지의 `usage` 파싱
- [x] `output_tokens` 정상화 — 기존 항상 0이던 문제 해결
- [x] `cache_creation_tokens` / `cache_read_tokens` 정상화 — ⚡ 캐시 배지 정상 표시
- [x] 서버 시작 시 데이터 보존 정책 자동 실행 — `SPYGLASS_RETENTION_DAYS` (기본 90일) + `PRAGMA VACUUM`

---

## 11. 참고 문서

- [01-overview-plan.md](./01-overview-plan.md) - 개발 계획
- [02-prd.md](./02-prd.md) - 제품 요구사항
- [03-adr.md](./03-adr.md) - 기술 결정 기록
- [04-tasks-ai.md](./04-tasks-ai.md) - AI 개발 작업

---

## 12. 변경 이력

| 날짜 | 버전 | 변경 내용 |
|------|------|----------|
| 2026-04-17 | 0.1.0-MVP | 초기 MVP 완료 |
| 2026-04-17 | 0.1.1 | 웹 대시보드 추가 (`packages/web/index.html`), 훅 버그 수정 (macOS 호환), SSE named event 포맷 변경, `GET /` 웹 대시보드 서빙으로 변경 |
| 2026-04-17 | 0.1.2 | TUI ink 5.x 호환성 수정 (useStdoutDimensions → useStdout, backgroundColor 제거), 키보드 핸들러 F1~F4 지원, JSX Transform 설정, eventsource 패키지 추가, SQLite 타입 단언 수정, Docker 구성 추가 |
| 2026-04-17 | 0.1.3 | collect.log 포맷 개선 — tool_name 상세 포함, Skill(name)/Agent(subagent_type) 세분화 출력 |
| 2026-04-17 | 0.1.4 | 웹 대시보드 개선 — 프로젝트/세션 브라우저를 최근 요청 위로 이동, 최근 요청 노출 한도 10건 |
| 2026-04-17 | 0.1.5 | 웹 대시보드 UI 통합 — "프로젝트별 토큰" 별도 테이블 제거, 브라우저 그리드 프로젝트 행에 세션 수·토큰 바 통합 표시 |
| 2026-04-17 | 0.1.6 | 툴 세부 이름(tool_detail) DB 저장 및 대시보드 표시, 프롬프트 내용 accordion 표시, user role 배지 추가 |
| 2026-04-17 | 0.1.7 | 대화 턴 뷰 추가 — turn_id 컬럼(schema v3), turn 자동 채번, 피들러 스타일 아코디언 UI (prompt+tool_calls 그룹화, Agent/Skill 아이콘 구분) |
| 2026-04-18 | 0.1.8 | 토큰 수집 방식 교체 — `CLAUDE_API_USAGE_*` 환경변수가 Claude Code에 존재하지 않음 확인, transcript JSONL 파싱으로 전면 교체, `output_tokens`·`cache_creation_tokens`·`cache_read_tokens` 정상화 |
| 2026-04-18 | 0.1.9 | 서버 시작 시 데이터 보존 정책 자동 실행 — `runStartupMaintenance()` 추가, `SPYGLASS_RETENTION_DAYS` 환경변수(기본 90일), `PRAGMA VACUUM` 자동 수행 |

---

*문서 작성: Claude Code*  
*최종 업데이트: 2026-04-18 (v0.1.9)*
