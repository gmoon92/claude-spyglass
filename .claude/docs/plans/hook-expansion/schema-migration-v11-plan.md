# Schema Migration V11 — 훅 확장 수집 필드 정규화

> **작성일**: 2026-04-20
> **선행 문서**: `hook-research.md`, `plan.md`, `adr.md`, `adr-v2.md`, `tasks.md`
> **상태**: 설계 승인 완료 · 구현 대기
> **블로커**: data-engineer(Sonnet) / Haiku 서브에이전트 rate limit 소진 (리셋: Apr 24 09:00 Asia/Seoul)

---

## 1. 작업 배경

### 1.1 이전 실험 요약 (Hook Expansion)

`hook-research.md`의 제안대로 **Claude Code 훅 이벤트를 최대한 수집**하기 위해 `~/.claude/settings.json`의 훅 등록을 대폭 확장한 실험.

- **초기 가설**: `"*"` 와일드카드 키로 전체 이벤트 수신 가능
- **검증 결과 (반증)**:
  - `/Users/moongyeom/IdeaProjects/claude-code/src/schemas/hooks.ts` 확인
    ```typescript
    export const HooksSchema = lazySchema(() =>
      z.partialRecord(z.enum(HOOK_EVENTS), z.array(HookMatcherSchema())),
    )
    ```
  - `HOOK_EVENTS` enum에 정의된 **27개 이벤트 키만** 허용. 이벤트 키 레벨에 `*` 불가.
  - `matchesPattern()`의 `*` 처리는 **matcher(tool_name) 레벨 전용**이며 이벤트 키 와일드카드 아님 (`src/utils/hooks.ts:1684`)
- **해결 방안**: 27개 이벤트를 **개별 등록** (현재 `~/.claude/settings.json` 반영 완료)

### 1.2 현재 설정 상태

`/Users/moongyeom/.claude/settings.json` — 27개 이벤트 등록 완료
- 백업: `~/.claude/settings.json.bak-20260420-005926`
- matcher 포함 이벤트: `PreToolUse`, `PostToolUse`, `PostToolUseFailure` (도구 매칭 필요)
- 단순 훅만 사용하는 나머지 24개 이벤트

### 1.3 수집된 이벤트 실측 (spyglass.db)

| event_type | count |
|---|---|
| Stop | 355 |
| SessionStart | 77 |
| SessionEnd | 56 |
| PostToolUseFailure | 14 |
| SubagentStop | 12 |
| SubagentStart | 10 |
| Notification | 7 |
| TaskCreated | 4 |
| PermissionRequest | 3 |
| TaskCompleted | 3 |
| InstructionsLoaded | 2 |
| PreCompact | 2 |
| StopFailure | 2 |
| PostCompact | 1 |
| PreToolUse | 1 |
| WorktreeCreate | 1 |

신규 수집 확인된 이벤트: `SubagentStart/Stop`, `TaskCreated/Completed`, `Notification`, `PermissionRequest`, `InstructionsLoaded`, `PreCompact/PostCompact`, `StopFailure`, `WorktreeCreate`

### 1.4 문제 의식

현재 `claude_events` 테이블 스키마는 **raw payload(JSON TEXT)만 저장**하고 있어 조회·분석 시 매번 `json_extract()` 필요. 신규 수집 이벤트에 포함된 주요 필드를 **정규화 컬럼으로 승격**하여 질의 효율과 분석성을 개선한다.

---

## 2. 설계 (승인 완료)

### 2.1 추가 컬럼 8개

| 컬럼 | 타입 | 출처 필드 (raw payload) | 대상 이벤트 | 비고 |
|---|---|---|---|---|
| `permission_mode` | TEXT | `permission_mode` | SessionStart, PermissionRequest | `default`, `acceptEdits`, `bypassPermissions`, `plan` 등 |
| `source` | TEXT | `source` | SessionStart | `startup`, `resume`, `compact` 등 기동 경로 |
| `end_reason` | TEXT | `reason` | SessionEnd, Stop | **SQL 예약어 `reason` 회피**를 위해 `end_reason`으로 컬럼명 변경 |
| `model` | TEXT | `model` | Stop, SessionStart | `claude-opus-4-7` 등 모델 ID |
| `stop_hook_active` | INTEGER | `stop_hook_active` | Stop | boolean → 0/1 매핑 |
| `task_id` | TEXT | `tool_use_id` / `task_id` | TaskCreated, TaskCompleted | Task 추적용 ID |
| `task_subject` | TEXT | `description` / `subject` | TaskCreated | 태스크 제목/설명 |
| `notification_type` | TEXT | `notification_type` / `type` | Notification | 알림 종류 |

