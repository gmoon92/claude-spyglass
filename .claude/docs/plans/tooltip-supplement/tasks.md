# tooltip-supplement Tasks

> Feature: tooltip-supplement
> 시작일: 2026-04-19
> 상태: 완료

## Tasks

### 1단계: Cache Panel 툴팁

- [x] `packages/web/assets/js/cache-panel-tooltip.js` 신규 작성 — `data-cache-panel-tooltip` 속성 기반 이벤트 위임, `.stat-tooltip` CSS 재사용
- [x] `packages/web/index.html` — `.cache-panel` 내 3개 섹션 요소에 `data-cache-panel-tooltip` 속성 추가 (hit-rate, cost, ratio)
- [x] `packages/web/assets/js/main.js` — `initCachePanelTooltip()` import 및 `init()` 내 호출 추가

### 2단계: Turn View / Detail Badges title 속성

- [x] `packages/web/assets/js/session-detail.js` — `renderTurnView` 내 `.turn-meta` span에 `title` 속성 삽입 (IN/OUT/도구/⏱ 풀이)
- [x] `packages/web/assets/js/session-detail.js` — `.detail-agg-badge` 생성 시 `title` 속성 추가 (최고 비용 Turn, 최다 호출 Tool 설명)

### 3단계: index.html 정적 title 추가

- [x] `packages/web/index.html` — `#liveBadge`에 `title` 추가 (SSE 연결 상태 의미 설명)
- [x] `packages/web/index.html` — 날짜 필터 버튼 3개(전체/오늘/이번주)에 `title` 추가 (로컬 시간 기준 설명)
- [x] `packages/web/index.html` — 타입 필터 버튼 4개(All/prompt/tool_call/system)에 `title` 추가 (각 타입 의미 설명)

## 완료 기준

- [x] Cache Panel 3개 섹션 모두 hover 시 `.stat-tooltip` 스타일 툴팁 표시
- [x] Turn View `.turn-meta` hover 시 `title` 툴팁 표시 (IN/OUT/도구 의미 설명)
- [x] Detail Aggregate Badges `title` 추가 완료
- [x] header 정적 요소 `title` 추가 완료
- [x] 날짜/타입 필터 버튼 `title` 추가 완료
- [x] 기존 `.cache-tooltip`, `.stat-tooltip` 동작 유지 확인
- [x] 하드코딩 색상 없음, CSS 변수만 사용
