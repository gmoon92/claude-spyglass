# claude-spyglass 아키텍처

> Claude Code 실행 모니터링 도구의 시스템 설계 문서.
> 본 문서는 코드 동작과 직접 매핑된다. 파일 경로(`packages/.../foo.ts:42`)는 모두 실제 위치이며, 기능을 추가·수정할 때 참고해야 할 진입점을 알려준다.

---

## 이 문서 읽는 법

이 문서는 **§1~§12 본문 + §13~§15 부록** 구성이다. 목적에 따라 다음 순서를 권장한다.

- **처음 보는 사람**: §1 개요 → §2 다이어그램 → §13 시나리오(부록). 5분이면 전체 흐름이 잡힌다.
- **기능을 추가하려는 사람**: §14 확장 포인트(부록) → 해당 패키지 §(§4·§5·§6·§7) → §10 설계 원칙.
- **버그를 추적하는 사람**: §9 통신 인터페이스 → 데이터가 흘러간 코드 진입점(§15 인덱스).
- **DB 스키마를 알고 싶은 사람**: §5 storage.

### 섹션 요약

| § | 제목 | 내용 한 줄 |
|---|------|------------|
| 1 | 개요 | 목적, 한 줄 요약, 핵심 가치, 기능 분포 |
| 2 | 시스템 다이어그램 | 데이터 흐름, HTTP 디스패처, 부팅 라이프사이클 |
| 3 | 모노레포 구조 | 5개 패키지 의존 그래프와 책임 |
| 4 | `packages/server` | HTTP·SSE·Hook·Proxy·Metrics·Meta-docs |
| 5 | `packages/storage` | SQLite 스키마와 32개 마이그레이션 |
| 6 | `packages/tui` | Ink 기반 터미널 UI |
| 7 | `packages/web` | Vanilla JS 웹 대시보드 |
| 8 | `packages/types` | 공통 타입 contract |
| 9 | 통신 인터페이스 | HTTP API·SSE 페이로드 contract |
| 10 | 설계 원칙 | SRP, Strategy, SSoT, 캡슐화 |
| 11 | 외부 의존성 | 패키지·환경 변수·파일시스템 위치 |
| 12 | 빌드·실행·테스트 | npm scripts, 진단 명령 |
| 13 | 데이터 흐름 시나리오 *(부록)* | 4가지 end-to-end 트레이스 |
| 14 | 확장 포인트 *(부록)* | 6가지 추가 시나리오 체크리스트 |
| 15 | 참고 파일 인덱스 *(부록)* | 코드 진입점 매핑 |

### 약어 사전

| 약어 | 풀이 |
|------|------|
| SSE | Server-Sent Events. HTTP 위에서 서버→클라이언트 단방향 스트림. |
| SSoT | Single Source of Truth. 동일 정보를 한 곳에만 두는 원칙. |
| SRP | Single Responsibility Principle. 단일 책임 원칙. |
| OCP | Open/Closed Principle. 확장에는 열려 있고 수정에는 닫혀 있어야 한다는 원칙. |
| ADR | Architecture Decision Record. 아키텍처 결정 기록 문서. |
| WAL | Write-Ahead Logging. SQLite 저널 모드의 하나. |
| FSM | Finite State Machine. 유한 상태 기계. |

---

## 1. 개요

### 1.1 목적

claude-spyglass(이하 **spyglass**)는 Claude Code의 **로컬 실행 컨텍스트**를 실시간으로 관찰하는 도구다. 매번 모델이 어떤 도구를 호출했고, 토큰을 얼마나 썼고, 어떤 시스템 프롬프트로 동작했는지 — Claude Code가 디스크에 남기는 transcript와 hook 페이로드를 기반으로 재구성한다.

수집의 시작점은 **Claude Code Hook 시스템**(`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SessionStart`, `Stop`, `SessionEnd` 등)이다. 사용자가 Claude Code를 한 번 실행할 때마다 수 ~ 수백 건의 훅 페이로드가 stdin으로 흘러나오며, spyglass는 이를 **로컬 HTTP 서버**(`packages/server`)가 받아 **SQLite**(`packages/storage`)에 영속화하고, **SSE**를 통해 실시간으로 **웹 대시보드**(`packages/web`)와 **터미널 UI**(`packages/tui`)에 푸시한다.

### 1.2 한 줄 요약

```
Claude Code hook → spyglass-collect.sh → POST /collect → SQLite → SSE → web/TUI
```

### 1.3 핵심 가치

| 가치 | 구체 구현 |
|------|-----------|
| **로컬 우선** | DB 파일(`~/.spyglass/spyglass.db`)·로그·PID 파일 모두 로컬. 네트워크 외부 의존 0. |
| **실시간 시각화** | SSE(`/events`) — 새 요청 도착 시 즉시 푸시. TUI 지연 50ms 이내. |
| **무손실 수집** | 훅 raw 페이로드는 `~/.spyglass/logs/hook-raw.jsonl`에 원장 기록 후 서버 전달(이중 안전). |
| **카탈로그형 분석** | Behavior Definitions(SKILL.md / agents.md / CLAUDE.md / commands) 메타 문서 카탈로그를 별도 테이블로 정규화. |
| **사후 감사** | 32개 마이그레이션 누적으로 모든 분석 컬럼이 영속화(트랜스크립트 재파싱 비용 0). |

### 1.4 기능 분포

- **수집**: `hooks/spyglass-collect.sh` + `packages/server/src/hook/`
- **영속화**: `packages/storage/` (SQLite + WAL, 32 migrations, schema_version=23)
- **HTTP API**: `packages/server/src/api.ts` + `routes/*` + `metrics/router.ts`
- **실시간**: `packages/server/src/sse.ts` (`broadcastNewRequest`, `broadcastNewProxyRequest`, `broadcastSessionUpdate`)
- **프록시(선택)**: `packages/server/src/proxy/` — Anthropic API를 HTTP 레벨로 미러링하여 헤더·SSE까지 직접 수집(opt-in)
- **메타 문서**: `packages/server/src/meta-docs/` — SKILL.md / agents.md / CLAUDE.md 자동 스캔·카탈로그화
- **표시**: `packages/web/` (Vanilla JS) + `packages/tui/` (Ink/React)

---

## 2. 시스템 아키텍처 다이어그램

> **TL;DR** — Claude Code 훅이 bash 스크립트를 통해 spyglass 서버에 POST를 보내면, 서버는 SQLite에 저장하고 SSE로 웹·TUI에 실시간 푸시한다. 진입점은 `runtime/dispatch.ts:18`의 `handleRequest` 단일 함수다.

### 2.1 데이터 흐름 — 큰 그림

```
                                                ┌─────────────────────┐
                                                │  Claude Code (CLI)  │
                                                │  └ hook 시스템      │
                                                └──────────┬──────────┘
                                                           │ stdin (raw JSON)
                                                           ▼
                                              ┌─────────────────────────┐
                                              │ hooks/spyglass-collect  │
                                              │   .sh                   │
                                              │  • hook-raw.jsonl 원장  │
                                              │  • hook_event_name 분기 │
                                              └──┬───────────────────┬──┘
                                                 │                   │
                                  POST /collect  │                   │  POST /events
                                  (Pre/Post/UPS) ▼                   ▼  (Session*)
                          ┌──────────────────────────────────────────────────────┐
                          │            spyglass server  (Bun.serve)              │
                          │                                                      │
                          │  /collect  ─►  hook/  ─► dispatcher (Strategy)       │
                          │                  │       ├ PreToolUseHandler        │
                          │                  │       ├ PostToolUseHandler       │
                          │                  │       ├ UserPromptSubmitHandler  │
                          │                  │       └ SystemEventHandler       │
                          │                  ▼                                   │
                          │              processor → persist → SQLite           │
                          │                                                      │
                          │  /events POST ─► events.collectHandler ─► claude_events
                          │  /events GET  ─► sseRouter (stream)                  │
                          │  /api/*       ─► routes/ (sessions/requests/...)     │
                          │  /api/metrics ─► metrics/router (계산기)             │
                          │  /v1/*        ─► proxy/handler (opt-in 미러링)       │
                          │  /            ─► packages/web index.html            │
                          │  /assets/*    ─► packages/web/assets/* (정적)        │
                          └──────────────┬────────────────────────┬──────────────┘
                                         │ write                  │ broadcast (SSE)
                                         ▼                        ▼
                              ┌────────────────────┐    ┌────────────────────┐
                              │   SQLite (WAL)     │    │  in-memory SSE     │
                              │  ~/.spyglass/      │    │  connections Set   │
                              │  spyglass.db       │    └─────────┬──────────┘
                              │                    │              │
                              │  • sessions        │              │
                              │  • requests        │              ▼
                              │  • claude_events   │    ┌────────────────────┐
                              │  • proxy_requests  │    │  Client (browser/  │
                              │  • system_prompts  │    │   TUI)             │
                              │  • meta_documents  │    │                    │
                              │  • stats_hourly    │    │  EventSource       │
                              │  • model_limits    │    │   → 'new_request'  │
                              └────────────────────┘    │   → 'new_proxy_..' │
                                         ▲              │   → 'session_..'   │
                                         │ read         │   → 'ping'         │
                                         └──────────────┴────────────────────┘
                                                 GET /api/*
```

### 2.2 진입점 — `Bun.serve` HTTP 디스패처

`packages/server/src/runtime/dispatch.ts:18`의 `handleRequest`가 단일 진입점이며, **경로 prefix별**로 도메인 핸들러에 위임한다.

```
HTTP 요청 ─► handleRequest (dispatch.ts)
            │
            ├─ OPTIONS         → CORS preflight 204
            ├─ /v1/*           → handleProxy (proxy/handler/index.ts)
            ├─ /collect        → handleHookHttpRequest (hook/http-entry.ts)
            ├─ /events (POST)  → eventsCollectHandler (events.ts)
            ├─ /events (GET)   → sseRouter (sse.ts)
            ├─ /api/*          → apiRouter (api.ts)
            ├─ /health         → JSON ok
            ├─ /               → web/index.html (또는 Accept:json 시 API info)
            ├─ /assets/*       → packages/web/assets/* 정적 서빙
            ├─ /locales/*      → packages/web/locales/* (i18n JSON)
            ├─ /favicon.*      → 정적 서빙
            └─ 그 외           → 404
```

### 2.3 라이프사이클

서버는 `packages/server/src/index.ts`(19줄짜리 진입점)가 `dispatchDaemonCommand`로 위임한다. 데몬은 PID 파일(`~/.spyglass/server.pid`) 기반 싱글톤이다.

```
bun run start  ──►  index.ts
                     └─ dispatchDaemonCommand('start')  (runtime/daemon.ts)
                          ├─ commandStart        : PID 파일 확인 + 포트 점유 검사 + startServer()
                          ├─ commandStop         : SIGTERM 시그널 송신
                          ├─ commandRestart      : 점유 프로세스 정리 후 재시작
                          ├─ commandStatus       : PID 존재 + kill(0) 체크
                          └─ commandForeground   : 기본(인수 없음). 백그라운드 없이 동작.

startServer() (runtime/lifecycle.ts)
   1) installServerStdioMirror()       — stdout/stderr → ~/.spyglass/logs/server.log
   2) clearDiagLogs()                  — 진단 jsonl 디렉토리 정리
   3) getDatabase({ dbPath })          — SQLite 연결 + WAL pragma + 마이그레이션
   4) startMaintenanceSchedule(db)     — 일별 유지보수(이전 데이터 정리)
   5) startVersionCheckSchedule()      — 1h 간격 npm registry 버전 체크
   6) bootstrapMetaDocsSync(db, ...)   — meta-docs 글로벌 스캔 (CLAUDE/SKILL/agents)
   7) Bun.serve({ port, hostname, fetch: handleRequest, idleTimeout: 0 })
                                       — idleTimeout=0 (SSE 연결 유지)
```

