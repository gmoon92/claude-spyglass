---
name: doc-adr
description: >
  기능별 Architecture Decision Records(adr.md)를 관리하는 스킬.
  개발 착수 전 기술 결정을 기록하고, ADR 상태 변경 시 사용.
  "ADR 추가", "아키텍처 결정 기록", "기술 결정 문서화" 요청에 트리거됩니다.
  docs/planning/03-adr.md는 초기 개발 레거시로 수정하지 않습니다.
---

# doc-adr

기능별 Architecture Decision Records 관리 스킬

## 개요

기능(feature) 개발 착수 전 기술 결정을 기록합니다.
프로젝트 전체 아키텍처 문서는 `doc-spec` 스킬(`docs/architecture.md`)을 사용하세요.

## 문서 위치

`.claude/docs/plans/<feature>/adr.md`

```
.claude/docs/plans/
└── <feature>/
    ├── plan.md      # 개발 계획
    ├── adr.md       # 기술 결정 (본 스킬 관리)
    └── tasks.md     # 작업 목록
```

> `docs/planning/03-adr.md`는 초기 개발 레거시 — 수정 금지

## ADR 형식

```markdown
## ADR-001: {제목}

### 상태
**결정됨** (YYYY-MM-DD)

### 배경
{문제 상황과 맥락}

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | ... | ... | ... |
| B | ... | ... | ... |

### 결정
{채택된 결정}

### 이유
1. {이유 1}
2. {이유 2}
```

## 관례

1. **번호**: feature 내에서 순차 부여 (ADR-001, ADR-002, ...)
2. **상태**: `제안됨` → `결정됨` / `반려됨` → `대체됨`
3. **날짜**: `YYYY-MM-DD`
4. **커밋**: `docs(<feature>): ADR 작성 — {제목}`

## 새 ADR 추가 절차

1. `.claude/docs/plans/<feature>/adr.md` 열기 (없으면 생성)
2. 위 형식으로 ADR 섹션 추가
3. 커밋