### 2.2 SCHEMA_VERSION

- 현재: `10`
- 목표: `11`

### 2.3 마이그레이션 DDL

```sql
ALTER TABLE claude_events ADD COLUMN permission_mode TEXT;
ALTER TABLE claude_events ADD COLUMN source TEXT;
ALTER TABLE claude_events ADD COLUMN end_reason TEXT;
ALTER TABLE claude_events ADD COLUMN model TEXT;
ALTER TABLE claude_events ADD COLUMN stop_hook_active INTEGER;
ALTER TABLE claude_events ADD COLUMN task_id TEXT;
ALTER TABLE claude_events ADD COLUMN task_subject TEXT;
ALTER TABLE claude_events ADD COLUMN notification_type TEXT;
```

> SQLite `ALTER TABLE ADD COLUMN`은 멱등적이지 않으므로, 기존 마이그레이션 패턴처럼 `PRAGMA user_version < 11` 게이트로 1회 실행 보장.

---

## 3. 수정 대상 파일 (구체적 체크리스트)

### 3.1 `packages/storage/src/schema.ts`

**(a) `SCHEMA_VERSION` 갱신**
- `152` 라인: `export const SCHEMA_VERSION = 10;` → `11`

**(b) `MIGRATION_V11` 추가** — `MIGRATION_V10` (306 라인) 뒤에 삽입
```typescript
/**
 * v11 마이그레이션: 훅 확장으로 수집되는 신규 필드 정규화
 *
 * 27개 HOOK_EVENTS 등록 이후 SessionStart/End/Stop/Task/Notification/Permission 등의
 * 이벤트 payload에서 공통으로 활용되는 필드를 컬럼으로 승격한다.
 * reason은 SQL 예약어와 충돌 가능성이 있어 end_reason으로 매핑한다.
 */
export const MIGRATION_V11 = `
ALTER TABLE claude_events ADD COLUMN permission_mode TEXT;
ALTER TABLE claude_events ADD COLUMN source TEXT;
ALTER TABLE claude_events ADD COLUMN end_reason TEXT;
ALTER TABLE claude_events ADD COLUMN model TEXT;
ALTER TABLE claude_events ADD COLUMN stop_hook_active INTEGER;
ALTER TABLE claude_events ADD COLUMN task_id TEXT;
ALTER TABLE claude_events ADD COLUMN task_subject TEXT;
ALTER TABLE claude_events ADD COLUMN notification_type TEXT;
`;
```

**(c) `SCHEMA_META` 갱신** (선택) — tables/indexes 목록 확인 후 필요 시 반영

### 3.2 `packages/storage/src/connection.ts`

**(a) import에 `MIGRATION_V11` 추가** (9 라인 부근)
```typescript
import { ..., MIGRATION_V10, MIGRATION_V11, WAL_MODE_PRAGMAS } from './schema';
```

**(b) `runMigrations()`에 V11 게이트 추가** — 기존 V10 블록 (187~192 라인) 뒤에
```typescript
if (currentVersion.user_version < 11) {
  this.execMulti(MIGRATION_V11);
  this.db.prepare('PRAGMA user_version = 11').run();
}
```

### 3.3 `packages/storage/src/queries/event.ts`

**(a) `ClaudeEvent` 타입 확장** (3~15 라인)
```typescript
export interface ClaudeEvent {
  id?: number;
  event_id: string;
  event_type: string;
  session_id: string;
  transcript_path?: string | null;
  cwd?: string | null;
  agent_id?: string | null;
  agent_type?: string | null;
  timestamp: number;
  payload: string;
  schema_version?: number;
  // --- v11 추가 ---
  permission_mode?: string | null;
  source?: string | null;
  end_reason?: string | null;
  model?: string | null;
  stop_hook_active?: number | null;  // 0/1
  task_id?: string | null;
  task_subject?: string | null;
  notification_type?: string | null;
}
```

