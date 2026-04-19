# log-page-ux-fix 개발 계획

> Feature: log-page-ux-fix
> 작성일: 2026-04-19
> 작성자: Claude Code

## 목표

로그 페이지 전체 코드 검토에서 발견된 4가지 문제를 수정한다.
기능적 변경 없이 CSS 코드 품질을 개선하고 UX 혼란을 제거하며,
디자이너 참조 문서를 현행화한다.

## 범위

- 포함:
  - table.css: cell-target ellipsis 누락 버그 수정
  - renderers.js: 총글자수 힌트 문구 개선
  - design-tokens.css: 새 토큰 추가 (--accent-bg-light, --accent-bg-medium, --radius-sm, --radius-md, --blue-bg-light, --red-bg-light)
  - table.css: 하드코딩 rgba → CSS 토큰 교체 (3곳)
  - badges.css: 하드코딩 rgba → CSS 토큰 교체 (4곳), border-radius 불일치 해소
  - turn-view.css: 하드코딩 rgba → CSS 토큰 교체 (3곳)
  - ui-designer 참조 문서 현행화 (design-tokens.md, badge-colors.md, design-system.md, screen-inventory.md)
- 제외:
  - 시각적 외관 변경 (색상값 동일 유지)
  - 기능 추가 또는 제거
  - DB/서버 API 코드 수정

## 단계별 계획

### 1단계: design-tokens.css 신규 토큰 추가

추가할 토큰:
- `--accent-bg-light: rgba(217,119,87,0.04)` — 일반 행 hover 배경
- `--accent-bg-medium: rgba(217,119,87,0.07)` — clickable 행 hover 배경
- `--radius-sm: 4px` — 소형 배지 border-radius
- `--radius-md: 6px` — 중형 배지 border-radius
- `--blue-bg-light: rgba(96,165,250,0.18)` — role/cache 배지 배경
- `--red-bg-light: rgba(239,68,68,0.18)` — error 배지 배경

기존 `--accent-dim: rgba(217,119,87,0.1)` 과 혼동되지 않도록 명명:
- 0.04 = light, 0.07 = medium, 0.1 = dim (기존)

### 2단계: table.css 수정

1. `td.cell-target` 에 `text-overflow: ellipsis; white-space: nowrap;` 추가
2. `td`의 `rgba(39,39,39,0.6)` → `var(--border)` 교체
3. `tr:hover td`의 `rgba(217,119,87,0.04)` → `var(--accent-bg-light)` 교체
4. `tr.clickable:hover td`의 `rgba(217,119,87,0.07)` → `var(--accent-bg-medium)` 교체
5. `.prompt-expand-box`의 `rgba(217,119,87,0.05)` → `var(--accent-bg-light)` 교체
   (0.05는 0.04와 시각적으로 동일 수준이므로 light 토큰으로 통일)

### 3단계: badges.css 수정

1. `.role-user`의 `rgba(96,165,250,0.18)` → `var(--blue-bg-light)` 교체
2. `.badge-cache`의 `rgba(96,165,250,0.18)` → `var(--blue-bg-light)` 교체
3. `.badge-error`의 `rgba(239,68,68,0.18)` → `var(--red-bg-light)` 교체
4. border-radius 정비:
   - `.type-badge`: `4px` → `var(--radius-sm)` (현행 유지, 명시화)
   - `.mini-badge`: `3px` → `var(--radius-sm)` (4px로 통일)
   - `.cache-tooltip`: `6px` → `var(--radius-md)` (명시화)

### 4단계: turn-view.css 수정

1. `.turn-header:hover`의 `rgba(217,119,87,0.05)` → `var(--accent-bg-light)` 교체
2. `.turn-item.open .turn-header`의 `rgba(217,119,87,0.04)` → `var(--accent-bg-light)` 교체
3. `.turn-row:hover`의 `rgba(217,119,87,0.04)` → `var(--accent-bg-light)` 교체

### 5단계: renderers.js 힌트 문구 수정

- 현재: `─── 총 N자 ───` (텍스트가 잘리지 않는데 총글자 힌트로 오해)
- 수정: 완전히 제거 — 이미 expanded 전체 텍스트가 표시되므로 불필요

### 6단계: 디자이너 참조 문서 현행화

- `common/design-tokens.md`: 신규 토큰 6종 추가
- `web/badge-colors.md`: 토큰화된 배지 색상 반영
- `web/design-system.md`: 테이블/배지 규칙 업데이트
- `web/screen-inventory.md`: 변경 이력 추가

## 완료 기준

- [ ] `td.cell-target` 에 ellipsis 3종 세트 적용 (overflow, white-space, text-overflow)
- [ ] 힌트 문구 제거 또는 개선
- [ ] design-tokens.css에 6개 신규 토큰 추가
- [ ] table.css, badges.css, turn-view.css 에서 하드코딩 rgba 0건
- [ ] border-radius 4px / 6px → var(--radius-sm) / var(--radius-md) 일관 적용
- [ ] 디자이너 참조 문서 4종 현행화 완료
- [ ] 브라우저 화면 시각적 결과 동일 (색상값 변경 없음)
