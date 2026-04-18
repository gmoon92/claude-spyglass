# [시스템 아키텍처] ccflare vs claude-spyglass 비교 분석

> **관점:** 시스템 아키텍처 전문가  
> **핵심 질문:** 데이터 수집 신뢰성, 확장성, 유지보수성은 어떠한가?

---

## Round 1: 현황 분석

### 1-1. 수집 아키텍처 비교

#### ccflare — 프록시 인터셉션 방식

```
사용자 코드/Claude Code
    │ (HTTP 요청)
    ▼
ccflare:8080 (프록시 서버)
    │
    ├─ StreamTee (1MB 버퍼)
    │    ├─ 클라이언트로 스트리밍 전달
    │    └─ post-processor.worker.ts (Worker Thread)
    │           └─ SSE 청크 파싱 (message_start/delta)
    │                └─ AsyncDbWriter (비동기 큐)
    │                       └─ SQLite
    │
    └─ requestEvents (EventEmitter)
           └─ SSE /api/requests/stream
```

**특징:**
- 모든 API 트래픽이 반드시 이 서버를 통과 → 100% 수집 보장
- Worker Thread로 메인 스레드 블로킹 없음
- AsyncDbWriter로 DB 쓰기 지연 허용 (고처리량)
- StreamTee 1MB 버퍼 → 스트리밍 중단 없이 분석 병행

#### claude-spyglass — 훅 이벤트 방식

```
Claude Code CLI
    │ (훅 이벤트 발화)
    ▼
spyglass-collect.sh (Bash 스크립트)
    │ (HTTP POST, 비동기 백그라운드)
    ▼
spyglass-server:9999 /collect
    │ (동기 DB 쓰기)
    ▼
SQLite (~/.spyglass/spyglass.db)
    │
    └─ SSE /events → 웹 대시보드
```

**특징:**
- Claude Code 내부 훅에 의존 → 훅이 발화되지 않으면 수집 불가
- Bash 스크립트 1초 타임아웃 → 서버 미실행 시 조용히 실패
- 동기 DB 쓰기 → 서버 부하 시 지연 가능
- 단일 사용자 대상 → 확장성 고려 불필요

---

### 1-2. 데이터 처리 방식 비교

#### ccflare — 스트리밍 실시간 파싱

```typescript
// post-processor.worker.ts
// 3단계 토큰 추출:

// 1) message_start → 초기 input 토큰
if (parsed.type === "message_start") {
  state.usage.inputTokens = usage.input_tokens;
  state.usage.cacheReadInputTokens = usage.cache_read_input_tokens;
}

// 2) content_block_delta → tiktoken으로 output 추정
if (parsed.type === "content_block_delta") {
  state.usage.outputTokensComputed += tokenEncoder.encode(text).length;
}

// 3) message_delta → Provider 최종값 (권위있음)
if (parsed.type === "message_delta") {
  state.usage.outputTokens = parsed.usage.output_tokens; // 최종
}
```

**신뢰도:** Provider 최종값 사용 → 매우 정확

#### claude-spyglass — 완료 후 정규식 파싱

```bash
# spyglass-collect.sh
parse_tokens_from_response() {
    input_tokens=$(echo "$response" | grep -oE '"input_tokens"\s*:\s*[0-9]+')
    output_tokens=$(echo "$response" | grep -oE '"output_tokens"\s*:\s*[0-9]+')
}

# Fallback: payload 길이 기반 추정 (input만)
if [[ "$tokens_input" -eq 0 ]]; then
    tokens_input=$((payload_length / 4))
fi
# output_tokens fallback 없음 → 항상 0 가능성
```

**신뢰도:** 정규식 파싱 + 추정 → 낮음  
**핵심 문제:** `output_tokens` fallback 로직 부재

---

### 1-3. 실시간 통신 비교

#### ccflare SSE

```
requestEvents (EventEmitter)
    ├─ "start" 이벤트 (요청 시작 즉시)
    ├─ "summary" 이벤트 (완료 후)
    └─ "payload" 이벤트 (전체 바디)

logBus (EventEmitter)
    └─ "log" 이벤트 (DEBUG/INFO/WARN/ERROR)
```

- 요청 시작부터 완료까지 단계별 이벤트
- 별도 로그 스트림으로 서버 상태 모니터링 가능

#### claude-spyglass SSE

```
SSE /events
    ├─ new_request
    ├─ session_update
    ├─ token_update
    ├─ stats_update
    └─ ping (30초마다 연결 유지)
```

- 훅 수신 완료 후 한 번에 브로드캐스트
- ping으로 연결 유지 (ccflare는 별도 ping 없음)

---

