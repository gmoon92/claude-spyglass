---
name: doc-planning
description: >
  기능(feature) 개발 착수 전 계획 문서(plan.md)를 작성하는 스킬.
  "개발 계획 작성", "plan 문서 만들어줘", "feature 계획" 요청에 트리거됩니다.
  복잡한 개발은 dev-orchestrator 스킬(전문가 회의 → ADR → tasks 포함)을 사용하세요.
---

# doc-planning

기능별 개발 계획 문서 관리 스킬

## 개요

기능(feature) 개발 착수 전 계획 문서를 작성합니다.

## 문서 구조

```
.claude/docs/plans/<feature>/   ← 기능별 개발 전 작업 문서
├── plan.md                      # 개발 계획 (본 스킬)
├── adr.md                       # 기술 결정 (doc-adr 스킬)
└── tasks.md                     # 작업 목록 (doc-tasks 스킬)

.claude/docs/research/           ← 기술 조사/비교 분석
docs/architecture.md             ← 프로젝트 전체 아키텍처 (doc-spec 스킬)
docs/planning/                   ← 초기 개발 레거시 (수정 금지)
```

## 스킬 역할 분담

| 문서 | 스킬 | 위치 |
|------|------|------|
| 아키텍처 | `doc-spec` | `docs/architecture.md` |
| 기능별 ADR | `doc-adr` | `.claude/docs/plans/<feature>/adr.md` |
| 기능별 Tasks | `doc-tasks` | `.claude/docs/plans/<feature>/tasks.md` |
| 기능별 Plan | `doc-planning` | `.claude/docs/plans/<feature>/plan.md` |
| 전체 오케스트레이션 | `dev-orchestrator` | 위 3종 일괄 생성 |

## plan.md 형식

```markdown
# <feature> 개발 계획

> Feature: <feature-name>
> 작성일: YYYY-MM-DD
> 작성자: Claude Code

## 목표

<무엇을 왜 만드는가>

## 범위

- 포함: ...
- 제외: ...

## 단계별 계획

### 1단계: ...
### 2단계: ...

## 완료 기준

- [ ] ...
```

## 관례

- `<feature>`: kebab-case
- 커밋: `docs(<feature>): 개발 계획 작성`
