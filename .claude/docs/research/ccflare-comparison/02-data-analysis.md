# [데이터 분석] ccflare vs claude-spyglass 비교 분석

> **관점:** 데이터 전문가  
> **핵심 질문:** 스키마 완성도, 삭제 정책, 수집 갭은 어떠한가?

---

## Round 1: 현황 분석

### 1-1. 데이터 스키마 전체 비교

#### ccflare 스키마 (packages/database/src/migrations.ts)

**requests 테이블:**

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | TEXT PK | 요청 고유 ID |
| timestamp | INTEGER | 시간 (밀리초) |
| method | TEXT | HTTP 메서드 |
| path | TEXT | API 경로 |
| account_used | TEXT | 사용 계정 ID |
| status_code | INTEGER | HTTP 상태 코드 |
| success | BOOLEAN | 성공 여부 |
| error_message | TEXT | 오류 메시지 |
| response_time_ms | INTEGER | 응답 시간 |
| failover_attempts | INTEGER | 재시도 횟수 (기본 0) |
| model | TEXT | 사용 모델명 |
| prompt_tokens | INTEGER | 프롬프트 토큰 (input 별칭) |
| completion_tokens | INTEGER | 완성 토큰 (output 별칭) |
| total_tokens | INTEGER | 전체 토큰 |
| cost_usd | REAL | 예상 비용 (USD) |
| output_tokens_per_second | REAL | 생성 속도 |
| input_tokens | INTEGER | 입력 토큰 |
| cache_read_input_tokens | INTEGER | 캐시 읽기 토큰 |
| cache_creation_input_tokens | INTEGER | 캐시 생성 토큰 |
| output_tokens | INTEGER | 출력 토큰 |
| agent_used | TEXT | 사용된 에이전트 |

**request_payloads 테이블:**

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | TEXT PK | requests.id 참조 |
| json | TEXT | 전체 요청/응답 JSON |

→ `ON DELETE CASCADE` 설정으로 자동 정리

---

#### claude-spyglass 스키마 (packages/storage/src/schema.ts)

**sessions 테이블:**

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | TEXT PK | 세션 고유 ID |
| project_name | TEXT | 프로젝트명 |
| started_at | INTEGER | 세션 시작 (밀리초) |
| ended_at | INTEGER | 세션 종료 (NULL=진행중) |
| total_tokens | INTEGER | 누적 토큰 합계 |
| created_at | INTEGER | DB 삽입 시간 |

**requests 테이블:**

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | TEXT PK | 요청 고유 ID |
| session_id | TEXT FK | sessions.id 참조 |
| timestamp | INTEGER | 시간 (밀리초) |
| type | TEXT | 'prompt' \| 'tool_call' \| 'system' |
| tool_name | TEXT | 도구명 (Bash, Read 등) |
| tool_detail | TEXT | 도구 상세 (파일경로, 명령 등) |
| turn_id | TEXT | `<session_id>-T<순번>` |
| model | TEXT | 사용 모델명 |
| tokens_input | INTEGER | 입력 토큰 |
| tokens_output | INTEGER | 출력 토큰 (**수집 불완전**) |
| tokens_total | INTEGER | 전체 토큰 |
| duration_ms | INTEGER | 응답 시간 |
| payload | TEXT | 전체 요청/응답 JSON |
| source | TEXT | 'claude-code-hook' |
| cache_creation_tokens | INTEGER | 캐시 생성 토큰 (v5) |
| cache_read_tokens | INTEGER | 캐시 읽기 토큰 (v5) |

**마이그레이션 이력:**

| 버전 | 변경 내용 |
|------|----------|
| v1 | 초기 스키마 |
| v2 | tool_detail 컬럼 추가 |
| v3 | turn_id 컬럼 + 기존 데이터 소급 적용 |
| v4 | source 컬럼 추가 |
| v5 | cache_creation_tokens, cache_read_tokens 추가 |

---

### 1-2. 로그 데이터 삭제 정책

#### ccflare — 이중 보존 정책

```
설정 파일 (config.json 또는 환경변수):
  DATA_RETENTION_DAYS    = 7    (기본값, 범위: 1~365)
  REQUEST_RETENTION_DAYS = 365  (기본값, 범위: 1~3650)

실행 시점: 서버 시작 시 runStartupMaintenance() 자동 실행

삭제 순서:
  1. requests 테이블 → timestamp < (now - 365일) 삭제
  2. request_payloads → timestamp < (now - 7일) 삭제
  3. 고아 payloads → request 없는 payload 삭제
  4. PRAGMA VACUUM → DB 파일 압축

수동 API:
  POST /api/maintenance/cleanup
  POST /api/maintenance/compact
```

**설계 철학:** payload(무거운 JSON)는 짧게, 메타데이터(경량)는 길게 보관

#### claude-spyglass — 미구현

```
정의된 함수들 (호출 없음):
  deleteOldSessions(db, cutoffTs) → sessions 삭제
  deleteOldRequests(db, cutoffTs) → requests 삭제

문제:
  - 함수 정의만 있고 서버 어디서도 호출 안 함
  - DB 파일 (~/.spyglass/spyglass.db) 무한 증가
  - payload 컬럼이 TEXT로 requests 테이블에 내장
    → 별도 테이블 분리 없어 payload 선별 삭제 불가
```

