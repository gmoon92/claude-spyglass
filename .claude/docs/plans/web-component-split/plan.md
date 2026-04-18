# 계획: Web 컴포넌트 분리 (index.html → 멀티파일)

## 작업 목표
1916줄 단일 파일 `packages/web/index.html`을 CSS 11개 + JS 8개 파일로 분리하여 유지보수성 개선.

## 기술 방식
- **no-build + native ESM**: Vite/번들러 없이 브라우저 `<script type="module">` 사용
- **CSS 멀티링크**: `<link rel="stylesheet">` 순서 보장
- **서버 `/assets/` 핸들러**: `packages/web/assets/**` 정적 서빙 추가

## 목표 디렉토리 구조
```
packages/web/
├── index.html              ← HTML 마크업 전용 (~200줄)
├── favicon.svg
├── assets/
│   ├── css/
│   │   ├── design-tokens.css   ← :root 변수 SSoT (ADR-003)
│   │   ├── layout.css          ← body grid, main-layout, footer, responsive
│   │   ├── header.css          ← header, error-banner, date-filter
│   │   ├── summary-strip.css
│   │   ├── left-panel.css      ← panel-section, bar-cell, sess-row
│   │   ├── default-view.css    ← right-panel, chart, donut, scroll-lock
│   │   ├── detail-view.css     ← detail-header, tab-bar, agg-badges
│   │   ├── table.css           ← table, expand-box, row-type-border
│   │   ├── badges.css          ← type-badge, action-cell, mini-badge
│   │   ├── skeleton.css        ← skeleton shimmer
│   │   └── turn-view.css       ← turn-item, turn-row, tool-icon
│   └── js/
│       ├── formatters.js       ← 순수 유틸 (no deps)
│       ├── chart.js            ← canvas 차트 모듈 (no deps)
│       ├── renderers.js        ← HTML 빌더 (← formatters)
│       ├── infra.js            ← showError, scrollLock (no deps)
│       ├── left-panel.js       ← 좌측 패널 (← formatters, renderers)
│       ├── session-detail.js   ← 세션 상세 (← formatters, renderers, api[API const])
│       ├── api.js              ← fetch 함수 + 상태 (← formatters, chart, infra, left-panel, renderers)
│       └── main.js             ← 진입점, init, SSE, event delegation
└── parseToolDetail.test.ts
```

## 단방향 import 그래프
```
formatters.js ← (no deps)
chart.js      ← (no deps)
renderers.js  ← formatters
infra.js      ← (no deps)
left-panel.js ← formatters, renderers
session-detail.js ← formatters, renderers, api[API만]
api.js        ← formatters, chart, infra, left-panel, renderers
main.js       ← 전체
```

## 단계별 실행 계획
1. 서버 `/assets/` 핸들러 추가
2. CSS 11개 파일 생성 (design-tokens → layout → 나머지)
3. JS 8개 파일 생성 (formatters → chart → renderers → 상위 모듈)
4. `index.html` 업데이트 (link 태그 + module script)
5. `screen-inventory.md` 업데이트