---

## 3. 모노레포 구조

> **TL;DR** — types(타입만) → storage(DB) → server(HTTP)/web → tui 순으로 의존이 한 방향으로만 흐른다. types는 누구에게도 의존하지 않고, tui가 가장 위에 있다.

bun workspaces 기반 모노레포. 루트 `package.json`의 `"workspaces": ["packages/*"]` 한 줄로 다섯 워크스페이스가 자동 연결된다.

```
claude-spyglass/
├── package.json                       — 워크스페이스 루트, npm scripts, dependencies
├── bun.lock                            — 워크스페이스 잠금 파일
├── tsconfig.json                       — 루트 TS 설정 (path 별칭 없음, workspace 의존성으로 해결)
├── settings.json                       — Claude Code hook 등록 등
├── docker-compose.yml / Dockerfile     — (선택) 컨테이너 실행
├── hooks/
│   └── spyglass-collect.sh             — Claude Code 훅이 호출하는 bash 수집 스크립트
├── scripts/                            — 빌드/배포 보조 스크립트
├── packages/
│   ├── types/                          — 공통 타입 정의 (런타임 0줄)
│   ├── storage/                        — SQLite 스키마 + 쿼리 + 마이그레이션
│   ├── server/                         — Bun HTTP 서버 (API + SSE + Hook + Proxy + Metrics)
│   ├── tui/                            — Ink/React 기반 터미널 UI
│   └── web/                            — Vanilla JS 웹 대시보드
└── docs/                               — 운영/스키마/아키텍처 문서
```

### 3.1 패키지 의존 그래프

```
        ┌─────────────────────┐
        │  @spyglass/types    │   ← 모든 패키지가 import. 변경 이유 단일성(SRP).
        └──────────┬──────────┘
                   │ import (type-only)
        ┌──────────┴──────────────────────────────┐
        ▼                          ▼              ▼
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ @spyglass/      │   │ @spyglass/      │   │ packages/web    │
│   storage       │   │   server        │   │  (JSDoc only)   │
│  (SQLite SSoT)  │   │  (HTTP/SSE)     │   └─────────────────┘
└────────┬────────┘   └────────┬────────┘
         │                     │
         │   import workspace  │
         └─────────┬───────────┘
                   │
         ┌─────────▼──────────┐
         │  @spyglass/tui     │
         │  (Ink + React)     │
         └────────────────────┘
```

핵심 관찰: **상위(types)는 누구에게도 의존하지 않고**, **하위(tui)는 모든 패키지 + types에 의존**한다. 양 방향 의존성은 금지(types→storage 같은 역방향 import 없음).

### 3.2 패키지별 책임 한 줄

| 패키지 | 책임 | 런타임 | 주요 디렉토리 |
|--------|------|--------|---------------|
| `@spyglass/types` | 서버/TUI/웹이 공유하는 TS 타입 contract. **런타임 0줄.** | TS 선언만 | `src/{request,session,turn,i18n}.ts` |
| `@spyglass/storage` | SQLite 연결, 스키마, 마이그레이션, 모든 SQL 쿼리. | Bun/Node | `src/{connection,schema,migrator,queries/*}` |
| `@spyglass/server` | HTTP 서버 + SSE + Hook 수집 + Proxy + Metrics + Meta-docs. | Bun | `src/{api,sse,hook,proxy,metrics,meta-docs,routes,runtime}` |
| `@spyglass/tui` | Ink 기반 터미널 UI. SSE 클라이언트, KPI strip, 사이드바, screens. | React 18 + Ink 5 | `src/{app.tsx,components,screens,hooks,stores}` |
| `@spyglass/web` | Vanilla JS 대시보드. `index.html` + ES modules + CSS 모듈. | 브라우저 | `index.html`, `assets/{js,css}` |

---

## 4. `packages/server` — HTTP 서버 & 수집 코어

> **TL;DR** — Bun.serve가 단일 진입점이며, 경로 prefix로 라우터를 fan-out한다. Hook 수집은 Strategy 패턴(이벤트 타입당 핸들러 1개)이고, Proxy는 단계별 8개 모듈로 분해되어 있다.

### 4.1 디렉토리 구조

```
packages/server/src/
├── index.ts                       — 19줄. dispatchDaemonCommand로 위임만.
├── api.ts                         — 86줄. routes/* fan-out 디스패처.
├── sse.ts                         — 328줄. SSE 연결 관리 + broadcastNewRequest 등.
├── events.ts                      — POST /events 핸들러 (SessionStart/Stop 등).
├── metrics.ts                     — 메트릭 라우터 re-export (얇은 호환 shim).
├── model-limits.ts                — model_limits 테이블 캐시.
├── tool-category.ts               — Tool 이름 → category 분류 (search/exec/...)
├── version-checker.ts             — npm registry 1h 폴링.
├── diag-log.ts                    — 진단 jsonl 기록기.
├── i18n.ts                        — 서버측 i18n 키 로더.
│
├── runtime/                       — 라이프사이클·디스패치·환경
│   ├── config.ts                  — PORT/HOST/DB_PATH 등 env 파싱
│   ├── daemon.ts                  — start/stop/restart/status PID 명령
│   ├── lifecycle.ts               — startServer / stopServer / isServerRunning
│   ├── dispatch.ts                — handleRequest (경로 prefix 디스패처)
│   ├── port.ts                    — 포트 점유 검사·해제 유틸
│   ├── stdio-mirror.ts            — stdout/stderr → server.log 미러링
│   └── maintenance.ts             — 일별 유지보수 스케줄(오래된 데이터 정리)
│
├── routes/                        — REST API 라우터 (도메인별)
│   ├── _shared.ts                 — jsonResponse, buildMeta, parseTimeWindow 등
│   ├── sessions.ts                — /api/sessions/* (9개)
│   ├── requests.ts                — /api/requests/* (3개)
│   ├── stats.ts                   — /api/stats/* (sessions/requests/cache/proxy)
│   ├── dashboard.ts               — /api/dashboard + 응답 캐시(invalidateDashboardCache)
│   ├── events.ts                  — wildcard hook 이벤트 라우트
│   ├── proxy.ts                   — /api/proxy/* (헤더/페이로드 조회)
│   ├── system-prompts.ts          — /api/system-prompts/* (v22 dedup 카탈로그)
│   ├── meta-docs.ts               — /api/meta-docs/* (v24 Behavior Definitions)
│   └── version.ts                 — /api/version (current + latest)
│
├── metrics/                       — /api/metrics/* (UI Redesign Phase 2)
│   ├── router.ts                  — 라우터 (10개 라우트)
│   ├── _shared.ts                 — 시간 윈도우 파서, meta 빌더
│   └── calculators/               — 시계열·이상치 계산기
│       ├── burn-rate.ts
│       ├── cache-trend.ts
│       ├── proxy-trend.ts
│       └── anomaly.ts
│
├── hook/                          — /collect 수집 파이프라인 (Strategy 패턴)
│   ├── index.ts                   — barrel (외부 노출 API만)
│   ├── http-entry.ts              — POST /collect HTTP 진입점
│   ├── dispatcher.ts              — Strategy Registry (hook_event_name → handler)
│   ├── event-handler.ts           — interface HookEventHandler + HookContext
│   ├── handlers/                  — Strategy 구현체
│   │   ├── pre-tool-use.handler.ts
│   │   ├── post-tool-use.handler.ts        — Agent 자식 INSERT 포함
│   │   ├── user-prompt-submit.handler.ts
│   │   ├── system-event.handler.ts         — fallback (eventType='')
│   │   └── _shared.ts                      — makeRequestId, deriveTokensConfidence
│   ├── processor.ts               — 정제된 payload 처리 (DB 저장 위임)
│   ├── persist.ts                 — saveRequest + persistSubagentChildren
│   ├── session.ts                 — 세션 upsert 로직
│   ├── turn.ts                    — turn_id 할당 (getLastTurnId, assignTurnId)
│   ├── transcript.ts              — transcript_path 파싱 (token 추출)
│   ├── transcript-context.ts      — transcript 컨텍스트 캐시
│   ├── preview.ts                 — UI preview 텍스트 추출
│   ├── tool-detail.ts             — tool_input → tool_detail 정제 (path, command 등)
│   ├── classify.ts                — slash_command 추출
│   ├── audit-meta.ts              — permission_mode 등 감사 필드 추출
│   ├── slash-command.ts           — UserPromptSubmit의 <command-name>foo</command-name> 파싱
│   ├── timing.ts                  — duration_ms 산출
│   └── types.ts                   — ClaudeHookPayload, NormalizedHookPayload 등
│
├── proxy/                         — /v1/* Anthropic API 미러링 (opt-in)
│   ├── index.ts                   — barrel
│   ├── handler.ts                 — handleProxy shim (handler/index.ts로 위임)
│   ├── handler/                   — 단계별 모듈 (Phase 8 분해)
│   │   ├── index.ts               — handleProxy 오케스트레이션
│   │   ├── inbound.ts             — buildInboundContext + forwardToUpstream + buildResponseHeaders
│   │   ├── stream.ts              — SSE 응답 스트리밍 처리
│   │   ├── non-stream.ts          — JSON 응답 처리
│   │   ├── persist.ts             — proxy_requests INSERT (트랜잭션)
│   │   ├── broadcast.ts           — SSE broadcastNewProxyRequest
│   │   ├── diag.ts                — 진단 jsonl 기록
│   │   └── _shared.ts             — HandlerContext, helpers
│   ├── upstream.ts                — URL 라우팅 (Anthropic 기본 / env override)
│   ├── request-parser.ts          — RequestMeta 추출
│   ├── sse-state.ts               — 스트리밍 SSE 누적 파서 (token usage 등)
│   ├── system-hash.ts             — system 본문 SHA256 (v22 dedup 키)
│   ├── audit-headers.ts           — 클라이언트/응답 헤더 정규화
│   ├── log-result.ts              — stdout 디버그 출력
│   ├── backfill.ts                — hook 측 model NULL 채움 (v19)
│   └── types.ts                   — RequestMeta, StreamState, AnthropicUsage
│
├── meta-docs/                     — Behavior Definitions 카탈로그 (v24)
│   ├── index.ts                   — barrel
│   ├── scanner.ts                 — 파일 시스템 스캔 (CLAUDE.md/SKILL.md/agents.md)
│   ├── resolver.ts                — cwd → project chain 해석 (`.claude/` 계층)
│   ├── synchronizer.ts            — DB upsert + missing 처리
│   └── known-cwds.ts              — 알려진 cwd 발견 (sessions 테이블 스캔)
│
├── domain/                        — 도메인 변환 계층
│   └── request-normalizer.ts      — Request raw → NormalizedRequest (model 폴백·sub_type·trust)
│
└── cli/                           — `bun run doctor` 진단 명령
    ├── output.ts                  — 컬러 출력 헬퍼
    ├── fix.ts                     — 자동 복구
    └── checks/
        ├── server.ts
        ├── database.ts
        ├── environment.ts
        └── integrity.ts
```

### 4.2 라우터 fan-out (`api.ts`)

`packages/server/src/api.ts:52-85`의 패턴은 **fan-out 우선순위 디스패처**다.

```ts
const SYNC_ROUTERS = [
  sessionsRouter,
  requestsRouter,
  statsRouter,
  dashboardRouter,
  eventsRouter,
  proxyRouter,
  systemPromptsRouter,
  versionRouter,
];

export async function apiRouter(req, db) {
  // 비동기 라우터를 먼저 시도 (본문 파싱이 async)
  const metricsResponse = await metricsRouter(req, db);
  if (metricsResponse) return metricsResponse;
  const metaDocsResponse = await metaDocsRouter(req, db);
  if (metaDocsResponse) return metaDocsResponse;

  // 동기 라우터 fan-out — 첫 non-null 응답이 최종 응답
  for (const handler of SYNC_ROUTERS) {
    const res = handler(req, db, url, path, method);
    if (res) return res;
  }
  return jsonResponse({ success: false, error: 'API endpoint not found' }, 404);
}
```

