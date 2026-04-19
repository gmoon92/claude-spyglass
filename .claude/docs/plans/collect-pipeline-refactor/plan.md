# collect-pipeline-refactor 개발 계획

> Feature: collect-pipeline-refactor
> 작성일: 2026-04-19
> 작성자: Claude Code

## 목표

훅 스크립트(bash)에 분산된 데이터 정제 비즈니스 로직을 서버(collect.ts)로 이전하여
아키텍처를 단순화하고, 원장(raw payload) 로그 보존을 완성한다.

**핵심 동기:**
- 훅의 curl은 이미 백그라운드(`&`) fire-and-forget → 서버 처리 지연이 Claude Code를 블로킹하지 않음
- 서버도 로컬 프로세스 → transcript 파일 접근 가능
- bash보다 TypeScript에서 정제 로직이 테스트·유지보수에 유리
- UserPromptSubmit/PostToolUse의 raw payload가 hook-raw.jsonl에 없음 (원장 누락)
- ccflare 비교 결과 output_tokens/cache_tokens 항상 0 → transcript 파싱 개선 기회

---

## 범위

**포함:**
- `hooks/spyglass-collect.sh` — raw 전달 전용으로 단순화 + 전 이벤트 hook-raw.jsonl 기록
- `packages/server/src/collect.ts` — 정제 로직 전담 (transcript 파싱, tool_detail, model, timing)
- `packages/server/src/collect.ts` — CollectPayload 인터페이스를 ClaudeHookPayload(raw)로 교체
- `packages/server/src/api.ts` — 수신 로그 추가

**제외:**
- 스키마 변경 (기존 컬럼으로 충분)
- UI/TUI 변경
- 데이터 삭제 정책 (별도 feature로 분리)
- 비용 계산 (별도 feature로 분리)

---

## 현재 구조 vs 목표 구조

```
[현재]
Hook (bash)
  ├─ extract_usage_from_transcript()  ← 비즈니스 로직
  ├─ extract_model()                  ← 비즈니스 로직
  ├─ extract_tool_detail()            ← 비즈니스 로직
  ├─ classify_request_type()          ← 비즈니스 로직
  ├─ duration_ms 파일 기반 계산        ← 비즈니스 로직
  └─ curl POST (가공된 JSON)
           ↓
Server (collect.ts)
  └─ 받은 데이터 그대로 저장

[목표]
Hook (bash)
  ├─ hook-raw.jsonl 기록 (전 이벤트)  ← 원장 보존
  └─ curl POST (raw stdin payload)
           ↓
Server (collect.ts)
  ├─ console.log("[RAW]", ...)        ← 원장 로그
  ├─ readTranscript()                 ← token, model 추출
  ├─ extractToolDetail()              ← tool_detail 파싱
  ├─ timingMap.get/set()              ← duration_ms 인메모리 계산
  └─ 정제된 데이터 저장
```

---

## 단계별 계획

### 1단계: 서버 정제 레이어 구현 (collect.ts)

**1-1. ClaudeHookPayload 타입 정의**

Claude Code 훅이 stdin으로 주는 raw payload 구조 타입화:
```typescript
interface ClaudeHookPayload {
  hook_event_name: string;   // UserPromptSubmit | PreToolUse | PostToolUse | ...
  session_id: string;
  transcript_path?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  tool_use_id?: string;
  permission_mode?: string;
  agent_id?: string;
  agent_type?: string;
}
```

**1-2. transcript 파싱 함수 구현 (TypeScript)**

```typescript
// 현재 bash의 extract_usage_from_transcript() 대체
async function parseTranscript(transcriptPath: string): Promise<{
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  model: string;
}>;
```

**1-3. tool_detail 추출 함수 구현**

```typescript
// 현재 bash의 extract_tool_detail() 대체
function extractToolDetail(toolName: string, toolInput: Record<string, unknown>): string | null;
// Read/Edit/Write → file_path
// Bash → command (80자)
// Glob/Grep → pattern [in path]
// Skill → skill 이름
// Agent → description || prompt[:80]
```

**1-4. 인메모리 타이밍 맵 구현**