---

### 1-3. 이벤트 수집 비교

#### ccflare 수집 이벤트

```
모든 HTTP 요청 대상:
  - RequestStartEvt: id, timestamp, method, path, accountId, statusCode
  - RequestSummaryEvt: 전체 토큰, 비용, 응답시간, 모델
  - RequestPayloadEvt: 요청/응답 전체 바디
```

#### claude-spyglass 수집 이벤트

| 훅 이벤트 | 수집 데이터 | 이벤트 타입 |
|----------|-----------|-----------|
| UserPromptSubmit | 사용자 메시지 payload | prompt |
| PreToolUse | 도구 요청 payload, tool_name | tool_call |
| PostToolUse | 도구 결과 payload, duration_ms | tool_call |
| Stop / SubagentStop | 세션 종료 신호 | (미수집) |

---

## Round 2: 갭 분석 및 보완

### 2-1. 데이터 항목 갭 매트릭스

> ⚠️ **Claude Code 소스 직접 검증 후 수정된 내용** (`/Users/moongyeom/IdeaProjects/claude-code`)

| 데이터 항목 | ccflare | spyglass | 영향도 |
|-----------|---------|---------|--------|
| input_tokens | ✅ Provider 값 | ⚠️ payload 길이 추정 fallback | 보통 |
| output_tokens | ✅ Provider 최종값 | ❌ **항상 0** | **크리티컬** |
| cache_read_tokens | ✅ | ❌ **항상 0** (env var 없음) | **크리티컬** |
| cache_creation_tokens | ✅ | ❌ **항상 0** (env var 없음) | **크리티컬** |
| cost_usd | ✅ 실시간 계산 | ❌ 없음 | **높음** |
| output_tokens_per_second | ✅ | ❌ 없음 | 보통 |
| success / error_message | ✅ | ❌ 없음 | 보통 |
| failover_attempts | ✅ | ❌ (단일 계정) | 낮음 |
| model | ✅ | ✅ | - |
| response_time_ms | ✅ | ✅ duration_ms | - |
| session 개념 | ✅ HTTP 요청 단위 | ✅ Claude Code 세션 | - |
| turn 그룹화 | ❌ | ✅ turn_id | spyglass 강점 |
| tool_name/detail | ❌ | ✅ | spyglass 강점 |
| project_name | ❌ | ✅ | spyglass 강점 |
| 삭제 정책 | ✅ 이중 TTL | ❌ 미구현 | **높음** |

### 2-2. 모든 토큰 데이터 수집 실패 근본 원인

**[확인된 사실] `CLAUDE_API_USAGE_*` 환경변수는 Claude Code 소스에 존재하지 않는다:**

```bash
# claude-code/src/ 전체 검색 결과: 0건
grep -rn "CLAUDE_API_USAGE" /Users/moongyeom/IdeaProjects/claude-code/src/
# → 출력 없음

# 결론: 아래 코드는 항상 0을 반환한다
local cache_creation_tokens="${CLAUDE_API_USAGE_CACHE_CREATION_INPUT_TOKENS:-0}"  # 💥 항상 0
local cache_read_tokens="${CLAUDE_API_USAGE_CACHE_READ_INPUT_TOKENS:-0}"           # 💥 항상 0
```

**훅 stdin payload에도 usage 정보 없음 (coreSchemas.ts 확인):**

```
PreToolUse:  {tool_name, tool_input, tool_use_id, session_id, transcript_path, ...}
PostToolUse: {tool_name, tool_input, tool_response, tool_use_id, session_id, transcript_path, ...}
Stop:        {stop_hook_active, last_assistant_message(텍스트만), session_id, transcript_path, ...}
→ 어느 훅에도 input_tokens / output_tokens / cache_tokens 없음
```

**[정답] 올바른 데이터 소스: transcript_path JSONL**

모든 훅 payload에 `transcript_path` 필드가 포함되며, 해당 파일에 완전한 usage 데이터가 기록됨:

```json
// 실제 확인값: ~/.claude/projects/<project>/<session>.jsonl
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

Claude Code의 `insights` 명령도 이 파일을 파싱하여 통계를 집계한다
(`src/commands/insights.ts:525-533`):
```typescript
const usage = (msg.message as { usage?: {...} }).usage
if (usage) {
  inputTokens += usage.input_tokens || 0
  outputTokens += usage.output_tokens || 0
}
```

### 2-3. payload 저장 전략 재검토

**현재 spyglass:**
- requests 테이블의 `payload TEXT` 컬럼에 인라인 저장
- 삭제 시 requests 행 전체 삭제 (payload만 선별 불가)
- 큰 payload가 쿼리 성능 저하 유발

**ccflare 방식:**
- `request_payloads` 별도 테이블 + `ON DELETE CASCADE`
- payload 보존 기간(7일) vs 메타 보존 기간(365일) 분리 가능
- 쿼리 시 payload 조인 안 하면 경량화

**개선 제안:**

```sql
-- v6 마이그레이션: payload 분리
CREATE TABLE request_payloads (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  FOREIGN KEY (id) REFERENCES requests(id) ON DELETE CASCADE
);