각 라우터는 **자기 prefix가 아니면 `null`** 을 반환해 다음 라우터로 흘러가게 한다. 새 도메인을 추가하려면 `routes/<domain>.ts`를 만들고 `SYNC_ROUTERS` 배열에 한 줄만 추가한다.

### 4.3 Hook 수집 파이프라인 (Strategy 패턴)

`/collect` 엔드포인트는 Claude Code 훅에서 오는 raw JSON을 처리한다. **`packages/server/src/hook/`**는 Strategy 패턴으로 설계되어 새 이벤트 타입 추가가 1줄(`dispatcher.ts`의 `HANDLERS` 배열)이다.

```
POST /collect
   │
   ▼
hook/http-entry.ts
   │ raw body 추출 + 진단 jsonl 기록
   ▼
hook/dispatcher.ts          REGISTRY: Map<event_name, Handler>
   │ hook_event_name 매칭
   ├─► PreToolUseHandler          (event_type='pre_tool', SSE 브로드캐스트 X)
   ├─► PostToolUseHandler         (event_type='tool', 같은 tool_use_id의 pre 행 UPDATE)
   ├─► UserPromptSubmitHandler    (request_type='prompt', slash_command 추출)
   └─► SystemEventHandler (fallback)  (Notification/SessionStart 등)
   │ handle() → NormalizedHookPayload
   ▼
hook/processor.ts (processHookEvent)
   │ session upsert + turn_id 할당 + audit-meta 정제
   ▼
hook/persist.ts (saveRequest)
   │ DB transaction:
   │   1) sessions UPSERT
   │   2) requests INSERT or UPDATE (pre→tool 머지)
   │   3) persistSubagentChildren (Agent transcript의 자식 tool_use)
   ▼
broadcastNewRequest()           SSE event: 'new_request' { ...norm, event_phase }
broadcastSessionUpdate()        SSE event: 'session_update'
```

핵심 규칙(`CLAUDE.md`에도 명시):

| 상황 | DB 동작 | SSE 동작 |
|------|---------|----------|
| `event_type='pre_tool'` (툴 실행 직전) | INSERT (tokens=0, duration_ms=null) | 브로드캐스트 안 함 |
| `event_type='tool'` (툴 실행 완료) | 같은 `tool_use_id`의 pre 행 UPDATE | DB 실제 id(`pre-xxx`)로 송출 |

쿼리 필터:

- 기본 조회: `event_type IS NULL OR event_type != 'pre_tool' OR tool_name = 'Agent'`
- 통계 쿼리: `event_type IS NULL OR event_type = 'tool'`

### 4.4 Proxy 핸들러 (`/v1/*` opt-in 미러링)

ANTHROPIC_BASE_URL을 spyglass로 설정하면 모든 Anthropic API 호출이 서버를 거친다. 단계별 모듈로 분해(`proxy/handler/*`):

```
client (Claude Code) ─► /v1/messages
    │
    ▼
handleProxy (handler/index.ts)
    │
    ├─ buildInboundContext       — body bytes + headers + 압축(zstd) + hook 매칭 키 추출
    ├─ diagInbound               — 진단 jsonl phase=in
    ├─ forwardToUpstream         — fetch(target) (실패 시 502 매핑)
    ├─ buildResponseHeaders      — CORS + 헤더 정리
    │
    ├─ if SSE stream:
    │   handleStreamResponse (stream.ts)
    │     • body를 클라이언트로 그대로 흘리며 clone으로 분석
    │     • SSE 청크 파싱 → AnthropicUsage 누적 (sse-state.ts)
    │     • 종료 시 persist → broadcast
    │
    └─ if JSON non-stream:
        handleJsonResponse (non-stream.ts)
          • response.json() 한 번 파싱
          • persist (proxy_requests INSERT in tx)
          • broadcastNewProxyRequest (SSE)
```

저장은 `proxy_requests` 테이블(스키마 v14 추가). `hook` 테이블(`requests`)과는 **`api_request_id`로 cross-link**(v19 마이그레이션)되어 같은 API 호출에 대한 hook/proxy 두 측 메타를 매칭할 수 있다.

### 4.5 Metrics 라우터 (`/api/metrics/*`)

`packages/server/src/metrics/router.ts`의 10개 라우트(`metricsRouter`):

| 라우트 | 데이터 소스 | 가공 |
|--------|-------------|------|
| `/api/metrics/model-usage` | `getModelUsageStats` | 백분율 계산 |
| `/api/metrics/cache-matrix` | `getModelCacheMatrix` | hit_rate = read/(input+read) |
| `/api/metrics/context-usage` | `getSessionContextUsage` + `getModelMaxTokens` | 컨텍스트 사용률 4-bucket 히스토그램 |
| `/api/metrics/activity-heatmap` | `getActivityHeatmap` | 7×24 격자 변환 |
| `/api/metrics/turn-distribution` | `getTurnsPerSession` + `getCompactionSessionCount` | 5-bucket |
| `/api/metrics/agent-depth` | `getAgentCallsPerSession` | 0/1/N agent 깊이 |
| `/api/metrics/tool-categories` | `getToolCategoryRawCounts` + `categorizeToolName` | search/exec/edit 등 분류 |
| `/api/metrics/anomalies-timeseries` | `getAnomalyTimeSeriesInputs` | `computeAnomalyTimeSeries` |
| `/api/metrics/burn-rate` | (별도 시계열) | `computeBurnRate` (1h 버킷) |
| `/api/metrics/cache-trend` | (별도 시계열) | `computeCacheTrend` |
| `/api/metrics/proxy-trend` | `stats_proxy_hourly` | `computeProxyTrend` |

공통 쿼리: `?range=24h|7d|30d|all` 또는 `?from=<ms>&to=<ms>`. 가공 알고리즘은 `metrics/calculators/`로 분리되어 단위 테스트가 가능하다.

### 4.6 Meta-docs (Behavior Definitions, v24)

Claude Code의 `.claude/agents/`, `.claude/skills/`, `~/.claude/commands/`, `CLAUDE.md` 등 **모델 동작을 정의하는 markdown 파일**을 자동 스캔하여 `meta_documents` 테이블에 카탈로그화한다.

```
server boot
   │
   ├─ discoverKnownCwds(db)            — sessions 테이블에서 cwd 후보 모음
   │
   ├─ bootstrapMetaDocsSync            — 글로벌(~/.claude) 1회 스캔
   │
   └─ (≤10 cwd) syncCwd 동기 / (>10) setImmediate 백그라운드
        │
        ▼
syncCwd(cwd)
   │
   ├─ resolveProjectChain(cwd)         — ~/.claude → <project>/.claude 체인
   ├─ scanRoot(root)                   — 각 디렉토리에서 SKILL.md/agents/CLAUDE.md 파일 모음
   ├─ upsertMetaDocument               — 파일별 dedup INSERT
   ├─ markMissingAsDeleted             — 디스크 사라진 항목은 soft delete
   └─ replaceResolutionsForCwd         — cwd ↔ doc 매핑 갱신
```

SessionStart 훅이 새 cwd를 감지하면 lazy 재동기화한다.

### 4.7 SSE 채널

`packages/server/src/sse.ts`의 외부 노출 함수:

| 함수 | 이벤트 타입 | 페이로드 |
|------|-------------|----------|
| `broadcastNewRequest(req, meta)` | `new_request` | `NormalizedRequest + session_total_tokens + event_phase` |
| `broadcastNewProxyRequest(p)` | `new_proxy_request` | `ProxyBroadcastPayload (source='proxy')` |
| `broadcastSessionUpdate(s)` | `session_update` | `{ session_id, action: 'started'\|'ended'\|'token_update', ... }` |

연결 관리는 단일 `Set<ReadableStreamDefaultController<Uint8Array>>`. 8초 간격 `ping` 이벤트로 idle 연결 유지(`idleTimeout: 0`과 함께 작동). 송신 실패한 연결은 자동 정리.

핵심 디자인 결정(ADR-002, log-view-unification):
- `new_request` 페이로드는 `event_phase: 'created' | 'updated'` discriminator로 신규 vs in-place 갱신을 구분 (별도 이벤트 타입 신설 없이).
- 클라(웹/TUI)는 `data-request-id` 존재 여부로 prepend vs in-place 갱신 분기.

---

## 5. `packages/storage` — SQLite 영속 계층

> **TL;DR** — 32개 마이그레이션이 누적된 SQLite(WAL 모드). `index.ts` barrel이 80여 개 함수를 한 곳에서 노출하며, 시간대별 사전 집계(`stats_hourly`)로 차트 응답 시간을 5ms 수준으로 유지한다.

### 5.1 디렉토리 구조