**(b) `createEvent` INSERT 확장** (17~34 라인)
```typescript
export function createEvent(db: Database, event: ClaudeEvent): void {
  db.prepare(`
    INSERT OR IGNORE INTO claude_events
      (event_id, event_type, session_id, transcript_path, cwd, agent_id, agent_type,
       timestamp, payload, schema_version,
       permission_mode, source, end_reason, model, stop_hook_active,
       task_id, task_subject, notification_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.event_id,
    event.event_type,
    event.session_id,
    event.transcript_path ?? null,
    event.cwd ?? null,
    event.agent_id ?? null,
    event.agent_type ?? null,
    event.timestamp,
    event.payload,
    event.schema_version ?? 1,
    event.permission_mode ?? null,
    event.source ?? null,
    event.end_reason ?? null,
    event.model ?? null,
    event.stop_hook_active ?? null,
    event.task_id ?? null,
    event.task_subject ?? null,
    event.notification_type ?? null,
  );
}
```

### 3.4 `packages/server/src/events.ts`

**(a) `RawHookPayload` 타입 확장** — 신규 필드 주석 추가(선택)

**(b) `eventsCollectHandler` — event 생성부에 필드 추출 추가** (36~47 라인)
```typescript
const p = payload as Record<string, any>;
const event: ClaudeEvent = {
  event_id: crypto.randomUUID(),
  event_type: payload.hook_event_name,
  session_id: payload.session_id,
  transcript_path: payload.transcript_path ?? null,
  cwd: payload.cwd ?? null,
  agent_id: payload.agent_id ?? null,
  agent_type: payload.agent_type ?? null,
  timestamp: Date.now(),
  payload: JSON.stringify(payload),
  schema_version: 1,
  // --- v11 추출 ---
  permission_mode: p.permission_mode ?? null,
  source: p.source ?? null,
  end_reason: p.reason ?? null,                   // reason → end_reason 매핑
  model: p.model ?? null,
  stop_hook_active: typeof p.stop_hook_active === 'boolean'
    ? (p.stop_hook_active ? 1 : 0)
    : null,
  task_id: p.tool_use_id ?? p.task_id ?? null,
  task_subject: p.description ?? p.subject ?? null,
  notification_type: p.notification_type ?? p.type ?? null,
};
```

> **주의**: 필드 추출 로직은 **`createEvent` 바깥(서버 레이어)에서** 수행한다. storage는 dumb persistence layer.

### 3.5 data-analyst 스킬 문서 현행화

**(a) `.claude/skills/data-analyst/SKILL.md`**
- 수집 가능한 이벤트 유형 리스트 업데이트 (27개)
- v11 마이그레이션 참조 추가

**(b) `.claude/skills/data-analyst/references/schema.md`**
- `claude_events` 테이블 컬럼 목록에 8개 신규 컬럼 추가
- "마이그레이션 이력" 섹션에 v11 항목 추가
- **"27개 수집 이벤트 vs 정규화 컬럼 매핑표"** 신규 섹션 추가

예시 매핑표 형식:
| event_type | 사용 컬럼 | payload에만 존재하는 주요 필드 |
|---|---|---|
| SessionStart | source, permission_mode, model | transcript_path, agents, mcp_servers |
| SessionEnd | end_reason, model | ... |
| Stop | end_reason, model, stop_hook_active | ... |
| TaskCreated | task_id, task_subject | description, prompt |
| Notification | notification_type | title, message |
| PermissionRequest | permission_mode | tool_name, tool_input |
| ... | ... | ... |

---

## 4. 검증 절차

### 4.1 로컬 테스트
```bash
# storage 패키지 테스트
bun test packages/storage

# server 패키지 테스트 (events 핸들러)
bun test packages/server
```

### 4.2 마이그레이션 확인
```bash
# 서버 재기동 (현재 pid 38321, 포트 9999)
# 기동 시 runMigrations() 자동 실행

sqlite3 /Users/moongyeom/.spyglass/spyglass.db ".schema claude_events"
# → 새 8개 컬럼이 추가되어 있어야 함

sqlite3 /Users/moongyeom/.spyglass/spyglass.db "PRAGMA user_version"
# → 11
```

### 4.3 실제 이벤트 수집 확인
```bash
# 새 세션에서 Claude Code 기동 후
sqlite3 /Users/moongyeom/.spyglass/spyglass.db \
  "SELECT event_type, source, permission_mode, model FROM claude_events
   WHERE source IS NOT NULL OR permission_mode IS NOT NULL
   ORDER BY timestamp DESC LIMIT 5;"