```typescript
// 현재 ~/.spyglass/timing/{session_id} 파일 대체
const toolTimingMap = new Map<string, number>(); // tool_use_id → startTs

// PreToolUse: timingMap.set(tool_use_id, Date.now())
// PostToolUse: duration_ms = Date.now() - timingMap.get(tool_use_id)
```

> ⚠️ 현재 파일 기반 타이밍은 session_id로 키를 씀 (도구 병렬 실행 시 충돌 가능).
> tool_use_id 기반으로 교체하면 병렬 도구 실행도 정확히 측정 가능.

**1-5. rawCollectHandler 구현**

```typescript
export async function rawCollectHandler(req: Request, db: SpyglassDatabase): Promise<Response>;
// 1. raw payload 수신
// 2. console.log("[RAW]", hook_event_name, session_id)
// 3. hook_event_name 분기 처리
// 4. transcript 파싱 → token, model
// 5. tool_detail 추출
// 6. duration_ms 계산
// 7. 기존 handleCollect() 로직으로 저장
```

---

### 2단계: 훅 스크립트 단순화

**제거 대상 함수:**
- `extract_usage_from_transcript()`
- `extract_model()`
- `extract_tool_detail()`
- `classify_request_type()` (서버가 hook_event_name으로 직접 분류)
- `extract_tool_name()`, `extract_skill_name()`, `extract_subagent_type()`
- timing 파일 생성/읽기/삭제 로직

**남기는 것:**
- `send_to_spyglass()` — curl 전송
- `send_raw_event()` — /events 전송 (SessionStart/Stop용)
- `ensure_log_dir()`, `log()`, `info()`, `error()` — 로깅
- hook_event_name 분기 (어느 endpoint로 보낼지만 결정)

**추가:**
```bash
# 전 이벤트 hook-raw.jsonl 기록 (원장 보존)
echo "$payload" >> "$SPYGLASS_RAW_LOG"
```

**단순화된 main 흐름:**
```bash
# stdin에서 raw payload 읽기
payload=$(cat)

# 원장 기록
echo "$payload" >> "$SPYGLASS_RAW_LOG"

# hook_event_name에 따라 endpoint 선택 후 raw 전달
case "$hook_event" in
  "UserPromptSubmit"|"PreToolUse"|"PostToolUse")
    send_to_spyglass "$payload" "$SPYGLASS_COLLECT_ENDPOINT"
    ;;
  *)
    send_to_spyglass "$payload" "$SPYGLASS_EVENTS_ENDPOINT"
    ;;
esac
```

---

### 3단계: 서버 라우터 연결 및 로그 추가

- `api.ts`에서 `/collect` 핸들러를 `rawCollectHandler`로 교체
- 수신 시점 로그: `[RECV] {hook_event_name} session={session_id}`

---

### 4단계: 검증

- 실제 Claude Code 세션 실행하며 DB 데이터 확인
- output_tokens, cache_tokens 정상 수집 여부
- tool_call model 값 수집 여부
- duration_ms 정확도
- hook-raw.jsonl 전 이벤트 기록 확인

---

## 완료 기준

- [ ] 훅 스크립트에 정제 로직 없음 (raw 전달 전용)
- [ ] hook-raw.jsonl에 UserPromptSubmit/PostToolUse raw payload 포함
- [ ] output_tokens, cache_tokens DB에 정상값 저장
- [ ] tool_call 레코드에도 model 값 저장
- [ ] duration_ms가 tool_use_id 기반으로 측정
- [ ] 서버 수신 로그 출력
- [ ] 기존 기능(turn_id, pre/post merge, SSE) 정상 동작

---

## 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| transcript 파싱 실패 (파일 없음) | token=0 fallback | 기존과 동일 수준 |
| 인메모리 타이밍 맵 유실 (서버 재시작) | duration_ms=0 | 기존 파일 방식도 동일 문제 |
| 병렬 도구 실행 시 tool_use_id 충돌 | duration 오측 | tool_use_id 고유하므로 오히려 개선 |
| hook-raw.jsonl 파일 크기 급증 | 디스크 사용 | 로테이션 정책은 별도 feature |
