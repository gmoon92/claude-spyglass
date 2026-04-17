---
name: spyglass-planning
description: >
  spyglass 프로젝트의 계획 문서(ADR, Task, Spec)를 관리하는 스킬.
  ADR 추가/수정, Task 목록 업데이트, Spec 현행화, Phase 상태 관리 작업 시 사용.
  "ADR 작성", "Task 추가", "스펙 업데이트", "Phase 초기화" 등의 요청에 트리거됩니다.
---

# spyglass-planning

spyglass 프로젝트의 계획 문서(ADR, Task, Spec)를 관리하는 스킬

## 개요

이 스킬은 spyglass 프로젝트의 계획 문서를 일관된 형식으로 작성하고 관리합니다.

| 문서 유형 | 파일명 | 담당 스킬 |
|-----------|--------|-----------|
| ADR | `docs/planning/03-adr.md` | spyglass-adr |
| Task | `docs/planning/04-tasks-ai.md` | spyglass-task |
| Spec | `docs/planning/05-spec.md` | spyglass-spec |

## 위치

- **플랜 문서**: `docs/planning/`
- **Phase 상태**: `phases/phase-{N}-{name}/status.json`

## 사용법

각 문서 유형별로 전용 스킬을 사용합니다.

- ADR 작업 → **spyglass-adr** 스킬
- Task 작업 → **spyglass-task** 스킬
- Spec 작업 → **spyglass-spec** 스킬

### Phase 상태 초기화

새 Phase를 시작할 때 `phases/phase-{N}-{name}/status.json`을 생성합니다.

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
├── 03-adr.md           # ADR (spyglass-adr 스킬 관리)
├── 04-tasks-ai.md      # Task (spyglass-task 스킬 관리)
└── 05-spec.md          # Spec (spyglass-spec 스킬 관리)

phases/
├── phase-1-storage/status.json
├── phase-2-hooks/status.json
├── phase-3-server/status.json
├── phase-4-tui/status.json
├── phase-5-tui-live/status.json
├── phase-6-tui-history/status.json
└── phase-7-alerts/status.json
# Phase 8 이후는 status.json 없이 git 커밋으로만 추적
```

## 관례

1. **날짜 형식**: ISO 8601 (`2026-04-17T12:00:00Z`)
2. **Phase ID**: `phase-{N}-{kebab-case-name}`
3. **상태 값**: `pending`, `in_progress`, `completed`
4. **커밋 메시지**: `docs(scope): 설명`