# → SessionStart 레코드에 source/permission_mode/model 값이 채워져야 함
```

### 4.4 서버 재기동
- 현재 실행 중: pid 38321, port 9999
- 구현 완료 후 서버 재기동 필요 (설계 변경이 마이그레이션 트리거)

---

## 5. 작업 지시 (다른 세션용)

다른 세션에서 이 문서를 받아 진행할 때:

1. **`data-engineer` 서브에이전트에게 위임** (CLAUDE.md 규칙 — 데이터 레이어는 data-engineer 담당)
   - 위임 시 이 문서 경로를 컨텍스트로 전달: `.claude/docs/plans/hook-expansion/schema-migration-v11-plan.md`
2. 위 **§3 수정 대상 파일** 5개 그룹을 순서대로 반영
3. **§4 검증 절차** 전 항목 통과 확인
4. **data-analyst 스킬 문서 현행화** (§3.5) 잊지 말 것
5. 완료 후 git 커밋은 **`git:commit` 스킬 사용** (CLAUDE.md 규칙)

### 5.1 블록된 이전 시도 기록
- 1차: data-engineer (Sonnet) → rate limit 소진
- 2차: Haiku 서브에이전트 (task id `a64bddd174414bc98`) → 528ms만에 Haiku rate limit 소진 (Apr 24 09:00 리셋), 파일 수정 0건
- 현재 작업트리 변경사항 중 `packages/storage/src/queries/request.ts`는 **이 작업과 무관** (TurnToolCall 타입 확장 — 다른 세션 작업)

---

## 6. 리스크 & 대응

| 리스크 | 영향 | 대응 |
|---|---|---|
| `ALTER TABLE` 실행 중 오류 | 마이그레이션 실패 | `user_version` 게이트로 중복 실행 방지. 실패 시 수동 ROLLBACK. |
| `reason` 필드가 다른 이벤트에서 다른 의미로 사용 | 데이터 혼선 | `end_reason` 컬럼으로 이름 변경. 추출 시 `SessionEnd`/`Stop` 이벤트만 매핑 권장 (추후 고도화) |
| `stop_hook_active` 타입 불일치 | SQLite BOOL 없음 | INTEGER 0/1로 매핑, 서버에서 boolean 변환 |
| `task_id` 필드 다중 소스 | 값 손실 | `tool_use_id ?? task_id` fallback 체인 |
| payload에서 없는 필드 추출 | 대부분 null | `?? null` 방어 |

---

## 7. 미래 작업 (out of scope)

- **이벤트 타입별 전용 뷰 생성**: `v_session_events`, `v_stop_events` 등
- **인덱스 추가**: `idx_events_permission_mode`, `idx_events_model` (쿼리 패턴 관찰 후 결정)
- **대시보드 반영**: 웹 UI에서 permission_mode/source 필터링 추가
- **알림 수집 고도화**: Notification payload 깊이 분석 후 추가 컬럼화 여부 결정

---

## 부록 A. 현재 `claude_events` 테이블 스키마 (변경 전)

```sql
CREATE TABLE claude_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    session_id TEXT NOT NULL,
    transcript_path TEXT,
    cwd TEXT,
    agent_id TEXT,
    agent_type TEXT,
    timestamp INTEGER NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    schema_version INTEGER DEFAULT 1
);
CREATE INDEX idx_events_session_time ON claude_events(session_id, timestamp);
CREATE INDEX idx_events_type_time ON claude_events(event_type, timestamp);
```

## 부록 B. 27개 HOOK_EVENTS 전체 목록

`PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Notification`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`, `Stop`, `StopFailure`, `SubagentStart`, `SubagentStop`, `PreCompact`, `PostCompact`, `PermissionRequest`, `PermissionDenied`, `Setup`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`, `Elicitation`, `ElicitationResult`, `ConfigChange`, `WorktreeCreate`, `WorktreeRemove`, `InstructionsLoaded`, `CwdChanged`, `FileChanged`

## 부록 C. 관련 원천 로그 경로

- 훅 원본 페이로드: `~/.spyglass/logs/hook-raw.jsonl`
- 서버 수신 로그: 서버 stdout (`[RECV] <event> session=<id>`)
- DB: `/Users/moongyeom/.spyglass/spyglass.db`
