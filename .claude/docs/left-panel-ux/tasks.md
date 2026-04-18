# Left Panel UX 작업 목록

> 기반 문서: plan.md, adr.md  
> 작성일: 2026-04-18  
> 총 태스크: 3개

---

## 태스크 목록

| ID | 태스크 | 선행 태스크 | 커밋 타입 |
|----|--------|------------|----------|
| T-01 | CSS 변수 추출 + Grid 트랙 고정 (`auto` → `160px`) | - | fix |
| T-02 | `renderTools()` `display` 토글 제거 + 빈 상태 UI | T-01 | fix |
| T-03 | 스켈레톤 다중 행으로 확장 | T-02 | fix |

---

## T-01: CSS 변수 추출 + Grid 트랙 고정

**선행 조건**: 없음

### 작업 내용
`:root`에 `--tool-stats-height` 변수를 추가하고, `.left-panel`의 `grid-template-rows`를 `auto`에서 고정값으로 변경한다.

### 구현 범위
- `packages/web/index.html`:
  - `:root`에 `--tool-stats-height: 160px` 추가
  - `.left-panel` `grid-template-rows: 1fr 1fr auto` → `1fr 1fr var(--tool-stats-height)`
  - `.tool-stats-section` `max-height: 160px` → `max-height: var(--tool-stats-height)`
  - `.tool-stats-section .panel-body` `max-height: calc(160px - 29px)` → `max-height: calc(var(--tool-stats-height) - 29px)`

### 커밋 메시지
```
fix(web): 툴 통계 패널 Grid 트랙 고정으로 레이아웃 점프 제거
```

### 완료 기준
- [ ] `:root`에 `--tool-stats-height: 160px` 변수 존재
- [ ] `.left-panel`이 `grid-template-rows: 1fr 1fr var(--tool-stats-height)` 사용
- [ ] 160px 리터럴이 CSS 변수로 통합됨

---

## T-02: `renderTools()` display 토글 제거 + 빈 상태 UI

**선행 조건**: T-01 완료 후

### 작업 내용
`renderTools()` 함수에서 `section.style.display = 'none'` / `''` 조작을 제거한다.
빈 배열일 때 기존 스켈레톤 행을 표시하도록 수정한다.

### 구현 범위
- `packages/web/index.html`:
  - `renderTools()` 내 `section.style.display = 'none'` 줄 제거
  - `return` 전에 `toolCount`를 `'—'`로, `toolsBody`를 스켈레톤 행으로 설정하도록 변경
  - `section.style.display = ''` 줄 제거

### 커밋 메시지
```
fix(web): 툴 통계 패널 display 토글 제거 및 빈 상태 UI 추가
```

### 완료 기준
- [ ] `renderTools()` 내 `section.style.display` 조작 코드 없음
- [ ] 툴 데이터 없을 때 스켈레톤 행 표시
- [ ] 툴 데이터 있을 때 기존과 동일하게 렌더링

---

## T-03: 스켈레톤 다중 행 확장

**선행 조건**: T-02 완료 후

### 작업 내용
툴 통계 섹션의 스켈레톤을 단일 행에서 3행으로 확장해 160px 고정 공간을 의미 있게 채운다.

### 구현 범위
- `packages/web/index.html`:
  - `toolsBody` 초기 HTML의 단일 스켈레톤 행 → 3행으로 확장
  - `renderTools([])` 빈 상태 스켈레톤도 3행으로 통일

### 커밋 메시지
```
fix(web): 툴 통계 빈 상태 스켈레톤 3행으로 확장
```

### 완료 기준
- [ ] 초기 로드 시 툴 통계 섹션에 스켈레톤 3행 표시
- [ ] 빈 상태와 초기 상태의 스켈레톤이 동일
- [ ] 160px 공간을 스켈레톤이 적절히 채움