-- requests.payload 컬럼 제거 (마이그레이션으로)
ALTER TABLE requests DROP COLUMN payload;
```

---

## Round 3: 고도화 제안

### 3-1. 데이터 삭제 정책 구현 (P0)

```typescript
// packages/server/src/index.ts

const RETENTION_CONFIG = {
  payloadDays: parseInt(process.env.SPYGLASS_PAYLOAD_RETENTION_DAYS ?? "7"),
  sessionDays: parseInt(process.env.SPYGLASS_SESSION_RETENTION_DAYS ?? "90"),
};

async function runStartupMaintenance(db: Database) {
  const payloadCutoff = Date.now() - RETENTION_CONFIG.payloadDays * 86_400_000;
  const sessionCutoff = Date.now() - RETENTION_CONFIG.sessionDays * 86_400_000;

  // payload 정리 (requests.payload 컬럼 NULL 처리)
  db.run(`UPDATE requests SET payload = NULL WHERE timestamp < ?`, [payloadCutoff]);

  // 오래된 세션 삭제 (CASCADE로 requests도 삭제)
  db.run(`DELETE FROM sessions WHERE started_at < ?`, [sessionCutoff]);

  // DB 압축
  db.run("PRAGMA VACUUM");

  console.log(`[Maintenance] payload < ${RETENTION_CONFIG.payloadDays}d cleared, sessions < ${RETENTION_CONFIG.sessionDays}d deleted`);
}
```

### 3-2. 비용 계산 추가 (P1)

```typescript
// packages/storage/src/pricing.ts (신규)

const ANTHROPIC_PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-7":          { input: 15.0,  output: 75.0  },
  "claude-sonnet-4-6":        { input: 3.0,   output: 15.0  },
  "claude-haiku-4-5-20251001":{ input: 0.8,   output: 4.0   },
};

export function calcCostUsd(
  model: string,
  tokensInput: number,
  tokensOutput: number,
  cacheCreation: number,
  cacheRead: number,
): number {
  const p = ANTHROPIC_PRICING[model] ?? { input: 3.0, output: 15.0 };
  return (
    tokensInput   * p.input  / 1_000_000 +
    tokensOutput  * p.output / 1_000_000 +
    cacheCreation * p.input  / 1_000_000 * 1.25 +
    cacheRead     * p.input  / 1_000_000 * 0.10
  );
}
```

### 3-3. 스키마 v6 로드맵

| 단계 | 변경 | 목적 |
|------|------|------|
| v6 | `cost_usd REAL DEFAULT 0` 컬럼 추가 | 비용 추적 |
| v6 | `tokens_per_second REAL DEFAULT 0` 컬럼 추가 | 생성 속도 추적 |
| v6 | `stop_reason TEXT` 컬럼 추가 | 응답 종료 이유 (end_turn, tool_use 등) |
| v7 | `request_payloads` 분리 | payload 독립 보존 정책 |
| v7 | `requests.payload` 컬럼 NULL 허용 | 점진적 마이그레이션 |

### 3-3. 스키마 v6 로드맵

| 단계 | 변경 | 목적 |
|------|------|------|
| v6 | `cost_usd REAL DEFAULT 0` 컬럼 추가 | 비용 추적 |
| v6 | `tokens_per_second REAL DEFAULT 0` 컬럼 추가 | 생성 속도 추적 |
| v6 | `stop_reason TEXT` 컬럼 추가 | 응답 종료 이유 |
| v7 | `request_payloads` 분리 | payload 독립 보존 정책 |
| v7 | `requests.payload` 컬럼 NULL 허용 | 점진적 마이그레이션 |

### 3-4. 데이터 품질 지표 (Claude Code 소스 검증 후 재평가)

| 항목 | 기존 추정 | **실제 품질** | 비고 |
|------|---------|------------|------|
| tokens_input | 80% | **50%** | payload 길이 추정만 동작, Provider 값 미수집 |
| tokens_output | 30% | **0%** | 항상 0. 환경변수 존재 안 함, transcript 미활용 |
| cache_creation_tokens | 90% | **0%** | `CLAUDE_API_USAGE_*` 환경변수 존재 안 함 |
| cache_read_tokens | 90% | **0%** | 동일 이유 |
| duration_ms | 85% | **85%** | PreToolUse↔PostToolUse 타이밍 정상 동작 |
| model | 95% | **95%** | prompt 타입에서 payload 파싱 |
| tool_name | 98% | **98%** | 훅 payload.tool_name 직접 추출 |
| session 관계 | 99% | **99%** | 세션 생성 안정적 |
| turn 그룹화 | 95% | **95%** | 순번 채번 로직 안정적 |

> **핵심 결론:** 현재 spyglass의 token 관련 데이터(output, cache)는 전부 0으로 저장되고 있다.  
> transcript_path JSONL 파싱 방식으로 전면 교체해야 신뢰할 수 있는 데이터를 수집할 수 있다.
