# Tasks — web-component-split

## 상태: 완료 (2026-04-19)

---

## Phase 1 — 서버 정적 핸들러

- [x] `packages/server/src/index.ts` — `/assets/` prefix 정적 파일 핸들러 추가
  - MIME 맵 (`js`, `css`, `svg`, `ico`)
  - 경로 트래버설 방지 (`path.replace(/\.\./g, '')`)
  - 기존 favicon 핸들러 앞에 삽입 (우선순위 보장)

---

## Phase 2 — CSS 분리 (11개 파일)

- [x] `design-tokens.css` — `:root` 변수 SSoT (ADR-003)
- [x] `layout.css` — body grid, main-layout, footer, media query
- [x] `header.css` — .header, .badge-live, @keyframes pulse, .error-banner, .date-filter, .filter-btn
- [x] `summary-strip.css` — .summary-strip, .stat-card, .stat-label, .stat-value
- [x] `left-panel.css` — .left-panel, .panel-section, .bar-cell, .sess-row-*
- [x] `default-view.css` — .right-panel, .right-view, .charts-inner, .donut-*, .type-filter-btn, .scroll-lock-banner
- [x] `detail-view.css` — .detail-header, .view-tab-bar, .detail-agg-badges, .flat-subtotal
- [x] `table.css` — table/th/td, 행 타입 border (ADR-006), .prompt-expand-box
- [x] `badges.css` — .type-badge, .mini-badge, .action-cell-inner, .cell-msg, .prompt-preview
- [x] `skeleton.css` — .skeleton, @keyframes shimmer
- [x] `turn-view.css` — .turn-item, .turn-row, .tool-icon, .turn-bar

---

## Phase 3 — JS 분리 (8개 모듈)

- [x] `formatters.js` — 순수 함수: fmt, fmtToken, formatDuration, fmtRelative, fmtTime, fmtDate, fmtTimestamp, escHtml (의존성 없음)
- [x] `chart.js` — TYPE_COLORS, timelineBuckets, typeData 상태 + 그리기 함수 (의존성 없음)
- [x] `renderers.js` — makeRequestRow, makeSessionRow, togglePromptExpand, renderRequests 등 ← formatters
- [x] `infra.js` — showError, clearError, setLastUpdated, scrollLock 유틸 (의존성 없음)
- [x] `left-panel.js` — 프로젝트/세션 상태 + renderBrowserProjects/Sessions ← formatters, renderers
- [x] `session-detail.js` — 세션 상세 렌더링, 턴 뷰 ← formatters, renderers
- [x] `api.js` — fetch 함수 모음 ← formatters, chart, infra, left-panel, renderers
- [x] `main.js` — 진입점: SSE, selectProject/Session, 이벤트 위임 ← 전체

---

## Phase 4 — index.html 정리

- [x] `<style>` 블록 제거 (497줄 CSS 전체)
- [x] `<script>` 블록 제거 (1160줄 JS 전체)
- [x] 11개 `<link rel="stylesheet">` 추가 (CSS 로드 순서 규칙 준수)
- [x] `<script type="module" src="/assets/js/main.js">` 추가
- [x] HTML 마크업 보존 확인 (261줄)

---

## Phase 5 — 문서화

- [x] `plan.md` 작성
- [x] `adr.md` 작성 (5개 결정 기록)
- [x] `tasks.md` 작성 (이 파일)
- [x] `screen-inventory.md` 현행화 — 파일 구조 및 변경 이력 업데이트
