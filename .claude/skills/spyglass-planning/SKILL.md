# spyglass-planning

spyglass 프로젝트의 계획 문서(ADR, Task, Spec)를 관리하는 스킬

## 개요

이 스킬은 spyglass 프로젝트의 계획 문서를 일관된 형식으로 작성하고 관리합니다.

| 문서 유형 | 파일명 | 목적 |
|-----------|--------|------|
| ADR | `03-adr.md` | 아키텍처 결정 기록 |
| Task | `04-tasks-ai.md` | AI 개발 작업 목록 |
| Spec | `05-spec.md` | 최종 스펙 문서 |

## 위치

- **플랜 문서**: `docs/planning/`
- **Phase 상태**: `phases/phase-{N}-{name}/status.json`

## 사용법

### ADR 문서 업데이트

```
@ spyglass-planning:adr
```

새로운 아키텍처 결정을 ADR에 추가합니다.

### Task 문서 업데이트

```
@ spyglass-planning:task
```

Task 목록을 업데이트하고 Phase 상태를 동기화합니다.

### Spec 문서 업데이트

```
@ spyglass-planning:spec
```

최종 스펙 문서를 현행화합니다.

### Phase 상태 초기화

```
@ spyglass-planning:init-phase {phase-id} {phase-name}
```

새 Phase의 status.json을 생성합니다.

## 문서 템플릿

### ADR 템플릿

```markdown
## ADR-XXX: {제목}

- **상태**: 제안/수띅/반려/대체
- **날짜**: YYYY-MM-DD
- **결정자**: @claude

### 배경

{문제 상황 설명}

### 결정

{내린 결정}

### 대안

| 대안 | 장점 | 단점 |
|------|------|------|
| A | ... | ... |
| B | ... | ... |

### 영향

{시스템에 미치는 영향}
```

### Phase Status 템플릿

```json
{
  "phase": "phase-{N}-{name}",
  "name": "{한글 이름}",
  "status": "in_progress",
  "started_at": "YYYY-MM-DDTHH:mm:ssZ",
  "completed_at": null,
  "tasks": [],
  "verification": {
    "all_tests_passed": false,
    "manual_verified": false
  },
  "notes": ""
}
```

## 파일 구조

```
docs/planning/
├── 01-overview-plan.md  # 개발 계획 (수동 관리)
├── 02-prd.md           # PRD (수동 관리)
├── 03-adr.md           # ADR (스킬 관리)
├── 04-tasks-ai.md      # Task (스킬 관리)
└── 05-spec.md          # Spec (스킬 관리)

phases/
├── phase-1-storage/status.json
├── phase-2-hooks/status.json
├── phase-3-server/status.json
├── phase-4-tui/status.json
├── phase-5-tui-live/status.json
├── phase-6-tui-history/status.json
└── phase-7-alerts/status.json
```

## 관례

1. **날짜 형식**: ISO 8601 (`2026-04-17T12:00:00Z`)
2. **Phase ID**: `phase-{N}-{kebab-case-name}`
3. **상태 값**: `pending`, `in_progress`, `completed`
4. **커밋 메시지**: `docs(scope): 설명`
