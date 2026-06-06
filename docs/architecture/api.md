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
| `routes/sessions.ts` | `GET /api/sessions/active`, `/:id`, `/:id/requests`, `/:id/turns`, `/by-project` |
| `routes/requests.ts` | `GET /api/requests/recent`, `/:id`, `/top-tokens` |
| `routes/stats.ts` | `GET /api/stats/sessions`, `/requests`, `/cache`, `/proxy`, `/proxy/by-model` |
| `routes/proxy.ts` | `GET /api/proxy/recent`, `/by-session/:id`, `/:id` |
| `routes/system-prompts.ts` | `GET /api/system-prompts`, `/:hash` (lazy fetch) |
| `routes/meta-docs.ts` | `GET /api/meta-docs`, `POST /api/meta-docs/refresh` |
| `routes/graph.ts` | `GET /api/graph/{status,unified-flow}`, `/sessions/:id/initial`, `/turns/:id/{neighbors,path}` |
| `routes/settings.ts` | `GET /api/settings/{diag,sqlite/info,logs}`, `GET/POST /api/settings/{hooks,proxy,graph,graph-db}/*` |
| `routes/version.ts` | `GET /api/version` (current + latest) |
| `metrics/router.ts` | `GET /api/metrics/{model-usage,cache-matrix,context-usage,activity-heatmap,turn-distribution,agent-depth,tool-categories,anomalies-timeseries,burn-rate,cache-trend,proxy-trend}` |

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