```
packages/storage/
├── migrations/                    — 32개 SQL 마이그레이션 (001 ~ 032)
│   ├── 001-init.sql                          — sessions, requests 테이블 초기 생성
│   ├── 002-add-tool-detail.sql               — requests.tool_detail
│   ├── 003-add-turn-id.sql                   — requests.turn_id (인터리빙 식별)
│   ├── 004-add-source.sql                    — requests.source ('hook' / 'proxy')
│   ├── 005-add-cache-tokens.sql              — cache_creation/read_tokens
│   ├── 006-add-claude-events.sql             — claude_events 테이블 (SessionStart 등)
│   ├── 007-add-preview.sql                   — requests.preview (UI 짧은 미리보기)
│   ├── 008-add-tool-use-and-event-type.sql   — tool_use_id, event_type
│   ├── 009-update-skill-agent-tool-detail.sql
│   ├── 010-restore-preview.sql
│   ├── 011-token-confidence-and-event-columns.sql
│   ├── 012-timestamp-index-and-visible-view.sql
│   ├── 013-add-metadata.sql
│   ├── 014-add-proxy-requests.sql            — proxy_requests 테이블 (HTTP 레벨 메트릭)
│   ├── 015-proxy-requests-enrich.sql         — 컬럼 + correlated_requests VIEW
│   ├── 016-add-response-type.sql             — type CHECK 'response' 추가
│   ├── 017-add-parent-tool-use-id.sql        — Agent 부모-자식 매핑
│   ├── 018-cleanup-and-correlation.sql       — sentinel 삭제, correlated_requests 재정의
│   ├── 019-proxy-hook-cross-link.sql         — api_request_id, session_id/turn_id (header 매칭)
│   ├── 020-payload-audit-fields.sql          — permission_mode 등 16개 감사 컬럼
│   ├── 021-proxy-payload-compression.sql     — zstd 압축 페이로드 BLOB + system_reminder
│   ├── 022-system-prompts.sql                — system_prompts dedup 테이블
│   ├── 023-proxy-tool-uses.sql               — tool_use_id ↔ api_request_id 정확 매핑
│   ├── 024-meta-documents.sql                — Behavior Definitions 카탈로그
│   ├── 025-composite-event-type-indexes.sql
│   ├── 026-model-limits-table.sql            — 모델별 context window SSoT
│   ├── 027-add-stats-hourly.sql              — stats_hourly 사전 집계 테이블
│   ├── 028-add-stats-triggers.sql            — requests → stats_hourly 자동 집계 트리거
│   ├── 029-backfill-stats-hourly.sql
│   ├── 030-stats-event-type-dim.sql
│   ├── 031-stats-duration-avg-fix.sql
│   └── 032-add-stats-proxy-hourly.sql        — stats_proxy_hourly 사전 집계
│
└── src/
    ├── index.ts                   — 304줄. 외부 노출 barrel — 함수 80여 개 re-export.
    ├── schema.ts                  — 테이블 SQL, WAL pragma, Session/Request 타입, SCHEMA_VERSION.
    ├── connection.ts              — SpyglassDatabase 클래스, 싱글톤 getDatabase, 권한 강화(chmod 600/700).
    ├── migrator.ts                — runMigrations: NNN-*.sql 파일 스캔 + PRAGMA user_version 관리.
    ├── pricing.ts                 — 모델별 단가 캐시.
    │
    ├── queries/
    │   ├── session.ts             — 호환 shim. queries/session/index로 위임.
    │   ├── session/               — SRP 분해
    │   │   ├── index.ts           — barrel
    │   │   ├── read.ts            — getSessionById, getActiveSessions, ...
    │   │   ├── write.ts           — createSession, updateSession, endSession, ...
    │   │   ├── aggregate.ts       — getSessionStats, getProjectStats
    │   │   ├── retention.ts       — deleteOldSessions, deleteOldData
    │   │   ├── types.ts           — CreateSessionParams 등
    │   │   └── _shared.ts         — buildLiveStateColumn (live_state CASE 표현식 SSoT)
    │   │
    │   ├── request.ts             — 호환 shim
    │   ├── request/               — SRP 분해 (ADR-007)
    │   │   ├── index.ts           — barrel
    │   │   ├── read.ts            — ACTIVE_REQUEST_FILTER_SQL SSoT 정의
    │   │   ├── write.ts           — createRequest, updateRequest 등
    │   │   ├── aggregate-general.ts  — 헤더/요약 카드용 통계
    │   │   ├── aggregate-tool.ts     — 도구 성능 통계 (세션/프로젝트 범위)
    │   │   ├── aggregate-time.ts     — 시계열(시간대별)
    │   │   ├── aggregate-latency.ts  — P50/P95 응답시간
    │   │   ├── aggregate-strip.ts    — Command Center Strip (TUI)
    │   │   ├── aggregate-cache.ts    — 캐시 히트율
    │   │   └── turn.ts               — getTurnsBySession (인터리빙)
    │   │
    │   ├── metrics/               — Observability metrics
    │   │   ├── index.ts
    │   │   ├── usage.ts           — model usage / cache matrix / context usage
    │   │   ├── activity.ts        — heatmap / turn / agent / tool category
    │   │   └── timeseries.ts      — burn-rate / cache-trend bucket
    │   │
    │   ├── stats/                 — 사전 집계 빌더
    │   │   ├── build-aggregate.ts        — stats_hourly 재빌드
    │   │   └── build-proxy-aggregate.ts  — stats_proxy_hourly 재빌드
    │   │
    │   ├── event.ts               — claude_events CRUD (SessionStart/Stop 등)
    │   ├── metadata.ts            — get/setMetadata (k/v store)
    │   ├── proxy.ts               — proxy_requests CRUD + tool_uses
    │   ├── proxy-stats.ts         — getProxyHourlyStats(ByModel)
    │   ├── system-prompt.ts       — v22 dedup 카탈로그
    │   ├── meta-document.ts       — v24 Behavior Definitions
    │   ├── model-limits.ts        — v26 모델 context window
    │   └── metrics.ts             — 호환 shim (queries/metrics/ 로 위임)
    │
    ├── domain/
    │   └── session-status.ts      — countLiveSessions/listVisibleSessions 등 (visible/LIVE SSoT)
    │
    └── scripts/
        ├── rebuild-stats.ts             — 전체 stats_hourly 재빌드 (`bun run rebuild-stats`)
        └── rebuild-stats-proxy.ts       — proxy 사전 집계 재빌드
```

### 5.2 핵심 테이블

#### `sessions`
```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,           -- Claude Code session_id
  project_name TEXT NOT NULL,
  started_at INTEGER NOT NULL,   -- epoch ms
  ended_at INTEGER,              -- null이면 진행 중
  total_tokens INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);
-- + last_activity_at, first_prompt_payload (이후 마이그레이션)
```

핵심 derive 컬럼: **`live_state`** ('live'|'stale'|'ended') — DB가 아니라 SELECT 시 `_shared.buildLiveStateColumn`의 `CASE` 표현식으로 산출 (SSoT, `LIVE_STALE_THRESHOLD_MS` 기준).

#### `requests`
```sql
CREATE TABLE requests (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  timestamp INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('prompt', 'tool_call', 'system', 'response')),
  tool_name TEXT,
  tool_detail TEXT,              -- v2: 'Read:/path/to/file.ts' 등 사람 읽기 좋은 표현
  turn_id TEXT,                  -- v3: prompt → tool* → response 인터리빙 묶음 식별자
  model TEXT,
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  tokens_total INTEGER DEFAULT 0,
  cache_creation_tokens INTEGER, -- v5
  cache_read_tokens INTEGER,     -- v5
  duration_ms INTEGER,
  payload TEXT,                  -- raw hook JSON
  source TEXT,                   -- v4: 'hook' or 'proxy'
  preview TEXT,                  -- v7,v10: 짧은 UI 미리보기 (≤500자)
  tool_use_id TEXT,              -- v8: pre→tool 머지 키
  event_type TEXT,               -- v8: 'pre_tool'|'tool'|'prompt'|'system'
  tokens_confidence TEXT,        -- v11: 'high'|'error'
  tokens_source TEXT,            -- v11: 'transcript'|'proxy'|'unavailable'
  parent_tool_use_id TEXT,       -- v17: Agent 자식 → 부모 매핑
  api_request_id TEXT,           -- v19: Anthropic 응답 ID (proxy_requests와 cross-link)
  -- v20 감사 메타 (16개):
  permission_mode TEXT,
  agent_id TEXT,
  agent_type TEXT,
  tool_interrupted INTEGER,
  tool_user_modified INTEGER,
  -- ...
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);
```

인덱스: `idx_requests_session`, `idx_requests_type`, `idx_requests_tokens`, `idx_requests_session_type`, `idx_requests_tool_use_id`, `idx_requests_parent_tool_use_id`, v25 복합 `event_type` 인덱스 등.

#### `claude_events`
SessionStart, Stop, SessionEnd, Notification, PreCompact 등 **상태 이벤트**를 별도 테이블로 보관(`requests`와 직교).

#### `proxy_requests`
HTTP 레벨 미러링(`/v1/*`) 결과. `messages_count`, `tools_count`, `first_token_ms`, `tokens_per_second`, `stop_reason`, `request_preview`, `response_preview`, `error_*`, `system_hash`, `system_byte_size` 등.

#### `system_prompts` (v22)
```sql
-- content-addressable dedup. 같은 system 본문은 1행만 저장.
CREATE TABLE system_prompts (
  hash TEXT PRIMARY KEY,           -- SHA256(content)
  content TEXT NOT NULL,           -- 본문 (zstd 압축 가능, 28KB 상한)
  byte_size INTEGER NOT NULL,
  ref_count INTEGER DEFAULT 1,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
```

`proxy_requests.system_hash`로 참조. UI에서는 **본문 lazy-fetch** (`GET /api/system-prompts/:hash`)로 N+1 페이로드 부담 회피.

#### `meta_documents` (v24)
SKILL.md / agents.md / CLAUDE.md / commands 파일별 1행. type, source, file_path, content, last_modified, status. cwd 매핑은 `meta_doc_resolutions` 정규화 테이블.

#### `stats_hourly` / `stats_proxy_hourly` (v27, v32)
1시간 버킷 사전 집계. 트리거(v28)로 `requests` INSERT 시 자동 갱신. 24h 차트는 raw scan 대신 이 테이블을 쿼리.

#### `model_limits` (v26)
모델별 context window 한도 시드. 1M opt-in(`anthropic-beta` 헤더 반영)까지 처리.

### 5.3 연결 관리 (`connection.ts`)

`SpyglassDatabase` 클래스(`packages/storage/src/connection.ts:61`):

- **WAL 모드 강제**: `journal_mode = WAL`, `synchronous = NORMAL`, `cache_size = -64000`(64MB), `wal_autocheckpoint = 200`(성능 튜닝).
- **권한 강화**: 인스턴스 생성 시 DB 파일(`0o600`)·디렉토리(`0o700`) chmod (best-effort).
- **트래킹 셋**: `trackedInstances`로 직접 new된 인스턴스도 추적해 `closeDatabase()` 시 일괄 정리(테스트 fixture 안정성).
- **싱글톤**: `globalInstance` + `getDatabase(options?)`. 첫 호출만 새로 생성.
- **체크포인트**: `close()`에서 `PRAGMA wal_checkpoint(TRUNCATE)` 강제 — WAL/-shm 잔존으로 인한 disk I/O error 차단.

### 5.4 마이그레이터 (`migrator.ts`)

```ts
runMigrations(db, debug?):
  1) currentVersion = PRAGMA user_version
  2) readdir migrations/, sort by filename
  3) for each `NNN-*.sql`:
       if NNN > currentVersion:
         BEGIN TRANSACTION
         splitSqlStatements(sql).forEach(stmt => db.prepare(stmt).run())
         PRAGMA user_version = NNN
         COMMIT  (or ROLLBACK on error)
```

`splitSqlStatements`는 단순 `split(';')`가 아니라 `BEGIN ... END;` 블록(트리거 정의)을 placeholder로 보존했다가 복원한다. v28 stats 트리거를 안전하게 처리하기 위한 장치.

### 5.5 외부 노출 모듈 — `index.ts` barrel

`packages/storage/src/index.ts:21-304`는 80개 이상 함수·타입을 한 곳에서 re-export한다. 사용 패턴(`@spyglass/server`, `@spyglass/tui` 양쪽 동일):

```ts
import { getDatabase, createSession, getRequestsBySession, broadcastNewRequest } from '@spyglass/storage';
```

내부 파일 분해(예: `queries/request/`) 결과를 다시 합치는 SSoT 진입점. 호출자는 `queries/request/aggregate-tool.ts` 같은 내부 경로를 알 필요 없다.

### 5.6 사전 집계 (stats_hourly)

마이그레이션 v27~v32는 **트리거 기반 사전 집계**를 도입했다.

```
requests INSERT
   │
   ▼ AFTER INSERT trigger (v28)
INSERT INTO stats_hourly
  (hour_bucket, session_id, type, event_type, model, ...)
VALUES (...)
ON CONFLICT DO UPDATE SET
  request_count = request_count + 1,
  tokens_total = tokens_total + NEW.tokens_total,
  ...
```

24h 차트(`/api/metrics/burn-rate`, `/api/metrics/cache-trend`)는 raw `requests` 스캔 대신 사전 집계 테이블을 쿼리하여 응답 시간 ~5ms 유지.

재빌드: `bun run rebuild-stats` (`packages/storage/src/scripts/rebuild-stats.ts`).

---

## 6. `packages/tui` — Ink 기반 터미널 UI

> **TL;DR** — React 18 + Ink 5 기반 터미널 UI. `useSyncExternalStore` 기반 ring buffer로 SSE 폭주를 흡수하고, microtask 배칭으로 리렌더를 합친다. 키바인딩 한 표(§6.6)로 모든 조작이 정리된다.

### 6.1 디렉토리 구조

