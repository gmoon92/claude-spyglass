# Hook Payload 구조 샘플

실제 DB에서 수집된 훅 페이로드 샘플. 데이터 분석 및 스크립트 수정 시 참고.

> **공통 필드** (모든 PostToolUse/UserPromptSubmit 페이로드):
> `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, `tool_use_id`

---

## 1. `prompt` 타입 — UserPromptSubmit

**훅 이벤트**: `UserPromptSubmit`  
**DB 저장**: `requests.type = 'prompt'`  
**지침 텍스트 위치**: `payload.prompt`

```json
{
  "session_id": "b9a78f19-c2a6-4c85-bc36-eea997dea0ac",
  "transcript_path": "/Users/moongyeom/.claude/projects/.../b9a78f19.jsonl",
  "cwd": "/Users/moongyeom/IdeaProjects/claude-spyglass",
  "permission_mode": "bypassPermissions",
  "hook_event_name": "UserPromptSubmit",
  "prompt": "지금처럼 스킬, 에이전트, 다른 프롬프트, 시스템 프롬프트 등 데이터 분석가가 실제 데이터들을 샘플링된거 구조를 샘플로 읽고 참고 할수 있도록 로컬에 저장해두세요."
}
```

**주의**: `transcript_path`, `tool_use_id` 없음. 토큰 정보는 transcript JSONL에서 추출.

---

## 2. `tool_call` 타입 — Bash

**훅 이벤트**: `PostToolUse`  
**DB 저장**: `requests.type = 'tool_call'`, `tool_name = 'Bash'`  
**tool_detail 위치**: `payload.tool_input.command` (앞 80자)  
**실행 결과**: `payload.tool_response.stdout` / `.stderr`

```json
{
  "session_id": "b9a78f19-...",
  "hook_event_name": "PostToolUse",
  "tool_name": "Bash",
  "tool_input": {
    "command": "sqlite3 ~/.spyglass/spyglass.db << 'EOF'\nSELECT ...\nEOF",
    "description": "prompt 타입 payload 샘플 조회"
  },
  "tool_response": {
    "stdout": "PROMPT|{...}",
    "stderr": "",
    "interrupted": false,
    "isImage": false,
    "noOutputExpected": false
  },
  "tool_use_id": "toolu_01TgSc..."
}
```

---

## 3. `tool_call` 타입 — Read

**tool_detail 위치**: `payload.tool_input.file_path`  
**파일 내용**: `payload.tool_response.file.content`

```json
{
  "hook_event_name": "PostToolUse",
  "tool_name": "Read",
  "tool_input": {
    "file_path": "/Users/moongyeom/IdeaProjects/claude-spyglass/packages/web/assets/js/renderers.js",
    "offset": 55,
    "limit": 60
  },
  "tool_response": {
    "type": "text",
    "file": {
      "filePath": "...",
      "content": "...",
      "numLines": 60,
      "startLine": 55,
      "totalLines": 202
    }
  }
}
```

---

## 4. `tool_call` 타입 — Edit

**tool_detail 위치**: `payload.tool_input.file_path`  
**변경 내용**: `old_string` / `new_string` (대용량 주의)

```json
{
  "hook_event_name": "PostToolUse",
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "/Users/moongyeom/IdeaProjects/claude-spyglass/hooks/spyglass-collect.sh",
    "old_string": "        Skill)\n            detail=$(extract_skill_name \"$payload\")...",
    "new_string": "        Skill)\n            # args 앞 80자 추출...",
    "replace_all": false
  },
  "tool_response": {
    "filePath": "...",
    "oldString": "...",
    "newString": "...",
    "structuredPatch": [{ "oldStart": 259, "oldLines": 10, "newStart": 259, "newLines": 29, "lines": [...] }],
    "userModified": false,
    "replaceAll": false
  }
}
```

---

## 5. `tool_call` 타입 — Grep

**tool_detail 위치**: `payload.tool_input.pattern` (+ path가 있으면 `pattern in path`)

```json
{
  "hook_event_name": "PostToolUse",
  "tool_name": "Grep",
  "tool_input": {
    "pattern": "preview|contextPreview|payload|tool_detail|tool_input",
    "path": "/Users/moongyeom/IdeaProjects/claude-spyglass/packages/web/assets/js/renderers.js",
    "output_mode": "content",
    "context": 3,
    "head_limit": 100
  },
  "tool_response": {
    "mode": "content",
    "numFiles": 0,
    "filenames": [],
    "content": "40-  let extras = ...\n43:    if ..."
  }
}
```

---

## 6. `tool_call` 타입 — Agent (서브에이전트)

**tool_detail 위치**: `payload.tool_input.description` (없으면 `prompt` 앞 80자)  
**실제 지침**: `payload.tool_input.prompt`  
**에이전트 응답**: `payload.tool_response.content[].text`  
**소요 시간**: `payload.tool_response.totalDurationMs`  
**토큰 합계**: `payload.tool_response.totalTokens`

```json
{
  "hook_event_name": "PostToolUse",
  "tool_name": "Agent",
  "tool_input": {
    "description": "DB 스키마 및 현재 메시지 데이터 확인",
    "prompt": "claude-spyglass 프로젝트에서 \"메시지(message)\" 관련 데이터를 파악해줘.\n\n목표:\n1. SQLite DB 스키마 파악...",
    "subagent_type": "Explore"
  },
  "tool_response": {
    "status": "completed",
    "prompt": "...(동일)",
    "agentId": "a9905040c9a191ecc",
    "agentType": "Explore",
    "content": [{ "type": "text", "text": "이제 검색 결과를 종합하겠습니다.\n\n## 검색 결과 — 메시지(message) 관련 데이터 필드\n..." }],
    "totalDurationMs": 18131,
    "totalTokens": 54782,
    "totalToolUseCount": 9,
    "usage": {
      "input_tokens": 5,
      "cache_creation_input_tokens": 3713,
      "cache_read_input_tokens": 50535,
      "output_tokens": 529,
      "iterations": [{ "input_tokens": 5, "output_tokens": 529, "cache_read_input_tokens": 50535, "cache_creation_input_tokens": 3713 }]
    },
    "toolStats": {
      "readCount": 4,
      "searchCount": 5,
      "bashCount": 0,
      "editFileCount": 0,
      "linesAdded": 0,
      "linesRemoved": 0,
      "otherToolCount": 0
    }
  },
  "tool_use_id": "toolu_01WQD3WY5Ca..."
}
```

---

## 7. `tool_call` 타입 — Skill

**tool_detail 위치**: `payload.tool_input.args` (앞 80자)  
**스킬명**: `payload.tool_input.skill`  
**결과**: `payload.tool_response.success` / `.commandName`

```json
{
  "hook_event_name": "PostToolUse",
  "tool_name": "Skill",
  "tool_input": {
    "skill": "data-analyst",
    "args": "실제 DB 데이터를 확인해서 Agent/Skill 타입 tool_call의 payload와 tool_detail 필드가 실제로 무엇을 담고 있는지 분석해줘..."
  },
  "tool_response": {
    "success": true,
    "commandName": "data-analyst"
  },
  "tool_use_id": "toolu_01MMTq..."
}
```

---

## 8. `system` 타입

**현황**: DB에 실제 데이터 없음 (현재 수집 파이프라인에서 미발생).  
분류 조건: `payload.role === "system"` (fallback 로직).

---

## 9. `claude_events` — SessionStart

**저장 위치**: `claude_events` 테이블 (requests와 별도)  
**필드**: `event_type`, `session_id`, `transcript_path`, `cwd`, `payload`

```json
{
  "session_id": "7dc39f61-53dd-4c70-9012-af59ee7641e7",
  "transcript_path": "/Users/moongyeom/.claude/projects/.../7dc39f61.jsonl",
  "cwd": "/Users/moongyeom/IdeaProjects/claude-spyglass",
  "hook_event_name": "SessionStart",
  "source": "compact",
  "model": "claude-sonnet-4-6"
}
```

---

## PreToolUse vs PostToolUse

| 구분 | hook_event_name | DB 저장 | 용도 |
|------|----------------|---------|------|
| `PreToolUse` | `PreToolUse` | **저장 안 함** | `~/.spyglass/timing/{session_id}` 타임스탬프만 기록 |
| `PostToolUse` | `PostToolUse` | **저장** | duration_ms 계산 + requests 레코드 생성 |

PostToolUse payload는 PreToolUse의 `tool_input` + 실행 결과인 `tool_response`가 합쳐진 구조.

---

## 필드별 DB 매핑 요약

| payload 경로 | DB 컬럼 | 비고 |
|-------------|---------|------|
| `prompt` | `preview` | UserPromptSubmit만 |
| `tool_name` | `tool_name` | PostToolUse만 |
| `tool_input.command[:80]` | `tool_detail` | Bash |
| `tool_input.file_path` | `tool_detail` | Read/Edit/Write |
| `tool_input.description` | `tool_detail` | Agent (수정 후) |
| `tool_input.args[:80]` | `tool_detail` | Skill (수정 후) |
| transcript `usage` | `tokens_*` | 모든 타입 |
| timing 파일 차이 | `duration_ms` | PostToolUse |
| 전체 JSON | `payload` | 원본 보존 |
