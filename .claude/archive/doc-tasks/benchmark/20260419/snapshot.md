---
name: doc-tasks
description: >
  feature 단위 Task 문서를 관리하는 스킬.
  Task 완료 표시, 새 Task 추가, 누락 작업 기록 시 사용.
  "Task 완료", "작업 추가", "tasks 업데이트" 요청에 트리거됩니다.
  docs/planning/04-tasks*.md는 초기 개발 레거시로 수정하지 않습니다.
---

# doc-tasks

feature 단위 Task 문서 관리 스킬

## 개요

개발 작업을 feature 단위로 기록하고 관리합니다.

## 문서 위치

feature별로 `.claude/docs/plans/<feature>/tasks.md`에 저장합니다.

```
.claude/docs/plans/
└── <feature>/
    ├── plan.md       # 계획 (doc-planning / dev-orchestrator 스킬이 생성)
    ├── adr.md        # 기술 결정 (doc-adr / dev-orchestrator 스킬이 생성)
    └── tasks.md      # 작업 목록 (본 스킬 관리)
```

> `docs/planning/04-tasks-ai.md`, `04-tasks.md`는 초기 개발 레거시 — 수정 금지

## Task 문서 형식

```markdown
# <feature> Tasks

> Feature: <feature-name>
> 시작일: YYYY-MM-DD
> 상태: 진행 중 / 완료

## Tasks

- [x] Task 1 설명
- [x] Task 2 설명
- [ ] Task 3 설명 (진행 중)
- [ ] Task 4 설명

## 완료 기준

- ...
```

## 사용법

### Task 완료 표시

해당 feature의 `tasks.md`를 열고 완료된 항목을 `[x]`로 변경합니다.

### 새 Task 추가

```
@ doc-tasks:add <feature> <task-description>
```

### 누락 작업 기록

```
@ doc-tasks:appendix <feature> <description>
```

## 커밋 컨벤션

```
docs(<feature>): tasks 업데이트 — <변경 내용>
```