```
packages/tui/
├── locales/                  — i18n JSON (ko/en/ja/zh)
└── src/
    ├── index.tsx             — 20줄. initI18n + ink.render(<App/>)
    ├── app.tsx               — 294줄. 루트 컴포넌트(상태, 키보드, 뷰 라우팅)
    ├── design-tokens.ts      — 색상·간격·타이포·breakpoint 토큰
    ├── types.ts              — Request, Session, ScreenId 타입
    ├── i18n.ts               — react-i18next 초기화
    ├── asciichart.d.ts       — asciichart 타입 보강
    │
    ├── components/
    │   ├── primitives/index.tsx        — Text/Box 래퍼 + 기본 toggle
    │   ├── layout/
    │   │   ├── ResponsiveShell.tsx     — useTermCols/Rows + sidebar/main 그리드
    │   │   ├── Sidebar.tsx             — 좌측: 세션 리스트
    │   │   ├── Strip.tsx               — 상단 KPI strip (3 BigKpi)
    │   │   └── MainPanel.tsx
    │   ├── nav/
    │   │   ├── TabBar.tsx              — live/sessions/tools/anomalies 탭
    │   │   └── StatusBar.tsx           — 하단 키 hint + SSE 상태
    │   ├── display/
    │   │   ├── BigKpi.tsx              — Strip의 큰 숫자 카드
    │   │   ├── Badge.tsx
    │   │   ├── Card.tsx
    │   │   ├── KeyValue.tsx
    │   │   ├── Ticker.tsx              — 실시간 카운터 (애니메이션)
    │   │   ├── Timestamp.tsx
    │   │   ├── TokenTree.tsx           — JSON tree 렌더
    │   │   ├── ToolRow.tsx             — 도구 호출 한 줄
    │   │   ├── TurnCard.tsx            — 턴 카드 (세션 디테일)
    │   │   ├── Divider.tsx
    │   │   └── Icon.tsx
    │   ├── charts/
    │   │   ├── Sparkline.tsx           — asciichart 1차원
    │   │   ├── BarChart.tsx
    │   │   └── Gauge.tsx
    │   ├── signature/
    │   │   └── PulseWave.tsx           — 상단 6행 펄스 파형 (실시간 토큰량)
    │   ├── feedback/
    │   │   ├── PanelBoundary.tsx       — error boundary (Ink에서 제공 안 됨, 자체 구현)
    │   │   ├── Spinner.tsx
    │   │   ├── StalenessIndicator.tsx
    │   │   └── RowAccent.tsx
    │   └── overlays/
    │       └── HelpOverlay.tsx         — '?' 키 단축키 도움말 모달
    │
    ├── screens/
    │   ├── LiveFeed.tsx                — 실시간 요청 피드 (메인 화면)
    │   ├── Sessions.tsx                — 세션 리스트
    │   ├── SessionDetail.tsx           — 세션 디테일 (turn 인터리빙)
    │   ├── Tools.tsx                   — 도구 사용 통계 (time-range cycle)
    │   ├── Anomalies.tsx               — 이상치 시계열
    │   └── Ambient.tsx                 — 'm' 키: 풀스크린 ambient 모드
    │
    ├── stores/
    │   └── feed-store.ts               — useSyncExternalStore 외부 store + ring buffer
    │
    ├── hooks/
    │   ├── useSSE.ts                   — EventSource 연결 + pulse bucket 누적
    │   ├── useFeed.ts                  — feed-store 구독
    │   ├── useStripStats.ts            — /api/dashboard 폴링
    │   ├── useToolsAnalytics.ts        — /api/metrics/tool-* 폴링
    │   ├── useProxyRequests.ts         — proxy 데이터 폴링
    │   ├── useSessionTurns.ts          — 세션 디테일 turn 조회
    │   ├── useFollowMode.ts            — 자동 스크롤
    │   ├── useKeyboard.ts              — Ink useInput 추상화
    │   └── useCapabilities.tsx         — 터미널 capability (truecolor/256/16, unicode 등) Provider
    │
    └── lib/
        ├── capabilities.ts             — 터미널 환경 감지 (NO_COLOR, TERM 등)
        ├── current-project.ts          — SPYGLASS_ALL_PROJECTS env 처리
        ├── detect-lang.ts              — LANG / LC_ALL 파싱
        ├── format.ts                   — 토큰 포맷 (1.2k / 3.4M), duration 포맷
        ├── gradient.ts                 — 색상 그라데이션
        ├── time-range.ts               — 1h / 6h / 24h / 7d cycle
        └── tool-icon.ts                — 도구별 이모지/심볼 매핑
```

### 6.2 진입점

`packages/tui/src/index.tsx`(20줄):
```tsx
import { render } from 'ink';
import { initI18n } from './i18n';
import { detectLang } from './lib/detect-lang';
import { App } from './app';

await initI18n(detectLang());
const { waitUntilExit } = render(<App />);
waitUntilExit().then(() => process.exit(0), () => process.exit(1));
```

### 6.3 루트 컴포넌트 — `App` (`app.tsx`)

`App`이 보유하는 상태는 view·zoom·activeSessionId·timeRange 네 가지가 전부이며, 나머지는 hook으로 위임된다.

| 책임 | 위임 대상 |
|------|-----------|
| SSE 연결과 KPI 버킷 누적 | `useSSE(API_URL)` |
| 대시보드/스트립 통계 폴링 | `useStripStats(API_URL)` |
| 키보드 단축키(§6.6) | `useKeyboard({ onView, onMove, onEnter, ... })` |
| 터미널 capability 감지 | `<CapabilitiesProvider>` |
| 레이아웃 분기 | `<ResponsiveShell sidebar main>` |

JSX 구조(간략):

```tsx
<CapabilitiesProvider>
  <Box flexDirection="column" height={rows}>
    <TabBar />
    <PulseWave buckets={pulseBuckets} height={6} />
    <Strip stats={strip} activeSessions={...} />
    <ResponsiveShell sidebar={<Sidebar />} main={renderMain({ view, ... })} />
    <StatusBar hints={hintsFor(view, timeRange)} />
    {helpOpen && <HelpOverlay />}
  </Box>
</CapabilitiesProvider>
```

### 6.4 SSE 클라이언트 (`useSSE.ts`)

`packages/tui/src/hooks/useSSE.ts`는 `EventSource(NodeEventSource)`로 `/events`에 연결한다.

**구성 요소**

| 요소 | 값/동작 |
|------|---------|
| 슬라이딩 윈도우 | 10초 버킷 × 180개 = 30분 |
| 이벤트 수신 | `new_request` → `feedStore.push` + 토큰/요청 버킷 증가 |
| 틱 | 1초 간격 `tick()` — 버킷 shift + `eventsPerSec` 계산 |
| 재연결 | 지수 백오프 1s → 15s |

핵심 리스너 발췌:

```ts
es.addEventListener('new_request', (ev) => {
  const data = JSON.parse(ev.data).data;
  feedStore.push(data);                   // microtask 배칭 후 1회 리렌더
  buckets.current[BUCKET_COUNT-1] += data.tokens_total;
  // ... 카운터 갱신 생략
});
```

### 6.5 외부 store (`feed-store.ts`)

React 18의 `useSyncExternalStore` 컨트랙트를 구현한 ring buffer:

- **CAPACITY**: `tokens.buffer.feedMax`(예: 500). 초과 시 가장 오래된 항목 drop.
- **byKey**: `Map<tool_use_id | id, index>` — O(1) in-place 갱신. `pre_tool`→`tool` 머지가 핵심 사용 사례.
- **microtask 배칭**: 같은 tick에 도착한 N건의 SSE 이벤트를 `queueMicrotask`로 모아 1회 flush — Ink 리렌더 폭주 방지.
- **freeze**: 사용자가 'f' 키로 follow-mode 해제 시 push가 누적 카운터만 증가. unfreeze 시 drop된 개수 반환.

### 6.6 키바인딩 (`useKeyboard.ts`)

| 키 | 동작 |
|----|------|
| `1/2/3/4` | live / sessions / tools / anomalies 탭 |
| `↑↓ jk` | 세션 선택 이동 |
| `⏎` | session-detail 진입 |
| `esc` | session-detail → sessions 복귀 |
| `f` | follow-mode 토글 (스크롤 lock) |
| `g/G` | 맨 위 / 맨 아래 |
| `t` | time-range cycle (1h→6h→24h→7d) |
| `m` | ambient 모드 토글 |
| `z` | zoom (사이드바 숨김) |
| `?` | help overlay |
| `q` | 종료 |

---

## 7. `packages/web` — Vanilla JS 대시보드

> **TL;DR** — 빌드 도구 없이 ES Modules로 동작하는 단일 페이지. 핵심 렌더 함수 4개(`toolIconHtml`·`makeTargetCell`·`makeRequestRow`·`prependRequest`)가 SSoT이며, `CLAUDE.md`의 캡슐화 원칙을 직접 구현한다.

### 7.1 디렉토리 구조

```
packages/web/
├── index.html                — 803줄. 단일 페이지 + skeleton placeholder + i18n attribute
├── favicon.svg
├── locales/                  — i18n JSON (ko/en/ja/zh, html · ui · domain 키)
└── assets/
    ├── css/
    │   ├── design-tokens.css
    │   ├── design-system/
    │   ├── card.css, state.css, table.css, badges.css
    │   ├── header.css, left-panel.css, layout.css
    │   ├── cache-panel.css, context-chart.css, llm-input.css
    │   ├── meta-docs.css, tool-stats.css, obs-panel.css
    │   ├── syslib.css (system prompt library)
    │   ├── default-view.css, detail-view.css, turn-view.css
    │   ├── keyboard-help.css, skeleton.css
    │   └── app-rail.css
    │
    └── js/
        ├── main.js                  — 진입점 (ES module). 초기화, SSE 연결, 이벤트 위임.
        ├── api.js                   — fetch wrapper (timeWindow, dashboard, requests, sessions, ...)
        ├── state.js                 — appMode, selectedProject/Session, rightView 등 sessionStorage 영속 상태
        ├── sse.js                   — connectSSE: EventSource → handleNewRequest 등
        ├── events.js                — addEventListener 위임 유틸
        ├── infra.js                 — 에러 배너, scroll lock 등
        │
        ├── chart.js                 — Canvas 기반 30분 sliding 차트 (실시간)
        ├── context-chart.js         — 세션 디테일의 컨텍스트 사용량 차트
        ├── context-window.js        — Anthropic-beta 반영 max tokens 산출
        ├── sparkline.js
        │
        ├── renderers.js             — toolIconHtml / makeTargetCell / makeRequestRow 등 핵심 렌더 함수
        ├── render/
        │   ├── badges.js, cells.js, expand.js, extract.js
        │   ├── icons.js, model.js, rows.js, skeleton.js
        ├── components/
        │   ├── filter-bar.js
        │   └── search-box.js
        ├── design-system/
        │
        ├── views/
        │   ├── default-view.js      — 기본 뷰(피드)
        │   ├── detail-view.js       — 세션 디테일 뷰
        │   └── _shared/
        │
        ├── session-detail/
        │   ├── index.js
        │   ├── state.js
        │   ├── flat-view.js         — 평면 행 렌더링
        │   ├── turn-rows.js / turn-views.js   — turn 인터리빙 카드
        │   ├── system-reminder.js, system-reminder-popover.js
        │
        ├── left-panel.js                  — 프로젝트/세션 리스트
        ├── panel-resize.js                — 사이드바 너비 드래그
        ├── left-panel-vertical-resize.js  — 상하 분할 드래그
        ├── col-resize.js                  — 테이블 컬럼 드래그
        │
        ├── obs-panel.js                   — 좌측 옵저빌리티 4카드 (burn/cache/pulse/tools)
        ├── obs-tooltip.js
        ├── stat-tooltip.js
        ├── cache-tooltip.js, cache-panel-tooltip.js, cache-panel.js
        │
        ├── llm-input-view.js              — system blocks + user messages 합본 (v22)
        ├── system-prompt-library.js       — v22 dedup 카탈로그 카드
        ├── meta-docs-view.js              — v24 Behavior Definitions 카탈로그
        ├── tool-colors.js, tool-stats.js  — 도구 매트릭스 통계
        │
        ├── metrics-api.js                 — /api/metrics/* 호출 모음
        ├── formatters.js                  — fmtToken, fmtDuration 등
        ├── request-types.js
        ├── version-check.js               — 업데이트 모달 트리거
        ├── anomaly.js                     — anomaly 배지
        ├── app-rail.js                    — 좌측 56px 모드 rail
        ├── lang-switcher.js, i18n.js, i18n-dom.js
        └── dom-preserve.js                — 부분 DOM 보존 (전체 교체 회피)
```

