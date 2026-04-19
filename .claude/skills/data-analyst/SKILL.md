---
name: data-analyst
description: >
  claude-spyglass 프로젝트 전용 데이터 분석 전문가 에이전트.
  SQLite 스키마(sessions/requests/claude_events), 마이그레이션 패턴(v2~v11),
  훅 수집 스크립트 → 서버 → DB 전체 데이터 흐름을 숙지하고
  데이터 분석, 신규 테이블/컬럼 추가, 쿼리 개선, 스크립트 수정을 담당합니다.
  "데이터 분석", "테이블 추가", "컬럼 추가", "쿼리 최적화", "스키마 변경",
  "마이그레이션 추가", "통계 개선", "데이터 흐름 분석" 요청에 트리거됩니다.
  데이터·스키마·스크립트 관련 요청은 반드시 이 스킬을 사용하세요.
---

# data-analyst

claude-spyglass 전용 데이터 분석 전문가 에이전트

## 프로젝트 데이터 개요

**Claude Spyglass** — Claude Code의 훅(hook) 이벤트를 수집하여 토큰 사용량과 요청 흐름을 분석하는 모니터링 도구.

- **DB 엔진**: SQLite WAL 모드 (`~/.spyglass/spyglass.db`)
- **런타임**: Bun 1.2.0+ / TypeScript 5.0+
- **데이터 소스**: Claude Code 훅 (bash 스크립트 → HTTP POST → SQLite)

---

## 등록된 훅 이벤트 (`.claude/settings.json`)

| 훅 이벤트 | 처리 함수 | 역할 |
|-----------|-----------|------|
| `UserPromptSubmit` | `main "prompt"` | 프롬프트 수집 |
| `PreToolUse` | `main "pre_tool"` | 도구 시작 타임스탬프 기록 (duration_ms 측정 시작) |
| `PostToolUse` | `main "tool"` | 도구 결과 수집 + duration_ms 계산 |
| `SessionStart` | `send_raw_event` → `/events` | 세션 시작 raw 이벤트 |
| `Stop` | `send_raw_event` → `/events` | 세션 종료 raw 이벤트 |
| `SessionEnd` | `send_raw_event` → `/events` | 세션 종료 raw 이벤트 |

> **주의**: `PreToolUse`는 DB에 레코드를 저장하지 않고, `~/.spyglass/timing/{session_id}` 파일에 타임스탬프만 기록합니다. `PostToolUse`가 이 파일을 읽어 경과 시간을 계산하고 파일을 삭제합니다.

---

## 데이터 흐름

```
Claude Code Hook (stdin)
  ↓ spyglass-collect.sh (hooks/spyglass-collect.sh)
    ├─ UserPromptSubmit → main "prompt"  : 토큰 추출, /collect 전송
    ├─ PreToolUse      → main "pre_tool": ~/.spyglass/timing/{session_id} 에 타임스탬프 저장 (DB 저장 없음)
    ├─ PostToolUse     → main "tool"    : duration_ms 계산, tool_detail 파싱, /collect 전송
    ├─ SessionStart    → send_raw_event : /events 전송 + hook-raw.jsonl 기록
    ├─ Stop            → send_raw_event : /events 전송 + hook-raw.jsonl 기록
    └─ SessionEnd      → send_raw_event : /events 전송 + hook-raw.jsonl 기록
  ↓ HTTP POST (curl, timeout=1s)
    - /collect  → requests + sessions 저장
    - /events   → claude_events 저장 (raw payload)
  ↓ SQLite WAL (packages/storage/src/)
    - sessions, requests, claude_events 테이블
  ↓ REST API (packages/server/src/api.ts)
  ↓ Web Dashboard / TUI
```

---

## 핵심 파일 경로

| 역할 | 경로 |
|------|------|
| DB 스키마 + 마이그레이션 | `packages/storage/src/schema.ts` |
| DB 연결 관리 | `packages/storage/src/connection.ts` |
| Session 쿼리 | `packages/storage/src/queries/session.ts` |
| Request 쿼리 | `packages/storage/src/queries/request.ts` |
| Event 쿼리 | `packages/storage/src/queries/event.ts` |
| 스토리지 공개 API | `packages/storage/src/index.ts` |
| 수집 엔드포인트 | `packages/server/src/collect.ts` |
| REST API 라우터 | `packages/server/src/api.ts` |
| 훅 수집 스크립트 | `hooks/spyglass-collect.sh` |

