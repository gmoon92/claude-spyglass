# Claude Code Hook 트리거 방식 소스 기반 연구

> 연구일: 2026-04-18  
> 소스 기준: `claude-code/src/entrypoints/sdk/coreTypes.ts`, `claude-code/src/utils/hooks.ts`

---

## 1. 와일드카드(*) 동작 확인

### 소스 위치
`src/utils/hooks.ts:matchesPattern()`

```typescript
function matchesPattern(matchQuery: string, matcher: string): boolean {
  if (!matcher || matcher === '*') {
    return true  // ← 와일드카드는 모든 이벤트 매칭
  }
  // ... 이하 생략
}
```

### 결론
`matcher: "*"`는 **모든 이벤트 유형에서 동작**합니다.

---

## 2. 지원하는 이벤트 목록 (총 25개)

### 소스 위치
`src/entrypoints/sdk/coreTypes.ts`

```typescript
export const HOOK_EVENTS = [
  'PreToolUse',           // 도구 실행 직전
  'PostToolUse',          // 도구 실행 완료 후
  'PostToolUseFailure',   // 도구 실행 실패 시
  'Notification',         // 알림 발송 시
  'UserPromptSubmit',     // 사용자 프롬프트 제출 시
  'SessionStart',         // 세션 시작
  'SessionEnd',           // 세션 종료
  'Stop',                 // Claude 응답 완료 직전
  'StopFailure',          // API 에러로 턴 종료 시
  'SubagentStart',        // 에이전트 호출 시작
  'SubagentStop',         // 에이전트 응답 완료
  'PreCompact',           // 대화 컴팩션 직전
  'PostCompact',          // 대화 컴팩션 완료 후
  'PermissionRequest',    // 권한 요청 시
  'PermissionDenied',     // 권한 거부 시
  'Setup',                // 저장소 초기화
  'TeammateIdle',         // 팀메이트 대기 전환
  'TaskCreated',          // 태스크 생성
  'TaskCompleted',        // 태스크 완료
  'Elicitation',          // MCP 입력 요청
  'ElicitationResult',    // MCP 입력 응답
  'ConfigChange',         // 설정 파일 변경
  'WorktreeCreate',       // Worktree 생성
  'WorktreeRemove',       // Worktree 제거
  'InstructionsLoaded',   // CLAUDE.md 로드
  'CwdChanged',           // 작업 디렉토리 변경
  'FileChanged',          // 감시 파일 변경
] as const
```

---

## 3. Hook Input 데이터 구조

### 공통 필드 (BaseHookInput)
```typescript
{
  session_id: string;           // 세션 UUID
  transcript_path: string;      // 대화 기록 파일 경로
  cwd: string;                  // 현재 작업 디렉토리
  permission_mode?: string;     // 권한 모드
  agent_id?: string;            // 서브에이전트 ID (있는 경우)
  agent_type?: string;          // 에이전트 타입
}
```

### 이벤트별 추가 필드

| 이벤트 | 추가 필드 |
|--------|-----------|
| **PreToolUse** | `tool_name`, `tool_input`, `tool_use_id` |
| **PostToolUse** | `tool_name`, `tool_input`, `tool_response`, `tool_use_id` |
| **PostToolUseFailure** | `tool_name`, `tool_input`, `tool_use_id`, `error` |
| **SessionStart** | `source` (startup/resume/clear/compact), `agent_type?`, `model?` |
| **SessionEnd** | `reason` (clear/logout/prompt_input_exit/other) |
| **Stop** | `stop_hook_active`, `last_assistant_message?` |
| **StopFailure** | `error` |
| **PermissionRequest** | `tool_name`, `tool_input` |
| **PermissionDenied** | `tool_name`, `tool_input` |
| **UserPromptSubmit** | `prompt` |
| **FileChanged** | `file_path`, `event` (change/add/unlink) |

---

## 4. spyglass 설정 개선안

### 현재 설정의 문제점
```json
// 현재: 이벤트별로 개별 설정 필요 (복잡함)
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [...] }],
    "PostToolUse": [{ "hooks": [...] }],
    "SessionStart": [{ "hooks": [...] }],
    // ... 6개 이상 반복
  }
}
```

### 개선안: 와일드카드 + 단일 핸들러
```json
{
  "hooks": {
    "*": [{
      "hooks": [{
        "command": "bash ${SPYGLASS_DIR}/hooks/spyglass-collect.sh",
        "async": true,
        "timeout": 1
      }]
    }]
  }
}
```

### 단일 스크립트에서 이벤트 분기
```bash
# spyglass-collect.sh
# HookInput이 stdin으로 전달됨
# hook_event_name 필드로 이벤트 타입 판별

payload=$(cat)
event_type=$(echo "$payload" | jq -r '.hook_event_name')

case "$event_type" in
  "PreToolUse"|"PostToolUse"|"PostToolUseFailure")
    # tool_calls 테이블 처리
    ;;
  "SessionStart"|"SessionEnd"|"Stop"|"PermissionRequest")
    # events 테이블 처리
    ;;
esac
```

---

## 5. 핵심 결론

| 항목 | 확인 결과 |
|------|-----------|
| 와일드카드(*) 지원 | ✅ `matcher: "*"`로 모든 이벤트 수신 가능 |
| 이벤트 데이터 구조 | ✅ 표준화된 JSON, event_type으로 분기 가능 |
| 데이터 완전성 | ✅ 25개 이벤트 모두 수집 가능 |
| 설정 복잡도 | ⚠️ 현재 방식은 이벤트별 반복 필요, 와일드카드로 단순화 가능 |

### 권장사항
spyglass 설정을 **와일드카드 방식**으로 개선하여 사용자 설정 부담을 줄일 수 있습니다. 25개 이벤트를 모두 수집하되, 단일 스크립트에서 `hook_event_name`으로 분기 처리하는 것이 유지보수에 유리합니다.