### 7.2 모듈 시스템

빌드 도구 없이 **ES Modules**로 동작 — `<script type="module" src="/assets/js/main.js"></script>`.

`packages/server/src/runtime/dispatch.ts`의 `/assets/*` 정적 핸들러가 그대로 서빙한다. 변경 시 브라우저 새로고침만으로 반영(빌드 X). 단점은 트리 셰이킹·번들링이 없다는 것이지만, 화면 무게가 가벼워 영향이 작다.

### 7.3 핵심 렌더 함수 (CLAUDE.md SSoT)

| 함수 | 파일 | 책임 |
|------|------|------|
| `toolIconHtml(toolName, eventType)` | `renderers.js` | 툴 아이콘. `eventType='pre_tool'`이면 pulse 애니메이션(`.tool-icon-running`) 자동 적용. **반드시 두 번째 인자 전달.** |
| `makeTargetCell(r)` | `renderers.js` | Target 컬럼 전체(아이콘 + 이름 + 상태배지). |
| `makeRequestRow(r, opts)` | `renderers.js` | 로그 피드 행 1줄. |
| `prependRequest(r)` | `views/default-view.js` | SSE 이벤트로 수신된 레코드를 피드 최상단에 추가. 동일 `id` 행이 있으면 in-place 갱신(위치 보존). |

`CLAUDE.md`의 캡슐화 원칙: **호출 측에서 `boolean`으로 재계산하지 말고, raw data를 함수에 전달하고 판단은 함수 내부에서 처리.**

### 7.4 SSE 클라이언트 (`sse.js`)

`new_request` 이벤트 분기는 `event_phase`에 의해 결정된다.

| `event_phase` | 처리 |
|---------------|------|
| `'updated'` | `data-request-id` 요소를 찾아 in-place 갱신 (위치 보존) |
| `'created'` (기본) | `prependRequest(data)` + detail-view 갱신 |

```js
es.addEventListener('new_request', (ev) => {
  const data = JSON.parse(ev.data).data;
  if (data.event_phase === 'updated') updateRequestInPlace(data);
  else { prependRequest(data); refreshDetailIfMatches(data); }
});
// 'new_proxy_request', 'session_update', 'error' 핸들러 등록 생략
```

### 7.5 좌측 모드 rail (ADR-003)

`index.html:49-73`의 `.app-rail`:
- **browse 모드** (기본): 프로젝트/세션 탐색.
- **metadocs 모드**: Behavior Definitions 카탈로그(v24).

전환은 `body[data-app-mode]` 속성만 토글 — CSS 셀렉터(`body[data-app-mode="metadocs"] .right-panel { display:none }`)가 가시성을 처리하고 JS는 부수 흐름(이전 선택 복원 등)만 담당.

### 7.6 디자인 시스템

`assets/css/design-system/`의 토큰(`design-tokens.css`)과 primitive 컴포넌트. CSS 변수 SSoT:

```css
:root {
  --bg: #0a0e14;
  --border: #2a3441;
  --text-dim: #5a6b7a;
  --color-primary: #4ec9b0;
  --radius-md: 6px;
  /* ... */
}
```

스켈레톤(`assets/css/skeleton.css`): 첫 paint 시 `data-skeleton="1"` 자식이 깜빡임 없이 자리를 잡고, 실제 데이터 도착 시 `innerHTML` 교체로 자연 제거.

---

## 8. `packages/types` — 공통 타입 contract

> **TL;DR** — 런타임 코드 0줄. server·tui·web이 공유하는 TS 타입만 모은 패키지로, 타입 변경 이유의 단일성(SRP)을 보장한다.

### 8.1 의도

`packages/types/src/index.ts:1-32`의 헤더 주석에 모든 게 적혀 있다.

> **런타임 코드 0줄. TS 타입 선언만 모은 패키지 (ADR-006, srp-redesign).**
>
> 사용처:
> - `packages/server`: `server/domain/request-normalizer.ts`가 이 타입을 import + re-export
> - `packages/tui`: `types.ts`가 NormalizedRequest를 직접 import
> - `packages/web`: JSDoc `@typedef` import로 IDE 힌트 (런타임 비의존)
>
> **변경 정책**: 타입 추가/변경은 이 패키지에서만 한다(SRP — 변경 이유 단일성). server·TUI는 import만 하므로 단일 변경에 자동 동기화.

### 8.2 노출 타입

```ts
// request.ts
export type RequestType = 'prompt' | 'tool_call' | 'system' | 'response';
export interface RequestRow { /* DB column 1:1 매핑, 30개 필드 */ }
export type RequestSubType = 'agent' | 'skill' | 'task' | 'mcp' | null;
export type TrustLevel = 'trusted' | 'unknown' | 'synthetic' | 'estimated';
export type EventPhase = 'created' | 'updated';
export interface NormalizedRequest extends Omit<RequestRow, 'model'> {
  sub_type: RequestSubType;
  trust_level: TrustLevel;
  model: string | null;                  // turn 폴백 적용 후
  model_fallback_applied: boolean;
}

// turn.ts
export interface NormalizedTurnItem { /* prompt → tool* → response 인터리빙 단위 */ }

// session.ts
export interface Session { id, project_name, started_at, ended_at, total_tokens, live_state, ... }

// i18n.ts
export type Lang = 'ko' | 'en' | 'ja' | 'zh';
export const SUPPORTED_LANGS: readonly Lang[];
export const DEFAULT_LANG: Lang;
export function isLang(s): s is Lang;
export function resolveLang(input): Lang;
```

### 8.3 비책임

- DB 저장 / 쿼리 → `packages/storage`.
- SSE 송출 → `packages/server`.
- HTML 렌더 → `packages/web`.

타입 변경의 변경 이유는 **단일**(스키마 의미가 바뀜)이므로 한 패키지에 모아둔다. server는 `request-normalizer.ts`에서 `export type` re-export로 외부 import 호환을 보존한다 — 호출자 시그니처(`from './domain/request-normalizer'`)는 변경 없음.

---

## 9. 통신 인터페이스

> **TL;DR** — HTTP API는 도메인별 라우터로 정리되어 있고, Hook은 stdin JSON contract, SSE는 `new_request`·`new_proxy_request`·`session_update` 세 이벤트 타입을 사용한다. 클라이언트는 `event_phase` discriminator로 신규/갱신을 구분한다.

### 9.1 HTTP API 일람

#### 일반
| 메서드 | 경로 | 응답 |
|--------|------|------|
| GET | `/health` | `{ status: 'ok', timestamp, version }` |
| GET | `/` (Accept:json) | `{ name, version, endpoints }` |
| GET | `/` (Accept:html) | `packages/web/index.html` |

#### Hook 수집
| 메서드 | 경로 | 본문 | 동작 |
|--------|------|------|------|
| POST | `/collect` | `ClaudeHookPayload` | dispatcher → handler → DB 저장 → SSE |
| POST | `/events` | raw hook JSON | `claude_events` 저장 (SessionStart/Stop 등) |

#### SSE
| 메서드 | 경로 | 응답 헤더 | 이벤트 |
|--------|------|-----------|--------|
| GET | `/events` | `text/event-stream` | `new_request`, `new_proxy_request`, `session_update`, `ping` |

#### REST API (`/api/*`)
| 라우터 | 주요 라우트 |
|--------|-------------|
| `routes/dashboard.ts` | `GET /api/dashboard?range=...` (응답 캐시) |
| `routes/sessions.ts` | `GET /api/sessions/active`, `/:id`, `/:id/requests`, `/:id/turns`, `/by-project`, ... |
| `routes/requests.ts` | `GET /api/requests/recent`, `/:id`, `/top-tokens` |
| `routes/stats.ts` | `GET /api/stats/sessions`, `/requests`, `/cache`, `/proxy`, `/proxy/by-model` |
| `routes/proxy.ts` | `GET /api/proxy/recent`, `/by-session/:id`, `/:id` |
| `routes/system-prompts.ts` | `GET /api/system-prompts`, `/:hash` (v22 lazy fetch) |
| `routes/meta-docs.ts` | `GET /api/meta-docs`, `POST /api/meta-docs/refresh` (v24) |
| `routes/version.ts` | `GET /api/version` (current + latest) |
| `metrics/router.ts` | `GET /api/metrics/{model-usage,cache-matrix,context-usage,activity-heatmap,turn-distribution,agent-depth,tool-categories,anomalies-timeseries,burn-rate,cache-trend,proxy-trend}` |

#### 프록시 (opt-in)
| 메서드 | 경로 | 동작 |
|--------|------|------|
| `*` | `/v1/*` | Anthropic 또는 ANTHROPIC_BASE_URL upstream으로 forward + 메타 수집 |

#### 정적
| 경로 | 매핑 |
|------|------|
| `/assets/*` | `packages/web/assets/*` |
| `/locales/*` | `packages/web/locales/*` |
| `/favicon.svg`, `/favicon.ico` | `packages/web/favicon.*` |

### 9.2 Hook 수집 — STDIN 입력 contract

Claude Code의 hook 시스템은 등록된 스크립트를 호출하면서 stdin으로 JSON을 전달한다. spyglass는 `hooks/spyglass-collect.sh`를 등록한다(`settings.json`의 hooks 항목).

```bash
# hooks/spyglass-collect.sh:101-133
if [[ ! -t 0 ]]; then
    payload=$(cat)
    echo "$payload" >> "$SPYGLASS_RAW_LOG"     # 1. 원장 기록 (~/.spyglass/logs/hook-raw.jsonl)

    hook_event=$(python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('hook_event_name',''))" <<< "$payload")

    case "$hook_event" in
      "UserPromptSubmit"|"PreToolUse"|"PostToolUse")
        send_to_spyglass "$payload" "$SPYGLASS_COLLECT_ENDPOINT"   # POST /collect
        ;;
      *)
        send_to_spyglass "$payload" "$SPYGLASS_EVENTS_ENDPOINT"    # POST /events
        ;;
    esac
fi
```

이중 안전망:
1. **원장 기록**: 서버 다운 상태에서도 `~/.spyglass/logs/hook-raw.jsonl`에 모든 페이로드 보존.
2. **백그라운드 전송**: `( curl ... ) &`로 비동기 전송 — Claude Code의 hook 흐름을 막지 않음(`SPYGLASS_TIMEOUT=1` 기본).

### 9.3 SSE 페이로드 — 클라이언트가 의존하는 contract

```jsonc
// new_request 이벤트
{
  "type": "new_request",
  "timestamp": 1716000000000,
  "data": {
    "id": "req-abc123",
    "session_id": "sess-xyz",
    "type": "tool_call",
    "tool_name": "Read",
    "tool_detail": "Read:/path/to/file.ts",
    "tool_use_id": "tu_01",
    "event_type": "tool",                    // pre_tool|tool|prompt|system|response
    "tokens_input": 1200, "tokens_output": 80,
    "cache_creation_tokens": 0, "cache_read_tokens": 9000,
    "model": "claude-opus-4-7",              // 폴백 적용 후
    "model_fallback_applied": false,
    "sub_type": null,                        // agent|skill|task|mcp|null
    "trust_level": "trusted",
    "duration_ms": 32,
    "preview": "...",
    "session_total_tokens": 45200,           // SSE meta
    "event_phase": "created"                 // created|updated (discriminator)
  }
}
```

`event_phase: 'updated'`는 backfill(예: proxy가 hook 측 model NULL 채움) 시 발생. 클라이언트는 `data-request-id` 매칭으로 in-place 갱신.

---

## 10. 설계 원칙

