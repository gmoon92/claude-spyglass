# spyglass-task

AI 개발 Task 문서 관리 스킬

## 개요

spyglass 프로젝트의 AI 순차 개발 Task를 관리합니다.

## 문서 위치

- **Task 문서**: `docs/planning/04-tasks-ai.md`
- **Phase 상태**: `phases/phase-{N}-{name}/status.json`

## 사용법

### Task 완료 표시

```
@ spyglass-task:complete {phase-id} {task-id}
```

예시:
```
@ spyglass-task:complete phase-5 5-2
```

### Phase 상태 업데이트

```
@ spyglass-task:phase-status {phase-id} {status}
```

상태: `pending` | `in_progress` | `completed`

### 새 Phase Task 추가

```
@ spyglass-task:add {phase-id} {task-name} {estimated-hours}
```

### 누락 작업 기록

```
@ spyglass-task:appendix {description}
```

개발 중 발견된 누락 작업을 부록에 추가합니다.

## Task ID 규칙

- 형식: `{phase-number}-{task-number}`
- 예시: `5-1`, `5-2`, `6-3`

## Phase 상태 파일 구조

```json
{
  "phase": "phase-5-tui-live",
  "name": "TUI Live 탭",
  "status": "completed",
  "tasks": [
    {
      "id": "5-1",
      "name": "SSE 클라이언트 연결",
      "status": "completed",
      "notes": ""
    }
  ],
  "verification": {
    "all_tests_passed": true,
    "manual_verified": true
  }
}
```

## 커밋 컨벤션

```
feat(phase-{N}-{task-id}): 설명
test(phase-{N}-{task-id}): 설명
docs(phase-{N}): 설명
```