---

## 테이블 스키마

상세 내용은 `references/schema.md` 참고.

> **Hook Payload 구조**: 각 이벤트 타입별 실제 JSON 샘플은 `references/payload-samples.md` 참고.
> Agent/Skill 실제 지침 텍스트 위치, tool_response 구조, PreToolUse vs PostToolUse 차이 포함.

### `sessions` — Claude Code 세션 단위

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | TEXT PK | 세션 ID |
| `project_name` | TEXT | 프로젝트명 (cwd basename) |
| `started_at` | INTEGER | 세션 시작 Unix timestamp |
| `ended_at` | INTEGER? | 세션 종료 (null = 활성) |
| `total_tokens` | INTEGER | 세션 누적 토큰 |
| `created_at` | INTEGER | 레코드 생성 시각 |

### `requests` — 개별 API 요청

| 컬럼 | 타입 | 설명 | 추가 버전 |
|------|------|------|-----------|
| `id` | TEXT PK | 요청 ID | - |
| `session_id` | TEXT FK | 세션 참조 | - |
| `timestamp` | INTEGER | 요청 시각 | - |
| `type` | TEXT | `prompt` / `tool_call` / `system` | - |
| `tool_name` | TEXT? | 도구명 (tool_call만) | - |
| `tool_detail` | TEXT? | 도구 파라미터 요약 | v2 |
| `turn_id` | TEXT? | 턴 그룹핑 ID | v3 |
| `model` | TEXT? | 사용 모델명 | - |
| `tokens_input` | INTEGER | 입력 토큰 | - |
| `tokens_output` | INTEGER | 출력 토큰 | - |
| `tokens_total` | INTEGER | 전체 토큰 | - |
| `duration_ms` | INTEGER | 도구 실행 시간 (ms) | - |
| `payload` | TEXT? | 원본 페이로드 JSON | - |
| `source` | TEXT? | 데이터 출처 추적 | v4 |
| `cache_creation_tokens` | INTEGER | 캐시 생성 토큰 | v5 |
| `cache_read_tokens` | INTEGER | 캐시 읽기 토큰 | v5 |
| `preview` | TEXT? | 프롬프트 내용 미리보기 | v7 |
| `tool_use_id` | TEXT? | Pre/Post 툴 페어링 키 | v8 |
| `event_type` | TEXT? | 이벤트 서브타입 (`pre_tool`, `tool`) | v8 |

### `claude_events` — Raw 훅 페이로드

| 컬럼 | 타입 | 설명 | 추가 버전 |
|------|------|------|-----------|
| `id` | INTEGER PK | 자동 증가 | v6 |
| `event_id` | TEXT UNIQUE | 이벤트 고유 ID | v6 |
| `event_type` | TEXT | 훅 이벤트명 (SessionStart 등) | v6 |
| `session_id` | TEXT | 세션 ID | v6 |
| `transcript_path` | TEXT? | transcript 파일 경로 | v6 |
| `cwd` | TEXT? | 작업 디렉토리 | v6 |
| `agent_id` | TEXT? | 에이전트 ID | v6 |
| `agent_type` | TEXT? | 에이전트 타입 | v6 |
| `timestamp` | INTEGER | 이벤트 발생 시각 | v6 |
| `payload` | TEXT | 전체 훅 페이로드 JSON | v6 |
| `schema_version` | INTEGER | 페이로드 스키마 버전 | v6 |

---

## 마이그레이션 패턴

### 버전 관리 방식

`packages/storage/src/schema.ts`의 `USER_VERSION` pragma로 관리.

```typescript
// 현재 버전 확인
const version = db.pragma('user_version', { simple: true }) as number;

// 버전별 순차 적용
if (version < 2) { /* ALTER TABLE ... */ db.pragma('user_version = 2'); }
if (version < 3) { /* ... */            db.pragma('user_version = 3'); }
// ...
if (version < N) { /* ... */            db.pragma('user_version = N'); }
```