> **TL;DR** — 변경 이유의 단일성(SRP), Strategy 패턴으로 OCP, 핵심 데이터마다 SSoT 한 곳을 정해두는 것이 코드 곳곳에 일관되게 적용되어 있다. ADR로 의사결정을 추적한다.

### 10.1 단일 책임(SRP) — "변경 이유 단일성"

`CLAUDE.md`에 명시된 원칙. 코드 곳곳의 분해 흐름이 같은 패턴을 따른다.

#### 사례 1: `server.ts(556줄) → runtime/* 6파일` (srp-redesign Phase 7)

| 변경 이유 | 파일 |
|-----------|------|
| 부팅 절차 변경 | `runtime/lifecycle.ts` |
| 데몬 명령 추가 | `runtime/daemon.ts` |
| 경로 prefix 변경 | `runtime/dispatch.ts` |
| 포트/PID 정책 변경 | `runtime/port.ts` |
| 진단 로그 정책 변경 | `diag-log.ts` + `runtime/stdio-mirror.ts` |
| 유지보수 스케줄 변경 | `runtime/maintenance.ts` |

`packages/server/src/index.ts`는 **19줄짜리 진입점 + dispatch 위임**만 남는다.

#### 사례 2: `api.ts(406줄) → routes/* 7파일 + metrics/* 별도` (srp-redesign Phase 2)

| 도메인 | 라우터 |
|--------|--------|
| 세션 | `routes/sessions.ts` |
| 요청 | `routes/requests.ts` |
| 통계 | `routes/stats.ts` |
| 대시보드 + 응답 캐시 | `routes/dashboard.ts` |
| 와일드카드 hook | `routes/events.ts` |
| 프록시 메타 | `routes/proxy.ts` |
| 시스템 프롬프트 | `routes/system-prompts.ts` |
| Behavior Definitions | `routes/meta-docs.ts` |
| 메트릭(시각) | `metrics/router.ts` |
| 버전 | `routes/version.ts` |

`api.ts`는 fan-out 디스패처 86줄로 축소.

#### 사례 3: `proxy/handler.ts(600줄) → handler/* 8파일` (srp-redesign Phase 8)

inbound / stream / non-stream / persist / broadcast / diag / _shared / index. `handler.ts`는 한 줄 re-export shim.

#### 사례 4: `storage/queries/request.ts(1165줄) → queries/request/* 10파일` (ADR-007)

| 변경 이유 | 파일 |
|-----------|------|
| 조회 정책 변경 | `read.ts` (ACTIVE_REQUEST_FILTER_SQL SSoT 보유) |
| 스키마 컬럼 추가 | `write.ts` |
| 통계 지표 변경 | `aggregate-{general,tool,time,latency,strip,cache}.ts` |
| Turn 인터리빙 정책 | `turn.ts` |
| 외부 export 변경 | `index.ts` (barrel) |

### 10.2 Strategy 패턴 — Hook handler 확장 (OCP)

`packages/server/src/hook/dispatcher.ts:42-50`:

```ts
const HANDLERS: HookEventHandler[] = [
  new PreToolUseHandler(),
  new PostToolUseHandler(),
  new UserPromptSubmitHandler(),
];
const REGISTRY = new Map(HANDLERS.map(h => [h.eventType, h]));
const FALLBACK = new SystemEventHandler();
```

새 hook event 추가 절차:
1. `handlers/<new-event>.handler.ts` 작성 (`HookEventHandler` 구현).
2. `HANDLERS` 배열에 인스턴스 1줄 추가.
3. **끝.** dispatcher 외 다른 파일은 수정 불필요(OCP).

### 10.3 Single Source of Truth (SSoT)

| 데이터 | SSoT 위치 |
|--------|-----------|
| Request 타입 contract | `packages/types/src/request.ts` |
| 스키마 버전 | `packages/storage/src/schema.ts:SCHEMA_VERSION` |
| 활성 요청 필터 SQL | `packages/storage/src/queries/request/read.ts:ACTIVE_REQUEST_FILTER_SQL` |
| `live_state` 산출 식 | `packages/storage/src/queries/session/_shared.ts:buildLiveStateColumn` |
| 모델 context window 한도 | `packages/storage/src/queries/model-limits.ts` + `migrations/026` |
| 모델 단가 | `packages/storage/src/pricing.ts` |
| 도구 카테고리 | `packages/server/src/tool-category.ts` |
| SSE 이벤트 payload 빌더 | `packages/server/src/sse.ts:buildNewRequestEvent` (pure function) |
| 웹 핵심 렌더 함수 | `packages/web/assets/js/renderers.js` |

### 10.4 캡슐화 — "raw 전달, 판단은 내부"

`CLAUDE.md` 원칙 발췌:

> - **동일 판단 로직은 한 곳에만** — 호출 측에서 `boolean`으로 재계산하지 말고, raw data를 함수에 전달하고 판단은 함수 내부에서 처리.
> - **기존 렌더링 함수를 반드시 재사용** — 아이콘·배지·행(row) 등 UI 요소는 기존 함수를 거치지 않고 직접 HTML 작성 금지.

웹 측 사례:
```js
// ❌ 안티패턴
const isRunning = r.event_type === 'pre_tool';
const html = isRunning ? '<span class="running">...' : '<span>...';

// ✅ 권장
const html = toolIconHtml(r.tool_name, r.event_type);   // 판단은 함수 내부에서
```

### 10.5 ADR 기반 의사결정 추적

각 디렉토리·기능은 `@see docs/planning/03-adr.md - ADR-NNN` 또는 `.claude/docs/plans/<feature>/adr.md` 주석으로 결정 근거를 남긴다.

주요 ADR 흐름(코드 주석에서 발췌):

| ID | 주제 | 근거 위치 |
|----|------|-----------|
| ADR-001 | 글로벌 데몬 (PID 파일) | `packages/server/src/index.ts:8` |
| ADR-002 | WAL 모드 | `packages/storage/src/connection.ts`, `schema.ts` |
| ADR-002 (log-view-unification) | `new_request` 단일 채널 + `event_phase` discriminator | `packages/server/src/sse.ts:8` |
| ADR-006 (srp-redesign) | `@spyglass/types` 분리 | `packages/types/src/index.ts:1` |
| ADR-007 (srp-redesign) | `queries/request/*` 분해 | `packages/storage/src/queries/request/index.ts:1` |
| ADR-003 (left-rail-meta-docs) | 56px 앱 모드 rail | `packages/web/index.html:46` |
| ADR-004 (meta-docs-tool-stats) | 프로젝트 도구 통계 매트릭스 | `routes/meta-docs.ts` + `metaToolStatsBody` |
| ADR-005 (system-prompt-exposure) | system 본문 lazy-fetch | `packages/server/src/sse.ts:208` |
| ADR-008 (cache-donut 시리즈) | 캐시 도넛 라벨/산식 통일 | 최근 커밋 5개 (`1f45c30`...`672fc0c`) |

### 10.6 모듈 경계 — `index.ts` barrel 강제

여러 모듈이 `index.ts`(barrel)만 외부에 노출:

```ts
// packages/server/src/hook/index.ts
export { handleHookHttpRequest, ... } from './http-entry';
// 외부 사용처는 './hook'만 import — './hook/persist' 같은 내부 경로 import 금지
```

내부 구조가 재배치되어도 호출자 시그니처는 보존된다. 이는 SRP 분해를 점진적으로 진행할 수 있게 해주는 장치(`proxy/handler.ts` 한 줄 shim, `queries/request.ts` 등).

---

## 11. 외부 의존성

> **TL;DR** — Bun 런타임 + Ink/React + 소수의 NPM 패키지로 구성되며, 외부 시스템은 Claude Code CLI(데이터 소스)와 npm registry(버전 체크), 선택적으로 Anthropic API(프록시)뿐이다.

### 11.1 런타임 의존성

| 패키지 | 사용처 | 역할 |
|--------|--------|------|
| **Bun** ≥ 1.2.0 | server, storage | HTTP 서버(`Bun.serve`), SQLite 드라이버(`bun:sqlite`), 파일 API. |
| **@anthropic-ai/sdk** ^0.96.0 | server (proxy) | Anthropic 타입 정의 사용(미러링 시 RequestMeta 추출 보조). |
| **eventsource** ^4.1.0 | tui | Node EventSource 폴리필 (Bun에 `globalThis.EventSource` 없음). |
| **ink** ^5.2.0 | tui | React 렌더러(터미널). |
| **react** ^18.3.1 | tui | Ink의 호스트(`useState`, `useSyncExternalStore` 활용). |
| **react-i18next** ^17.0.8 + **i18next** ^26.2.0 | tui, server | i18n 키 로딩(ko/en/ja/zh). |
| **asciichart** ^1.5.25 | tui | Sparkline / BarChart ASCII 차트. |

### 11.2 개발 의존성

- **@types/bun**, **@types/node**, **@types/react** — TS 타입 보강.
- **typescript** ^5.0.0 — `tsc --noEmit` typecheck 전용.
- **ink-testing-library** ^4.0.0 — TUI 컴포넌트 단위 테스트.

### 11.3 외부 시스템

- **Claude Code CLI** — 데이터 소스. 사용자의 `settings.json` hook 등록을 통해 spyglass-collect.sh를 호출.
- **npm registry** — `version-checker.ts`가 1h 간격으로 최신 버전 폴링(`/api/version`).
- **Anthropic API** (선택) — proxy 모드에서 upstream으로 forward.

### 11.4 파일시스템 위치

| 경로 | 내용 |
|------|------|
| `~/.spyglass/spyglass.db` | SQLite DB (WAL 모드, 0o600) |
| `~/.spyglass/spyglass.db-wal` | WAL 저널 |
| `~/.spyglass/spyglass.db-shm` | shared memory 인덱스 |
| `~/.spyglass/server.pid` | 데몬 PID 파일 |
| `~/.spyglass/logs/server.log` | stdout/stderr 미러 |
| `~/.spyglass/logs/collect.log` | hook 스크립트 로그 |
| `~/.spyglass/logs/hook-raw.jsonl` | hook 원장 (서버 다운 시 안전망) |
| `~/.spyglass/logs/diag/*.jsonl` | 진단 jsonl (DIAG 모드) |
| `<cwd>/.claude/` | 프로젝트별 Behavior Definitions 스캔 루트 |
| `~/.claude/` | 글로벌 Behavior Definitions 스캔 루트 |

### 11.5 환경 변수

| 변수 | 기본값 | 용도 |
|------|--------|------|
| `SPYGLASS_PORT` | 9999 | 서버 포트 |
| `SPYGLASS_HOST` | localhost | 서버 호스트 |
| `SPYGLASS_DB_PATH` | `~/.spyglass/spyglass.db` | DB 경로 |
| `SPYGLASS_PID_FILE` | `~/.spyglass/server.pid` | PID 파일 경로 |
| `SPYGLASS_API_URL` | `http://127.0.0.1:9999` | TUI가 연결할 서버 URL |
| `SPYGLASS_ALL_PROJECTS` | `0` | 1이면 TUI에서 모든 프로젝트 표시 |
| `SPYGLASS_TIMEOUT` | 1 | hook 스크립트 curl 타임아웃(sec) |
| `SPYGLASS_HOOK_DIAG` | `0` | hook 진단 jsonl on/off |
| `SPYGLASS_PROXY_DIAG` | `0` | proxy 진단 jsonl on/off |
| `ANTHROPIC_BASE_URL` | (없음) | 설정 시 `/v1/*` 프록시 미러링 활성화 |

---

## 12. 빌드·실행·테스트

> **TL;DR** — 빌드 단계가 없다. Bun이 TypeScript를 직접 실행하고, 웹은 정적 ES Modules로 서빙된다. 테스트는 `bun test`, 진단은 `bun run doctor`다.

### 12.1 npm scripts (`package.json`)

