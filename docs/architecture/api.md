# API & SSE Contract

> HTTP 엔드포인트, SSE 이벤트, Hook 입력 명세.

---

## 문서 기준

| 항목 | 값 |
|------|-----|
| 시각 | 2026-06-06 16:44:03 KST |
| 커밋 | `4ea9686` |
| 태그 | `v4.4.0` |

---

## 1. 개요

| 항목 | 값 |
|------|-----|
| 런타임 | Bun (`Bun.serve`) |
| 기본 포트 | **9999** (`SPGLASS_PORT`) |
| 기본 호스트 | **127.0.0.1** (`SPGLASS_HOST`) |
| 인증 | 없음 — 로컬 데몬 가정 |
| SSE 유지 | `idleTimeout: 0` |

---

## 2. 엔드포인트 인덱스

### 2.1 일반

| 메서드 | 경로 | 응답 |
|--------|------|------|
| GET | `/health` | `{ status: 'ok', timestamp, version }` |
| GET | `/` (Accept:json) | `{ name, version, endpoints }` |
| GET | `/` (Accept:html) | `packages/web/dist/index.html` |

### 2.2 Hook 수집

| 메서드 | 경로 | 본문 | 동작 |
|--------|------|------|------|
| POST | `/collect` | `ClaudeHookPayload` | dispatcher → handler → DB 저장 → SSE |
| POST | `/events` | raw hook JSON | `claude_events` 저장 |

### 2.3 SSE

| 메서드 | 경로 | 응답 헤더 | 이벤트 |
|--------|------|-----------|--------|
| GET | `/events` | `text/event-stream` | `new_request`, `new_proxy_request`, `session_update`, `token_update`, `stats_update`, `ping`, `server_shutdown` |

### 2.4 REST API (`/api/*`)

| 라우터 | 주요 라우트 |
|--------|-------------|
| `routes/dashboard.ts` | `GET /api/dashboard?range=...` (응답 캐시) |
| `routes/session-summary.ts` | `GET /api/sessions/:id/summary`, `GET /api/sessions/summary?hub_role=&active=1&limit=` — 세션 한 장 요약(메타·토큰·스킬/에이전트/명령·컨텍스트 `latest_*`·마찰). `sessionsRouter` 의 `/:id` catch-all 보다 먼저 등록 |
| `routes/sessions.ts` | `GET /api/sessions/active`, `/:id`, `/:id/requests`, `/:id/turns`, `/by-project` — 세션 행에 `orca_terminal`·`hub_role`, `/:id` 의 `anomalies.context_saturation` 에 현재 컨텍스트 `latest_*` 포함. `/:id/turns` 는 `?payload=0`·`?limit=N`(최근 N턴)·`?since_turn=N` |
| `routes/requests.ts` | `GET /api/requests/recent`, `/:id`, `/top-tokens` |
| `routes/conversations.ts` | `GET /api/conversations?start=YYYY-MM-DD&end=YYYY-MM-DD&project=` 또는 `?from=&to=`(ms) — `fields=summary` 면 원문 대신 세션별 첫 줄 프롬프트·수·토큰·스킬 |
| `routes/stats.ts` | `GET /api/stats/sessions`, `/requests`, `/cache`, `/proxy`, `/proxy/by-model`, `/sessions/daily?from=&to=&tz=&project=&session_id=`(세션 × 일자 토큰·캐시 적중률, `stats_session_hourly`), `/subagents?from=&to=&project=&max_tier=`(서브에이전트 종류 × 실제 모델, proxy 실측 우선, `over_cap`) |
| `routes/proxy.ts` | `GET /api/proxy/recent`, `/by-session/:id`, `/:id` |
| `routes/friction.ts` | `GET /api/friction?from=&to=&session_id=&cwd_prefix=&limit=&repeat_min=` — 도구 실패·권한 요청/거부·API 실패·압축 집계(`claude_events` 위의 읽기 전용) |
| `routes/instructions.ts` | `GET /api/instructions/footprint?from=&to=&path_prefix=&limit=&trend=` — 지침 문서(CLAUDE.md·rules·메모리 색인)별 컨텍스트 주입 바이트와 로드 횟수(`proxy_requests.system_reminder` 블록 파싱 + `InstructionsLoaded` 이벤트, 읽기 전용) |
| `routes/project-aliases.ts` | `GET/POST /api/projects/aliases`, `DELETE /api/projects/aliases/:alias` — 이름이 바뀐 프로젝트의 이력을 합쳐 조회(`project` 필터가 별칭 포함) |
| `routes/system-prompts.ts` | `GET /api/system-prompts`, `/:hash` (lazy fetch) |
| `routes/meta-docs.ts` | `GET /api/meta-docs`(`?group=name` 이면 (type,name) 당 1행, `source_roots[]`), `GET /api/meta-docs/usage/daily?from=&to=&tz=&project=&kind=&name=`(호출·실패·실패율, `stats_meta_usage_hourly`), `POST /api/meta-docs/refresh` |
| `routes/graph.ts` | `GET /api/graph/{status,unified-flow}`, `/sessions/:id/initial`, `/turns/:id/{neighbors,path}` |
| `routes/settings.ts` | `GET /api/settings/{diag,sqlite/info,logs}`, `GET/POST /api/settings/{hooks,proxy,graph,graph-db}/*` |
| `routes/version.ts` | `GET /api/version` (current + latest) |
| `metrics/router.ts` | `GET /api/metrics/{model-usage,cache-matrix,context-usage,activity-heatmap,turn-distribution,agent-depth,tool-categories,anomalies-timeseries,burn-rate,cache-trend,proxy-trend}` |

