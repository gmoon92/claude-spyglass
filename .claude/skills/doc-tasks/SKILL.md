---
name: doc-tasks
description: >
  feature 단위 Task 문서를 관리하는 스킬.
  Task 완료 표시, 새 Task 추가, 상태 갱신 시 사용.
  "Task 완료", "작업 시작", "tasks 업데이트" 요청에 트리거됩니다.
  task.json + tasks/task-N.json 구조를 사용합니다.
  docs/planning/04-tasks*.md는 초기 개발 레거시로 수정하지 않습니다.
---

# doc-tasks

feature 단위 Task 문서 관리 스킬

## 개요

개발 작업을 feature 단위로 JSON 파일로 기록하고 관리합니다.
작업 시작/완료 시 `tasks/task-N.json`과 `task.json` 인덱스를 동기화합니다.

## 문서 위치

```
.claude/docs/plans/<feature>/
├── plan.md           # 계획 (doc-planning / dev-orchestrator 스킬이 생성)
├── adr.md            # 기술 결정 (doc-adr / dev-orchestrator 스킬이 생성)
├── task.json         # 태스크 인덱스 (전체 상태 요약 + 파일 경로 목록) ← 본 스킬 관리
└── tasks/
    ├── task-01.json  # 개별 원자성 태스크 세부 정보 ← 본 스킬 관리
    └── task-N.json
```

> `docs/planning/04-tasks-ai.md`, `04-tasks.md`는 초기 개발 레거시 — 수정 금지

## 스키마 및 샘플 참조

파일 생성·수정 시 반드시 스키마와 샘플을 읽고 정규화된 형식을 따릅니다.

| 파일 | 역할 |
|------|------|
| `schemas/task-index.schema.json` | task.json 필드 정의 및 검증 규칙 |
| `schemas/task-detail.schema.json` | task-N.json 필드 정의 및 검증 규칙 |
| `samples/task.sample.json` | task.json 작성 예시 |
| `samples/task-detail.sample.json` | task-N.json 작성 예시 |

---

## 작업 흐름

### 태스크 시작

1. `tasks/task-N.json` → `"status": "in_progress"` 로 변경
2. `task.json` → 해당 태스크 entry `"status": "in_progress"` + `summary.in_progress += 1`, `summary.pending -= 1`, `"updated"` 날짜 갱신

### 태스크 완료

1. `tasks/task-N.json` → `"status": "done"` 으로 변경
2. `task.json` → 해당 태스크 entry `"status": "done"` + `summary.done += 1`, `summary.in_progress -= 1`, `"updated"` 날짜 갱신

### 태스크 추가

1. `tasks/task-N.json` 신규 생성 (`schemas/task-detail.schema.json` + `samples/task-detail.sample.json` 참조)
2. `task.json` → `tasks` 배열에 항목 추가 + `summary.total += 1`, `summary.pending += 1`

### 태스크 스킵

1. `tasks/task-N.json` → `"status": "skipped"` 로 변경
2. `task.json` → 해당 태스크 entry `"status": "skipped"` + `summary.skipped += 1`, `summary.pending -= 1`

---

## 병렬 그룹 확인

`task.json`의 `parallel_groups`를 확인하여 동시 진행 가능한 태스크를 파악합니다.
병렬 가능 태스크는 동시에 `in_progress`로 전환할 수 있습니다.

---

## 커밋 컨벤션

```
docs(<feature>): <T-N> <태스크 제목> 상태 갱신
```

예시:
```
docs(web-refactor): T-01 detectAnomalies 단위 테스트 완료
```