```jsonc
{
  "start":   "bun run packages/server/src/index.ts start",
  "dev":     "bun run packages/server/src/index.ts restart",
  "stop":    "bun run packages/server/src/index.ts stop",
  "status":  "bun run packages/server/src/index.ts status",
  "doctor":  "bun run packages/server/src/cli.ts doctor",
  "tui":     "bun run packages/tui/src/index.tsx",
  "test":    "bun test",
  "typecheck": "tsc --noEmit",
  "rebuild-stats":        "bun run packages/storage/src/scripts/rebuild-stats.ts",
  "rebuild-stats-proxy":  "bun run packages/storage/src/scripts/rebuild-stats-proxy.ts",
  "backfill:system-prompts": "bun run packages/server/scripts/backfill-system-prompts.ts"
}
```

### 12.2 빌드 불필요

- TypeScript는 Bun이 직접 실행(`bun run *.ts`).
- 웹은 ES modules로 정적 서빙(빌드 X).
- 패키지 의존성은 `workspace:*`로 심볼릭 링크.

### 12.3 테스트 전략

| 패키지 | 테스트 위치 | 도구 |
|--------|-------------|------|
| server | `src/__tests__/`, `src/hook/__tests__/`, `src/proxy/__tests__/`, `src/domain/__tests__/` | `bun test` |
| storage | `src/__tests__/` | `bun test` |
| tui | `src/__tests__/` | `bun test` + `ink-testing-library` |
| web | `assets/js/__tests__/` | `bun test` (DOM utility 단위) |

### 12.4 진단

`bun run doctor`(`packages/server/src/cli/checks/`)는 다음을 검사:
- `server.ts`: 데몬 실행 상태, 포트 점유.
- `database.ts`: DB 파일 존재, schema_version 일치, WAL 상태.
- `environment.ts`: hook 등록(`settings.json`), 권한.
- `integrity.ts`: DB 일관성(orphan rows, FK 위반 등).

---

## 13. 데이터 흐름 시나리오 *(부록)*

> **TL;DR** — 본문(§1~§12)의 추상적 흐름을 4가지 구체 시나리오로 트레이스한다. 코드 디버깅 시 "이 단계에서 어떤 일이 일어나야 정상인가?"를 빠르게 확인할 수 있다.

### 13.1 시나리오 A — 사용자가 프롬프트를 입력

```
1. 사용자가 Claude Code에 "fix the bug" 입력
2. Claude Code → UserPromptSubmit 훅 발사
3. hooks/spyglass-collect.sh가 stdin 수신
   • hook-raw.jsonl 원장 기록
   • hook_event_name='UserPromptSubmit' 매칭 → POST /collect
4. server: handleHookHttpRequest → dispatcher → UserPromptSubmitHandler
   • slash_command 추출 (예: prompt에 <command-name>commit</command-name> 있으면 'commit')
   • NormalizedHookPayload 생성 (request_type='prompt')
5. processor.ts:
   • session upsert (sessions 테이블)
   • turn_id 할당 (새 turn 시작)
6. persist.ts:
   • requests INSERT (type='prompt', preview=프롬프트 앞 500자)
   • sessions.total_tokens += tokens_total
7. broadcastNewRequest(norm, { event_phase: 'created', session_total_tokens })
8. SSE → 모든 연결된 클라이언트로 'new_request' 푸시
   • 웹: prependRequest(r) → 피드 최상단에 행 추가
   • TUI: feedStore.push(r) → microtask 배칭 후 LiveFeed 리렌더
```

### 13.2 시나리오 B — Claude가 도구를 호출 (pre→tool 머지)

규칙 정의는 §4.3 표 참조. 다음은 구체 트레이스.

```
1. Claude가 Read('/etc/hosts') 결정
2. Claude Code → PreToolUse 훅 발사 (실행 직전)
   • POST /collect → PreToolUseHandler
   • event_type='pre_tool', tool_use_id='tu_42'
   • requests INSERT (id='pre-tu_42', tokens=0, duration_ms=null)
   • SSE 브로드캐스트 안 함 (결과 없음)
3. Read 실행
4. Claude Code → PostToolUse 훅 발사
   • event_type='tool', 같은 tool_use_id='tu_42'
   • PostToolUseHandler:
     - 기존 pre 행 SELECT (tool_use_id='tu_42')
     - UPDATE requests SET tokens_*, duration_ms, preview, ...
     - INSERT NEW Agent transcript 자식 (parent_tool_use_id='tu_42', 있으면)
   • broadcastNewRequest({ ...norm, id: 'pre-tu_42' }, { event_phase: 'created' })
5. SSE 푸시. 클라이언트는 'pre-tu_42' id로 행을 그림 (pre 단계는 노출 안 됐었으므로 신규).
```

### 13.3 시나리오 C — Proxy 미러링 (opt-in)

```
1. 사용자가 export ANTHROPIC_BASE_URL=http://localhost:9999
2. Claude Code → POST /v1/messages (Anthropic SDK가 보낸 본문)
3. server: dispatch.ts → handleProxy
4. handler/index.ts:
   • buildInboundContext: body bytes, messages_count, tools_count, system_hash 추출
   • forwardToUpstream: fetch(https://api.anthropic.com/v1/messages, ...)
   • SSE stream 감지 → handleStreamResponse
5. handler/stream.ts:
   • Anthropic 응답 body를 client에 그대로 흘림 (passthrough)
   • clone으로 SSE 청크 파싱 (sse-state.ts):
     - content_block_start / content_block_delta 누적
     - message_delta의 usage 추출
     - tool_use_id 매핑 (v23)
   • 종료 후 persist (proxy_requests INSERT in tx)
6. broadcastNewProxyRequest(payload) → SSE 'new_proxy_request'
7. 별도로 hook에서 model NULL인 행이 있으면 backfill (v19: api_request_id 매칭)
   • requests UPDATE → broadcastNewRequest(..., { event_phase: 'updated' })
   • 클라이언트는 in-place 갱신
```

### 13.4 시나리오 D — 웹 대시보드 초기 진입

```
1. 사용자가 http://localhost:9999 접속
2. server: dispatch.ts → packages/web/index.html 반환
3. 브라우저: <script type="module" src="/assets/js/main.js">
4. main.js 초기화:
   • initTypeColors / initBuckets / initColResize / initPanelResize ...
   • applyAppMode('browse')         — sessionStorage 복원
   • fetchDashboard()                — 프로젝트/세션 + 차트
   • connectSSE() → EventSource('/events')   (첫 'ping' 수신 시 연결 OK)
5. 사용자가 프로젝트 클릭:
   • selectProject(name) → fetchSessionsByProject → fetchRequests(initial)
6. SSE 'new_request' 도착:
   • created → prependRequest        (피드 최상단에 행 추가)
   • updated → in-place 갱신          (data-request-id 매칭)
```

---

## 14. 확장 포인트 *(부록)*

> **TL;DR** — 새 기능을 추가할 때 손대야 할 파일 목록을 시나리오별로 정리한 체크리스트.

### 14.1 새 hook event 종류 추가
1. `packages/server/src/hook/handlers/<event>.handler.ts` 작성 (`HookEventHandler` 구현).
2. `packages/server/src/hook/dispatcher.ts:42`의 `HANDLERS` 배열에 인스턴스 1줄 추가.
3. (필요 시) `packages/server/src/hook/types.ts`에 `NormalizedHookPayload` 필드 추가.

### 14.2 새 API 라우트 추가
1. 기존 도메인이면 `routes/<domain>.ts`에 `if (path === '/api/...' && method === 'GET')` 추가.
2. 새 도메인이면 `routes/<new-domain>.ts` 작성 후 `api.ts:52`의 `SYNC_ROUTERS`에 1줄 추가.

### 14.3 새 메트릭 추가
1. raw 데이터: `packages/storage/src/queries/metrics/<name>.ts`에 SELECT 함수 작성.
2. 가공: `packages/server/src/metrics/calculators/<name>.ts`에 pure function 작성.
3. 노출: `packages/server/src/metrics/router.ts`에 `if (path === '/api/metrics/<name>')` 추가.
4. 클라이언트: `packages/web/assets/js/metrics-api.js` 추가 + 뷰 컴포넌트.

### 14.4 새 컬럼 추가
1. `packages/storage/migrations/<NNN>-<reason>.sql` 작성 (`ALTER TABLE` + 인덱스).
2. `packages/storage/src/schema.ts:SCHEMA_VERSION`을 `NNN`으로 갱신.
3. `packages/storage/src/queries/<table>/write.ts`의 INSERT/UPDATE에 컬럼 추가.
4. `packages/storage/src/queries/<table>/read.ts`의 SELECT/매핑에 컬럼 추가.
5. (외부 노출이 필요한 경우) `packages/types/src/<entity>.ts`의 인터페이스에 필드 추가.
6. (UI 표시) `packages/web/assets/js/renderers.js` 또는 `packages/tui/src/components/*` 갱신.

### 14.5 새 SSE 이벤트 타입 추가
1. `packages/server/src/sse.ts:SSEEventType`에 union 추가.
2. `broadcast<EventName>(payload)` 함수 작성 (`broadcastUpdate` 호출).
3. 클라이언트 listener 추가:
   - 웹: `packages/web/assets/js/sse.js`
   - TUI: `packages/tui/src/hooks/useSSE.ts`

### 14.6 새 TUI 화면 추가
1. `packages/tui/src/screens/<Name>.tsx` 컴포넌트 작성.
2. `packages/tui/src/types.ts:ScreenId` union에 추가.
3. `app.tsx:renderMain`의 `switch`에 case 추가.
4. `app.tsx:hintsFor`에 키 hint 추가.
5. `app.tsx:useKeyboard`의 `onView` 디스패치에 매핑 추가.

---

## 15. 참고 파일 인덱스 *(부록)*

> **TL;DR** — 영역별 코드 진입점 한 표. "어디서 시작해야 하지?"라는 질문의 답.

| 영역 | 진입 파일 |
|------|-----------|
| 전체 서버 부팅 | `packages/server/src/index.ts:1`, `runtime/lifecycle.ts:30` |
| HTTP 라우팅 | `packages/server/src/runtime/dispatch.ts:18` |
| API fan-out | `packages/server/src/api.ts:52` |
| Hook 수집 | `packages/server/src/hook/dispatcher.ts:42` |
| Proxy | `packages/server/src/proxy/handler/index.ts:36` |
| SSE | `packages/server/src/sse.ts:165` |
| 메트릭 | `packages/server/src/metrics/router.ts:56` |
| Meta-docs | `packages/server/src/meta-docs/synchronizer.ts` |
| DB 연결 | `packages/storage/src/connection.ts:61` |
| 스키마 | `packages/storage/src/schema.ts:104` |
| 마이그레이션 | `packages/storage/src/migrator.ts:75` |
| Request 쿼리 | `packages/storage/src/queries/request/index.ts:1` |
| Session 도메인 | `packages/storage/src/domain/session-status.ts` |
| 공통 타입 | `packages/types/src/request.ts:39` |
| TUI 루트 | `packages/tui/src/app.tsx:36` |
| TUI SSE | `packages/tui/src/hooks/useSSE.ts:32` |
| TUI 외부 store | `packages/tui/src/stores/feed-store.ts:17` |
| 웹 HTML | `packages/web/index.html:1` |
| 웹 진입점 | `packages/web/assets/js/main.js:1` |
| 웹 핵심 렌더러 | `packages/web/assets/js/renderers.js` |
| Hook 수집 스크립트 | `hooks/spyglass-collect.sh:1` |

---

---

**문서 기준**: `claude-spyglass` 저장소 코드 트리 2026-05 시점 (schema_version=23, migrations 032).
**갱신 책임**: 변경 PR 작성자. 새 마이그레이션·라우트·SSE 이벤트 추가 시 §9·§11·§14 표를 함께 갱신할 것.