**허브 요약 테이블** — 원본(30일)과 별개로 **365일** 보존(`SPYGLASS_SUMMARY_RETENTION_DAYS`, `queries/session/retention.ts` `pruneSummaryTables`). 시간 버킷으로 저장하고 일자는 API 가 `tz` 로 묶는다.

| 테이블 | 갱신 | 쓰는 API |
|---|---|---|
| `stats_session_hourly` (Migration 072) | `proxy_requests` INSERT 트리거 | `/api/stats/sessions/daily`, `/api/sessions/*/summary`, `/api/conversations?fields=summary` |
| `stats_meta_usage_hourly` (Migration 073) | 호출: `requests` 트리거(pre_tool → tool 확정 시). 실패: `events.ts` 가 `PostToolUseFailure`(Skill/Agent, 중단 제외)를 받을 때 + 서버 기동 시 1회 백필 | `/api/meta-docs/usage/daily` |

수치 출처가 다르다: `/api/dashboard` 는 `sessions`·`requests`(훅) 기준, 위 요약 API 는 `proxy_requests`(실제 API 호출) 기준이라 세션·요청 수가 다를 수 있다.

### 2.5 프록시 (opt-in)

| 메서드 | 경로 | 동작 |
|--------|------|------|
| `*` | `/v1/*` | Anthropic 또는 `ANTHROPIC_BASE_URL` upstream으로 forward + 메타 수집 |

### 2.6 정적

| 경로 | 매핑 |
|------|------|
| `/assets/*` | `packages/web/dist/assets/*` |
| `/locales/*` | `packages/web/locales/*` |
| `/favicon.svg`, `/favicon.ico` | `packages/web/favicon.*` |

---

## 3. SSE 페이로드

### 3.1 `new_request`

```jsonc
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
    "event_type": "tool",
    "tokens_input": 1200,
    "tokens_output": 80,
    "cache_creation_tokens": 0,
    "cache_read_tokens": 9000,
    "model": "claude-opus-4-7",
    "model_fallback_applied": false,
    "sub_type": null,
    "trust_level": "trusted",
    "duration_ms": 32,
    "preview": "...",
    "session_total_tokens": 45200,
    "event_phase": "created"
  }
}
```

`event_phase`: `'created'` | `'updated'` — 클라이언트는 `data-request-id` 매칭으로 in-place vs prepend를 분기합니다.

### 3.2 `new_proxy_request`

`ProxyBroadcastPayload` + `source='proxy'`.

### 3.3 `session_update`

```jsonc
{
  "type": "session_update",
  "data": {
    "session_id": "sess-xyz",
    "action": "started"
  }
}
```

---

## 4. Hook 입력 명세

### 4.1 `/collect` 페이로드

```jsonc
{
  "hook_event_name": "PreToolUse",
  "session_id": "abc-123",
  "transcript_path": "~/.claude/...",
  "cwd": "/Users/.../project",
  "permission_mode": "default",
  "tool_name": "Bash",
  "tool_input": { "command": "ls" },
  "tool_use_id": "toolu_01XYZ",
  "duration_ms": 134,
  "agent_id": "subagent-uuid",
  "agent_type": "general-purpose"
}
```

### 4.2 `/events` 페이로드

세션 라이프사이클 이벤트(SessionStart/Stop/SessionEnd)는 `events.ts`의 `RawHookPayload` 형상을 따릅니다.

---

## 5. 에러 응답

표준 envelope:

```json
{ "success": false, "error": "message", "code": 400 }
```

일반 상태 코드:
- `200` 성공
- `400` 잘못된 요청 (JSON 파싱 실패 등)
- `404` 엔드포인트 없음
- `502` 프록시 upstream 실패

---

> **문서 기준**
> - 시각: 2026-06-06 16:44:03 KST
> - 커밋: `4ea9686`
> - 태그: `v4.4.0`