### 1-4. 데이터 보존 정책

#### ccflare — 구현 완료

```typescript
// config/src/index.ts
getDataRetentionDays() → 기본 7일 (payload)
getRequestRetentionDays() → 기본 365일 (메타)

// server.ts 시작 시 자동 실행
runStartupMaintenance()
  └─ cleanupOldRequests(7일, 365일)
  └─ dbOps.compact() → PRAGMA VACUUM

// 수동 API도 제공
POST /api/maintenance/cleanup
POST /api/maintenance/compact
```

#### claude-spyglass — 미구현 (함수만 정의)

```typescript
// storage/src/queries/session.ts
deleteOldSessions(cutoffTs) → 정의됨

// storage/src/queries/request.ts
deleteOldRequests(cutoffTs) → 정의됨

// 문제: 어디서도 호출되지 않음
// 결과: DB 파일 무한 증가
```

---

## Round 2: 갭 분석 및 보완

### 2-1. 수집 신뢰성 갭

| 항목 | ccflare | spyglass | 갭 |
|------|---------|---------|-----|
| 수집 완전성 | 100% (프록시 통과) | ~90% (훅 미발화 가능) | 중간 |
| output_tokens 정확도 | Provider 최종값 | **항상 0** | **크리티컬** |
| input_tokens 정확도 | Provider 값 | payload 길이 추정 fallback | 낮음 |
| cache_tokens 정확도 | Provider 값 | **항상 0** (env var 존재하지 않음) | **크리티컬** |
| 응답 시간 측정 | response_time_ms | PreToolUse↔PostToolUse 차이 | 동등 |

### 2-2. output_tokens 및 cache_tokens 문제 근본 원인 분석

> ⚠️ **Claude Code 소스 (`/Users/moongyeom/IdeaProjects/claude-code`) 직접 검증 결과**

**Claude Code 훅 이벤트 종류 (coreSchemas.ts):**
- `UserPromptSubmit` — 사용자 프롬프트 제출 시
- `PreToolUse` — 도구 실행 전 (`tool_name`, `tool_input` 포함)
- `PostToolUse` — 도구 실행 후 (`tool_name`, `tool_input`, `tool_response` 포함)
- `Stop` / `SubagentStop` — 세션 종료 시 (`last_assistant_message` 텍스트만)

**[사실 확인] `CLAUDE_API_USAGE_*` 환경변수는 존재하지 않는다:**
```bash
# claude-code/src/ 전체 grep 결과: 0건
grep -rn "CLAUDE_API_USAGE" /Users/moongyeom/IdeaProjects/claude-code/src/
# → 아무 결과 없음

# spyglass-collect.sh의 현재 코드는 잘못된 가정 기반:
local cache_creation_tokens="${CLAUDE_API_USAGE_CACHE_CREATION_INPUT_TOKENS:-0}"  # 항상 0
local cache_read_tokens="${CLAUDE_API_USAGE_CACHE_READ_INPUT_TOKENS:-0}"           # 항상 0
```

**훅 이벤트의 stdin payload에도 usage 정보 없음:**
```
PreToolUse payload:  {hook_event_name, tool_name, tool_input, tool_use_id, session_id, transcript_path}
PostToolUse payload: {hook_event_name, tool_name, tool_input, tool_response, tool_use_id, session_id, transcript_path}
Stop payload:        {hook_event_name, stop_hook_active, last_assistant_message, session_id, transcript_path}
→ 어느 훅에도 usage.input_tokens / usage.output_tokens 없음
```

**[정답] 올바른 데이터 소스: transcript_path JSONL 파일**

모든 훅 payload에 `transcript_path`가 포함되며, 해당 JSONL 파일에 완전한 usage 데이터가 기록됨:

```json
// ~/.claude/projects/<project>/<session_id>.jsonl 내 assistant 메시지
{
  "type": "assistant",
  "message": {
    "usage": {
      "input_tokens": 1,
      "cache_creation_input_tokens": 1941,
      "cache_read_input_tokens": 85020,
      "output_tokens": 120
    }
  }
}
```

*실제 스크린샷: claude-spyglass 프로젝트 세션 transcript 확인값*

**올바른 수집 방법 (Stop 훅에서 transcript 읽기):**
```bash
# Stop 훅 또는 PostToolUse 훅에서:
transcript_path=$(echo "$payload" | jq -r '.transcript_path')

# transcript에서 마지막 assistant 메시지의 usage 추출
last_usage=$(grep '"type":"assistant"' "$transcript_path" | tail -1 \
  | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); u=d.get('message',{}).get('usage',{}); print(f\"{u.get('input_tokens',0)},{u.get('output_tokens',0)},{u.get('cache_creation_input_tokens',0)},{u.get('cache_read_input_tokens',0)}\")")

tokens_input=$(echo "$last_usage" | cut -d',' -f1)
tokens_output=$(echo "$last_usage" | cut -d',' -f2)
cache_creation_tokens=$(echo "$last_usage" | cut -d',' -f3)
cache_read_tokens=$(echo "$last_usage" | cut -d',' -f4)
```