### 마이그레이션 이력

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
| v10 | 기존 확장 (상세: schema.md) |
| v11 | `requests.tokens_confidence`·`tokens_source` + `claude_events` 정규화 컬럼 8개 (`permission_mode`, `source`, `end_reason`, `model`, `stop_hook_active`, `task_id`, `task_subject`, `notification_type`). 27개 HOOK_EVENTS 전체 수집 대응 |

### 신규 마이그레이션 추가 방법

1. `packages/storage/src/schema.ts`에서 `SCHEMA_VERSION` 상수를 N+1로 증가
2. `runMigrations()` 함수에 `if (version < N+1) { ... }` 블록 추가
3. 새 컬럼이면 `ALTER TABLE ... ADD COLUMN ...` (기본값 필수)
4. 새 테이블이면 `CREATE TABLE IF NOT EXISTS ...` + 인덱스
5. `CollectPayload` 인터페이스 / `createRequest()` 함수에 신규 필드 반영
6. 훅 스크립트(`hooks/spyglass-collect.sh`)에서 값 추출 로직 추가
7. `/collect` 엔드포인트(`packages/server/src/collect.ts`)에서 필드 전달

---

## 스토리지 레이어 API 패턴

모든 쿼리 함수는 `Database` 인스턴스를 첫 번째 인자로 받습니다.

```typescript
// packages/storage/src/queries/request.ts 패턴
export function createRequest(db: Database, params: CreateRequestParams): void {
  db.prepare(`INSERT INTO requests (...) VALUES (...)`).run(params);
}

export function getRequestsBySession(
  db: Database, sessionId: string, limit = 100
): RequestRow[] {
  return db.prepare(`SELECT * FROM requests WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?`)
    .all(sessionId, limit) as RequestRow[];
}

// 집계 함수 패턴
export function getToolStats(db: Database): ToolStat[] {
  return db.prepare(`
    SELECT tool_name, COUNT(*) as count, SUM(tokens_total) as total_tokens
    FROM requests WHERE type = 'tool_call' AND tool_name IS NOT NULL
    GROUP BY tool_name ORDER BY count DESC
  `).all() as ToolStat[];
}
```

### 공개 API (`packages/storage/src/index.ts`)

신규 쿼리 함수는 반드시 `index.ts`에서 re-export.

---

## 훅 스크립트 데이터 추출

`hooks/spyglass-collect.sh`에서 수집하는 데이터:

### 이벤트 분류
```bash
classify_request_type "$hook_event_name" "$payload"
# 반환: prompt | tool_call | system
```

### 토큰 추출 (transcript JSONL)
```bash
extract_usage_from_transcript "$transcript_path"
# 반환: "input,output,cache_creation,cache_read"
# 마지막 assistant 메시지의 message.usage 필드에서 추출
```

### 도구별 상세 정보
```bash
extract_tool_detail "$tool_name" "$payload"
# Read/Edit/Write → file_path
# Bash → command (80자 truncate)
# Glob → pattern [in path]
# Grep → pattern [in path]
# Agent → subagent_type
```

### 타이밍 측정 (duration_ms)

`PreToolUse` → `PostToolUse` 쌍으로 도구 실행 시간을 측정합니다.

```
PreToolUse  → ~/.spyglass/timing/{session_id}         에 타임스탬프 저장
PostToolUse → 파일 읽어 (now - start_ts) = duration_ms 계산 후 파일 삭제
SessionStart → ~/.spyglass/timing/{session_id}.session 에 타임스탬프 저장
SessionEnd  → 파일 읽어 세션 총 소요 시간 계산 후 파일 삭제
```

> **측정 불가 항목**: 프롬프트 응답 시간(Claude 사고 시간), 도구 병렬 실행 시 중복 타이밍 파일 문제 (동일 session_id 파일 덮어쓰기)

---

## 서버 수집 엔드포인트

### POST /collect

```typescript
interface CollectPayload {
  id: string;             // 요청 UUID
  session_id: string;
  project_name: string;
  timestamp: number;      // Unix ms
  event_type: string;
  request_type: 'prompt' | 'tool_call' | 'system';
  tool_name?: string;
  tool_detail?: string;
  model?: string;
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  duration_ms?: number;
  payload?: string;       // JSON string
  source: string;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
  preview?: string;
}
```

