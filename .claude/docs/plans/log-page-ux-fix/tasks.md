# log-page-ux-fix Tasks

> Feature: log-page-ux-fix
> 시작일: 2026-04-19
> 상태: 진행 중

## Tasks

### 1단계: design-tokens.css 신규 토큰 추가

- [x] `--accent-bg-light: rgba(217,119,87,0.04)` 추가
- [x] `--accent-bg-medium: rgba(217,119,87,0.07)` 추가
- [x] `--blue-bg-light: rgba(96,165,250,0.18)` 추가
- [x] `--red-bg-light: rgba(239,68,68,0.18)` 추가
- [x] `--radius-sm: 4px` 추가
- [x] `--radius-md: 6px` 추가

### 2단계: table.css 수정

- [x] `td.cell-target`에 `text-overflow: ellipsis; white-space: nowrap;` 추가 (버그 수정)
- [x] `td` border-bottom: `rgba(39,39,39,0.6)` → `var(--border)` 교체
- [x] `tr:hover td` background: `rgba(217,119,87,0.04)` → `var(--accent-bg-light)` 교체
- [x] `tr.clickable:hover td` background: `rgba(217,119,87,0.07)` → `var(--accent-bg-medium)` 교체
- [x] `.prompt-expand-box` background: `rgba(217,119,87,0.05)` → `var(--accent-bg-light)` 교체
- [x] `.expand-copy-btn` border-radius: `4px` → `var(--radius-sm)` 교체

### 3단계: badges.css 수정

- [x] `.role-user` background: `rgba(96,165,250,0.18)` → `var(--blue-bg-light)` 교체
- [x] `.badge-cache` background: `rgba(96,165,250,0.18)` → `var(--blue-bg-light)` 교체
- [x] `.badge-error` background: `rgba(239,68,68,0.18)` → `var(--red-bg-light)` 교체
- [x] `.type-badge` border-radius: `4px` → `var(--radius-sm)` 교체
- [x] `.mini-badge` border-radius: `3px` → `var(--radius-sm)` 교체 (4px로 통일)
- [x] `.cache-tooltip` border-radius: `6px` → `var(--radius-md)` 교체

### 4단계: turn-view.css 수정

- [x] `.turn-header:hover` background: `rgba(217,119,87,0.05)` → `var(--accent-bg-light)` 교체
- [x] `.turn-item.open .turn-header` background: `rgba(217,119,87,0.04)` → `var(--accent-bg-light)` 교체
- [x] `.turn-row:hover` background: `rgba(217,119,87,0.04)` → `var(--accent-bg-light)` 교체

### 5단계: renderers.js 힌트 문구 제거

- [x] `togglePromptExpand()` 내 `lengthHint` / `fullDisplay` 로직 제거 (ADR-002)

### 6단계: 디자이너 참조 문서 현행화

- [x] `common/design-tokens.md`: 신규 토큰 6종 추가
- [x] `web/badge-colors.md`: 토큰화된 배지 색상 변수 및 border-radius 규칙 반영
- [x] `web/design-system.md`: 테이블/확장패널 하드코딩 예시 → 토큰 참조로 교체, 신규 토큰 추가
- [x] `web/screen-inventory.md`: 변경 이력 5행 추가

## 완료 기준

- [x] `td.cell-target`에 ellipsis 3종 세트 완전 적용
- [x] 총글자수 힌트 제거 확인 (복사 시 힌트 미포함)
- [x] `design-tokens.css`에 신규 토큰 6종 존재 확인
- [x] `table.css`, `badges.css`, `turn-view.css` 내 하드코딩 rgba(217/96/239...) 0건
- [x] `badges.css` border-radius 값이 `var(--radius-sm)` / `var(--radius-md)` 만 사용
- [x] 디자이너 참조 문서 4종 현행화 완료
