---
name: doc-planning
description: >
  계획 문서(ADR, Spec)를 관리하는 스킬.
  ADR 추가/수정, Spec 현행화 작업 시 사용.
  "ADR 작성", "스펙 업데이트" 등의 요청에 트리거됩니다.
  docs/planning/ 하위 문서는 초기 개발 레거시로 수정하지 않습니다.
---

# doc-planning

현행 계획 문서(ADR, Spec)를 관리하는 스킬

## 개요

프로젝트의 현행 문서를 관리합니다. 각 문서별 전용 스킬을 사용합니다.

| 문서 유형 | 파일 | 담당 스킬 | 비고 |
|-----------|------|-----------|------|
| ADR | `docs/adr.md` | doc-adr | 현행 |
| Spec | `docs/spec.md` | doc-spec | 현행 |

> **`docs/planning/` 하위 파일은 초기 개발 레거시 — 수정 금지**
> (01-overview-plan.md, 02-prd.md, 03-adr.md, 04-tasks*.md, 05-spec.md)

## 파일 구조

```
docs/
├── spec.md          ← 현행 스펙 (doc-spec 스킬 관리)
├── adr.md           ← 현행 ADR (doc-adr 스킬 관리)
└── planning/        ← 초기 개발 레거시 (수정 금지)
    ├── 01-overview-plan.md
    ├── 02-prd.md
    ├── 03-adr.md
    ├── 04-tasks-ai.md
    └── 05-spec.md
```

## 사용법

- ADR 작업 → **doc-adr** 스킬
- Spec 작업 → **doc-spec** 스킬

## 관례

1. **날짜 형식**: `YYYY-MM-DD`
2. **상태 표시**: `✅ 완료` | `🔄 진행 중` | `⏳ 예정`
3. **커밋 메시지**: `docs(adr|spec): 설명`