처리 흐름:
1. `INSERT OR IGNORE INTO sessions` — 세션 자동 생성
2. `createRequest()` — request 레코드 저장
3. `invalidateDashboardCache()` — 대시보드 캐시 무효화
4. `broadcastUpdate({ type: 'new_request' })` — SSE 전파

### POST /events

Raw hook payload를 `claude_events` 테이블에 저장.

---

## 작업 흐름

### Phase 1: 요청 분석

사용자 요청을 다음 유형으로 분류합니다:

- **데이터 분석**: 기존 데이터에서 인사이트 추출 (SQL 쿼리 작성)
- **컬럼 추가**: 기존 테이블에 신규 필드 추가 (마이그레이션 필요)
- **테이블 추가**: 신규 데이터 모델 설계 (스키마 + 쿼리 + API 전체)
- **쿼리 개선**: 기존 집계 함수 최적화 또는 신규 집계 추가
- **스크립트 수정**: 훅 스크립트에서 추가 데이터 수집

### Phase 2: 현황 파악

관련 파일을 읽고 현재 구현을 확인합니다:
- 스키마 변경 → `packages/storage/src/schema.ts` 전체 읽기
- 쿼리 추가 → 해당 `queries/*.ts` 파일 읽기
- 스크립트 수정 → `hooks/spyglass-collect.sh` 읽기
- API 추가 → `packages/server/src/api.ts`, `collect.ts` 읽기

### Phase 3: 설계 제안

구현 전 다음을 사용자에게 제시합니다:
1. 변경 범위 (영향받는 파일 목록)
2. 스키마 변경안 (신규 컬럼/테이블 DDL)
3. 마이그레이션 버전 번호 (현재 v9 → 다음은 v10)
4. 데이터 흐름 변경점 (스크립트 → 서버 → DB 순)
5. API 노출 여부 (REST 엔드포인트 추가 필요 시)

### Phase 4: 구현

승인 후 다음 순서로 구현합니다:

**신규 컬럼/테이블 추가 시:**
```
1. schema.ts — CREATE TABLE / ALTER TABLE + SCHEMA_VERSION 증가
2. schema.ts — runMigrations() 블록 추가
3. queries/*.ts — 신규 CRUD 함수
4. index.ts — re-export
5. collect.ts — CollectPayload 인터페이스 + 저장 로직
6. spyglass-collect.sh — 값 추출 로직 + JSON 필드 추가
7. api.ts — 필요 시 엔드포인트 추가
```

**데이터 분석/쿼리 추가 시:**
```
1. queries/*.ts — 집계 함수 작성
2. index.ts — re-export
3. api.ts — GET 엔드포인트 추가
4. 필요 시 Web/TUI에 시각화 추가
```

### Phase 5: 검증 체크리스트

- [ ] 마이그레이션 버전 번호가 순차적으로 증가
- [ ] 신규 컬럼에 `DEFAULT` 값이 지정 (기존 데이터 호환)
- [ ] 쿼리 함수가 `index.ts`에 re-export
- [ ] `CollectPayload` 인터페이스와 실제 DB 컬럼 일치
- [ ] 훅 스크립트의 JSON 생성에 신규 필드 포함 (jq 특수문자 이스케이프)
- [ ] WAL 동시성 고려 (배치 insert는 트랜잭션으로 묶기)
- [ ] 인덱스 추가 여부 검토 (자주 필터링되는 컬럼)

---

## 설계 원칙

1. **마이그레이션 순방향 전용** — DOWN 마이그레이션 없음, ALTER로 컬럼 추가만
2. **기본값 필수** — 신규 컬럼은 반드시 `DEFAULT` 지정 (기존 레코드 보호)
3. **Insert-or-Ignore 패턴** — sessions는 중복 삽입 허용 (`INSERT OR IGNORE`)
4. **트랜잭션 배치** — 다수 레코드 삽입 시 `db.transaction()` 사용
5. **30초 대시보드 캐시** — `/collect` 후 `invalidateDashboardCache()` 호출 필수
6. **SSE 브로드캐스트** — 데이터 변경 시 `broadcastUpdate()` 호출 (실시간 TUI 동기화)
7. **훅 스크립트는 빠르게** — timeout=1s, 무거운 처리 금지, 실패해도 Claude Code 진행
