# web-dashboard-formatter 검증 보고서

> Feature: web-dashboard-formatter
> 검증일: 2026-04-18
> 상태: ✅ 검증 완료

## 검증 체크리스트

### 1. 태스크 구현 검증 (tasks.md 기반)

- [x] T-01: CSS 타입 색상 변수 SSoT — `packages/web/index.html` `:root` 변수 선언 ✅
- [x] T-02: 타입 배지 P/T/S 약어 + title 툴팁 — `typeBadge()`, subtotal 행, 턴 뷰 ✅
- [x] T-03: `_promptCache` Object → Map 교체 — 삽입 순서 보장 ✅
- [x] T-04: `promptPreview()` r.preview 우선 사용 + 폴백 — `extractPromptText()` 헬퍼 ✅
- [x] T-05: 실시간 피드 scroll lock — `.scroll-lock-banner`, `prependRequest()` scrollTop 보정 ✅

### 2. ADR 결정 준수 검증 (adr.md 기반)

- [x] ADR-001: 단일 HTML 유지 (빌드 시스템 미도입) ✅ — 외부 JS 파일 없이 index.html 단일 파일 유지
- [x] ADR-002: P/T/S 배지 약어 + `title` 속성 툴팁 ✅ — `TYPE_ABBR`, `title="${escHtml(type)}"` 적용
- [x] ADR-003: CSS 변수 SSoT, JS `TYPE_COLORS`가 `getComputedStyle`로 CSS 변수 참조 ✅ — `initTypeColors()` 구현 확인
- [x] ADR-004: `r.preview` 우선 → `r.payload` 파싱 폴백 ✅ — `extractPromptText()` 내 순서 확인
- [x] ADR-005: `_promptCache`가 `Map()` 사용 ✅ — Object API 패턴 전무, Map API만 사용
- [x] ADR-006: 즉시 삽입 + scrollTop 보정 (pendingQueue 방식 미사용) ✅ — pendingQueue 코드 없음

### 3. 기능 요구사항 검증 (plan.md 기반)

- [x] R1: 타입 뱃지/색상 로직이 TUI와 동일한 설계 원칙 (P/T/S, TYPE_ABBR 중앙화) ✅
- [x] R2: preview 필드를 DB에서 직접 사용 (payload 파싱 폴백 유지) ✅
- [x] R3: 논리적 모듈화 구조 강화 (extractPromptText, initTypeColors 등 헬퍼 분리) ✅

### 4. 웹 UI 검증 (Playwright)

- [x] UI-01: 대시보드 정상 로드 및 테이블 렌더링 ✅ — 10개 행 렌더링 확인
- [x] UI-02: 타입 배지가 P / T / S 약어로 표시됨 ✅ — "T", "P" 배지 확인
- [x] UI-03: 배지 `title` 속성에 전체 타입명 포함 ✅ — title="tool_call", title="prompt" 확인
- [x] UI-04: scroll lock 배너가 DOM에 존재하고 초기 숨김 ✅ — display:none 상태 확인
- [x] UI-05: CSS 변수 `--type-prompt-color: #e8a07a` 적용 ✅

## 검증 결과

### 코드 검증
✅ T-01: `:root` 내 6개 CSS 변수 선언, `.type-*` 클래스가 `var()` 참조 적용  
✅ T-01: `initTypeColors()` 존재, `getComputedStyle`로 CSS 변수 읽어 `TYPE_COLORS` 할당  
✅ T-02: `TYPE_ABBR = { prompt:'P', tool_call:'T', system:'S' }` 상수, `typeBadge()` 약어 사용  
✅ T-02: subtotal 행 및 턴 뷰 모두 `typeBadge()` 함수 호출 (하드코딩 없음)  
✅ T-03: `const _promptCache = new Map()`, `.set()/.get()/.delete()/.size/.keys().next()` Map API만 사용  
✅ T-04: `extractPromptText(r)` 헬퍼 — `r.preview` 우선, `r.payload` 파싱 폴백  
✅ T-04: 200자 초과 tooltip에 `총 N자` 표시 로직 확인  
✅ T-05: `.scroll-lock-banner` (sticky), `scrollLockNewCount`, `updateScrollLockBanner()`, `jumpToLatest()` 구현  
✅ T-05: `prependRequest()` 내 `prevScrollHeight`/`prevScrollTop` 보정, `isScrollLocked` boolean 없음

### 웹 UI 검증
✅ http://localhost:9999 대시보드 정상 로드, 테이블 10개 행 렌더링  
✅ 타입 배지 "T"(tool_call), "P"(prompt) 약어 표시 확인  
✅ `.type-badge` 요소 title 속성에 전체 타입명 ("tool_call", "prompt") 확인  
✅ `.scroll-lock-banner` DOM 존재, 초기 `display:none` 상태  
✅ `--type-prompt-color: #e8a07a` CSS 변수 적용 확인  
📸 스크린샷: `screenshots/ui-01-dashboard-load.png`, `screenshots/ui-02-type-badges.png`

## 종합 결과

**✅ 검증 완료** — 18/18 전 항목 통과

| 카테고리 | 통과 | 전체 |
|---------|------|------|
| 태스크 구현 (T-*) | 5 | 5 |
| ADR 준수 | 6 | 6 |
| 기능 요구사항 (R*) | 3 | 3 |
| 웹 UI (UI-*) | 5 | 5 |
| **합계** | **19** | **19** |