이 방식이 Claude Code의 `insights` 명령이 토큰을 집계하는 방식과 동일하다
(`src/commands/insights.ts:525-533`).

### 2-3. 아키텍처 복잡도 비교

| 측면 | ccflare | spyglass | 평가 |
|------|---------|---------|------|
| 코드 규모 | ~5,000줄 (추정) | ~2,000줄 | spyglass 적절 |
| 의존성 수 | 많음 (DI, Worker, tiktoken) | 적음 (Bun 내장) | spyglass 유리 |
| 테스트 용이성 | 높음 (DI, Repository) | 낮음 (직접 의존) | ccflare 유리 |
| 배포 복잡도 | 높음 (proxy 설정 필요) | 낮음 (훅 등록만) | spyglass 유리 |
| 유지보수성 | 높음 (모듈 분리) | 중간 | ccflare 유리 |

---

## Round 3: 고도화 제안

### 3-1. 즉시 적용 (P0)

#### output_tokens + cache_tokens 수집 개선 (transcript 방식)

```bash
# hooks/spyglass-collect.sh — Stop 훅 또는 PostToolUse 훅에서
# transcript_path는 payload에서 추출 (모든 훅 이벤트에 포함됨)

extract_usage_from_transcript() {
    local transcript_path="$1"
    if [[ ! -f "$transcript_path" ]]; then
        echo "0,0,0,0"
        return
    fi

    # 마지막 assistant 메시지의 usage 추출
    grep '"type":"assistant"' "$transcript_path" | tail -1 \
      | python3 -c "
import sys, json
d = json.loads(sys.stdin.read())
u = d.get('message', {}).get('usage', {})
print(f\"{u.get('input_tokens',0)},{u.get('output_tokens',0)},{u.get('cache_creation_input_tokens',0)},{u.get('cache_read_input_tokens',0)}\")
" 2>/dev/null || echo "0,0,0,0"
}

# 사용:
transcript_path=$(echo "$payload" | jq -r '.transcript_path // empty')
if [[ -n "$transcript_path" ]]; then
    usage=$(extract_usage_from_transcript "$transcript_path")
    tokens_input=$(echo "$usage" | cut -d',' -f1)
    tokens_output=$(echo "$usage" | cut -d',' -f2)
    cache_creation_tokens=$(echo "$usage" | cut -d',' -f3)
    cache_read_tokens=$(echo "$usage" | cut -d',' -f4)
fi
```

> **주의:** `CLAUDE_API_USAGE_*` 환경변수는 Claude Code 소스에 존재하지 않으므로 절대 사용 불가.

#### 데이터 삭제 정책 구현

```typescript
// packages/server/src/index.ts 서버 시작 시 추가
async function runStartupMaintenance(db: Database) {
  const retentionDays = parseInt(process.env.SPYGLASS_RETENTION_DAYS ?? "30");
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  
  deleteOldSessions(db, cutoff);  // CASCADE로 requests도 삭제
  db.run("PRAGMA VACUUM");
}
```

### 3-2. 단기 개선 (P1)

#### 비용 계산 추가

```typescript
// 하드코딩 가격표 (Anthropic 공식)
const PRICING = {
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },       // per 1M tokens
  "claude-opus-4-7":   { input: 15.0, output: 75.0 },
  "claude-haiku-4-5":  { input: 0.8, output: 4.0 },
};

function calcCost(model, tokens_input, tokens_output, cache_creation, cache_read) {
  const p = PRICING[model];
  return (tokens_input * p.input + tokens_output * p.output
        + cache_creation * p.input * 1.25   // 캐시 생성: 25% 추가
        + cache_read * p.input * 0.1) / 1e6; // 캐시 읽기: 10% 할인
}
```

### 3-3. 아키텍처 개선 제안 (P2~P3)

| 항목 | 현재 | 제안 | 이유 |
|------|------|------|------|
| DB 쓰기 | 동기 | 비동기 큐 도입 | 고부하 시 안정성 |
| 토큰 추정 | payload/4 | tiktoken 사용 | 정확도 향상 |
| 서버 재시작 | PID 파일 | graceful shutdown 강화 | 데이터 유실 방지 |
| 환경변수 | 분산 관리 | .spyglass/config.json | 설정 일관성 |
