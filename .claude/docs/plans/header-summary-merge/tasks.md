# header-summary-merge Tasks

> Feature: header-summary-merge
> 시작일: 2026-04-26
> 상태: Phase 1 완료 (2026-04-26) / Phase 2 완료 (2026-04-26)

## Tasks

### T1 — Insights 카드 HTML/CSS/JS 완전 제거 (ADR-002)

- [x] `packages/web/index.html`에서 `<!-- Insights 카드 (ADR-016 — default 모드 전용) -->` 블록 통째로 제거
- [x] `packages/web/index.html`에서 `<link rel="stylesheet" href="/assets/css/insights.css">` 줄 제거
- [x] `packages/web/assets/js/main.js`에서 `import { initInsights, loadInsights } from './insights.js';` 제거
- [x] `packages/web/assets/js/main.js`에서 `initInsights();` / `loadInsights('24h');` 호출 제거 + `is-detail-mode insights hide` 주석/코드 정리
- [x] `packages/web/assets/css/insights.css` 파일 삭제
- [x] `packages/web/assets/js/insights.js` 파일 삭제
- [x] `packages/web/assets/js/metrics-api.js`에서 5개 fetcher 제거: `fetchContextUsage`, `fetchActivityHeatmap`, `fetchTurnDistribution`, `fetchAgentDepth`, `fetchAnomaliesTimeseries` (`fetchModelUsage` / `fetchCacheMatrix` / `fetchToolCategories`는 유지)
- [x] grep으로 잔여 `insights` / `Insights` / `insightHeatmap` / `insightContext` / `insightTurn` / `insightAgent` / `insightAnomaly` 0건 확인

**검증**: 페이지 로드 시 콘솔 에러 0, 차트/도넛/캐시 패널 정상 동작
**커밋 메시지**: `refactor(web): Insights 카드 완전 제거 (ADR-002)`

---

### T2 — header.css에 .header-stats / .header-stat / 상태 클래스 SSoT 추가 (ADR-003)

- [x] `packages/web/assets/css/header.css`에 신규 클래스 정의 추가:
  - `.header` 내부 grid 또는 flex 구조 보강 (`.header-left` / `.header-stats` / `.header-right`)
  - `.header-stats`, `.header-stat-group`, `.header-stat-group--hero`, `.header-stat-divider`
  - `.header-stat`, `.header-stat-label`, `.header-stat-value`, `.header-stat--hero`
  - 상태 클래스: `.header-stat.is-active-indicator` (::before dot), `.header-stat.is-error`, `.header-stat.is-critical`
- [x] 기존 design-tokens.css 토큰만 사용 — 신규 토큰 0
- [x] CSS 변수만 사용 (하드코딩 색상 없음)

**검증**: 브라우저 로드 시 CSS 파싱 에러 0, 헤더 외관 변경 없음 (아직 HTML 미적용 단계)
**커밋 메시지**: `feat(web): header chip SSoT 클래스 추가 (ADR-003)`

---

### T3 — index.html .summary-strip → .header 통합 + summary-strip.css 제거 (ADR-001)

- [x] `packages/web/index.html` `<!-- SUMMARY STRIP -->` 블록 통째로 제거
- [x] `packages/web/index.html` `.header` 내부에 `.header-stats` 구조 삽입:
  - 7개 chip (active / err / avg-duration / p95 / sessions / requests / tokens)
  - 2개 divider (Hero | Performance, Performance | Volume)
  - DOM ID 보존: `statActive`, `stat-error-rate`, `statAvgDuration`, `stat-p95`, `statSessions`, `statRequests`, `statTokens`
  - data-stat-tooltip 보존: `active`, `err`, `avg-duration`, `p95`, `sessions`, `requests`, `tokens`
  - `#activeCard` ID 보존
- [x] `packages/web/index.html`에서 `<link rel="stylesheet" href="/assets/css/summary-strip.css">` 줄 제거
- [x] `packages/web/assets/css/summary-strip.css` 파일 삭제
- [x] `packages/web/assets/css/layout.css`:
  - body `grid-template-rows: auto auto auto 1fr auto` → `auto auto 1fr auto`
  - `@media (max-width: 480px)` 내 `.summary-strip { ... }` / `.stat-card { ... }` 블록 제거

**검증**: 헤더에 7개 chip 표시, 시각 위계 보존 (Hero 강조 / divider / 그룹 위계)
**커밋 메시지**: `feat(web): summary-strip을 헤더 chip 그룹으로 통합 (ADR-001)`

---

### T4 — api.js 셀렉터 .stat-card → .header-stat 교체

- [x] `packages/web/assets/js/api.js` line 63 `activeEl.closest('.stat-card')` → `closest('.header-stat')`
- [x] `packages/web/assets/js/api.js` line 82 `errEl.closest('.stat-card')` → `closest('.header-stat')`

**검증**: activeSessions > 0 시 dot + green 텍스트, errorRate > 0 시 red 텍스트, errorRate > 1% 시 critical 배경 모두 정상 동작
**커밋 메시지**: `refactor(web): stat 상태 클래스 셀렉터를 .header-stat으로 교체`

---

### T5 — 헤더 stats 반응형 우선순위 노출

- [x] `packages/web/assets/css/header.css`에 미디어쿼리 추가:
  - `@media (max-width: 1024px)` — Volume 그룹 라벨 단축 (또는 chip padding 축소)
  - `@media (max-width: 768px)` — Volume 그룹 숨김 (가장 우선순위 낮음 — Hero/Performance만 노출)
  - `@media (max-width: 480px)` — Performance 그룹 숨김 (Hero만 노출). 헤더 wrap 또는 horizontal scroll
- [x] title 속성으로 풀라벨 fallback 보장 (단축 라벨 사용 시)

**검증**: 1024px 이하에서 Volume 단축, 768px 이하에서 Volume 숨김, 480px 이하에서 Hero만 노출
**커밋 메시지**: `feat(web): header stats 반응형 우선순위 노출`

---

### T6 — screen-inventory.md / design-system.md 현행화

- [x] `.claude/skills/ui-designer/references/web/screen-inventory.md`
  - "최종 현행화" 섹션에 새 항목 추가 (2026-04-26 header-summary-merge)
  - "화면 5 — 요약 스트립" 섹션 → "화면 4 — 헤더 (통합 stats 포함)"으로 흡수
  - "Insights 카드 신규" 항목 제거 (Phase 3 설명 갱신)
  - 신규 토큰/클래스 행에서 `.insights-card`, `.insight-tile`, `.heatmap-grid`, `.bar-list`, `.anomaly-bars` 제거
  - 신규 토큰/클래스 행에 `.header-stats`, `.header-stat`, `.header-stat-group`, `.header-stat-divider`, `.header-stat--hero` 추가
  - DOM 제거 행에 `.summary-strip`, `.stat-card`, `.stat-group`, `.insights-card` 추가
  - "변경 이력"에 행 2개 추가 (header-summary-merge)
  - 파일 구조 ASCII에서 `summary-strip.css`, `insights.css` 제거. `insights.js` 제거
  - "전체 레이아웃 구조" ASCII에서 `SUMMARY STRIP` 행 제거
- [x] `.claude/skills/ui-designer/references/web/design-system.md`
  - `.summary-strip` / `.stat-card` / `.insights-card` / `.insight-tile` 항목 제거 또는 deprecated 표시
  - `.header-stats` / `.header-stat*` 항목 신규 추가

**검증**: 문서가 현재 코드와 일치 (grep 정합성 확인)
**커밋 메시지**: `docs(ui): screen-inventory / design-system 현행화 (header-summary-merge)`

---

## 의존 순서

```
T1 (Insights 제거)  ────┐
                         ├──> T3 (HTML 통합) ──> T4 (셀렉터 교체) ──> T5 (반응형) ──> T6 (문서)
T2 (CSS SSoT)      ─────┘
```

T1과 T2는 서로 독립이라 순서 무관. T3 이후는 위 순서대로 진행.

## Phase 1 완료 기준

- [x] 모든 task `[x]` 처리
- [x] 메인 화면에서 `.summary-strip` DOM 0 (grep 검증)
- [x] `insights` / `Insights` / `insight` 키워드 0 (grep 검증, 단 ADR 문서 내 인용은 예외)
- [x] 7개 stat 모두 헤더에 표시되고 정상 동작
- [x] stat-tooltip / 활성 dot / 오류율 색상 / critical 강조 모두 정상
- [x] 콘솔 에러 0
- [x] CSS 변수만 사용 (하드코딩 색상 없음)
- [x] screen-inventory.md / design-system.md 현행화 완료

---

# Phase 2 Tasks (header-stats를 view-section-header로 이전 + Donut 버그 수정)

사용자 follow-up: 헤더는 글로벌 네비/필터로 유지, stats는 view 컨텍스트에 종속이므로 view-section으로 이전.

## Phase 2 Tasks

### T7 — chart.js SSoT (setSourceData/hasSourceData) — Donut Model 버그 수정 (ADR-005)

- [x] `chart.js`에 `setSourceData(kind, data)` / `hasSourceData(kind)` 추가
- [x] 두 종류 데이터 (`type` / `model`) 를 모듈 내부에 보관 (`dataByKind`)
- [x] `setDonutMode(mode)`가 활성 데이터셋(typeData)을 자동 전환
- [x] `setTypeData(data)`는 후방 호환 — `setSourceData('type', data)` 위임
- [x] main.js의 `_modelUsageCache` / `_typeDataCache` 외부 캐시 변수 제거
- [x] main.js `initDonutModeToggle` 단순화 (mode 전환 → 필요 시 fetch → drawDonut)

**검증**: Type↔Model 토글 5초 polling 후에도 도넛 유지
**커밋 메시지**: `fix(web): donut model 모드가 fetchDashboard 폴링에 덮어써지던 버그 수정 (ADR-005)`

---

### T8 — index.html에서 `.header-stats` 블록을 chartSection .view-section-header로 이전 (ADR-004)

- [x] `.header-stats` 블록 통째로 `.header`에서 제거
- [x] `<div class="view-section-header">` 안 `.chart-default-meta` 다음에 삽입
- [x] 헤더 단순화: `[.header-left | .header-right]` (header-stats 제거 후 자동 우측 정렬)
- [x] 클래스명 `.header-stat*` SSoT 그대로 유지 (api.js / stat-tooltip.js 호환)
- [x] DOM ID + `data-stat-tooltip` 보존

**검증**: 페이지 로드 시 stats가 chart 헤더 안에 표시. 헤더는 단순한 좌/우 분할.
**커밋 메시지**: `feat(web): header-stats를 view-section-header로 이전 (ADR-004)`

---

### T9 — header.css → default-view.css로 stats 정의 이동 (ADR-004)

- [x] `header.css`에서 다음 정의 제거 (이동):
  - `.header-stats`, `.header-stat-group`, `.header-stat-group--hero`
  - `.header-stat-divider`
  - `.header-stat`, `.header-stat-label`, `.header-stat-value`, `.header-stat--hero`
  - 상태 클래스 `.header-stat.is-active-indicator` (::before dot), `.header-stat.is-error`, `.header-stat.is-critical`
  - `[data-stat-tooltip]:hover` 미세 배경
  - `@media` 쿼리 내 stats 우선순위 노출 로직
- [x] `default-view.css` 또는 `view-stats` 영역에 위 정의 이동 — `#chartSection .view-section-header` 컨텍스트 내부로 명시
- [x] header.css는 다시 단순한 layout/로고/배지/날짜필터 정의만 담당

**검증**: 시각 변화 없음 (CSS 정의 위치만 이동). hot reload 후 동일 화면.
**커밋 메시지**: `refactor(web): stats CSS 정의를 default-view로 이동 (ADR-004)`

---

### T10 — detail 모드 가시성 + view-section-header 폭 정렬 + 반응형

- [x] `#chartSection.chart-mode-detail .header-stats { display: none }` 추가 (detail 모드 자동 숨김)
- [x] `chart-default-meta + .header-stats + .chart-actions` 한 행 정렬:
  - `.view-section-header` flex layout — gap, min-width:0, flex-wrap 정책 정리
  - `.chart-default-meta`는 flex-shrink, `.header-stats`는 flex:1, `.chart-actions`는 우측 고정
- [x] 반응형:
  - `≤ 1024px` — chart-default-meta 부제(`#chartSubtitle`) 숨김 또는 stats Volume 라벨 단축
  - `≤ 768px` — Volume 그룹 숨김
  - `≤ 480px` — Performance 그룹 숨김 (Hero만 노출)

**검증**: detail 진입 시 stats 사라지고 세션 메타 표시. 좁은 폭에서 우선순위 노출 동작.
**커밋 메시지**: `feat(web): view-section-header stats 모드 가시성 + 반응형`

---

### T11 — screen-inventory.md / design-system.md 재현행화

- [x] `.claude/skills/ui-designer/references/web/screen-inventory.md`
  - "최종 현행화"에 Phase 2 항목 추가 (2026-04-26 — header-stats를 view-section으로 이전 + Donut 버그 수정)
  - "화면 0 — 헤더"에서 0-2(통합 stats) 섹션 제거 → 헤더는 좌(로고+LIVE)/우(날짜필터+갱신)로 단순화
  - "화면 1 — 1-1. 요청 추이 차트"에 stats chip 7종 명세 추가 + detail 모드 가시성 명시
  - 변경 이력 행 2개 추가 (T7 도넛 버그 수정, T8~T10 위치 이전)
- [x] `.claude/skills/ui-designer/references/web/design-system.md`
  - "Header Stats" 섹션을 "View-Section Stats" 또는 "Section Stats Chip"으로 개명
  - 위치 변경 반영 (`#chartSection .view-section-header` 자식)
  - detail 모드 자동 숨김 패턴 추가
  - chart.js setSourceData/hasSourceData/setDonutMode SSoT 언급 (ADR-005)

**검증**: 문서가 현재 코드와 일치 (grep 정합성 확인)
**커밋 메시지**: `docs(ui): screen-inventory / design-system Phase 2 현행화`

---

## Phase 2 의존 순서

```
T7 (Donut Hot fix — 완료) ──┐
                              │
                              ▼
T8 (HTML 이전) ──> T9 (CSS 이동) ──> T10 (가시성+반응형) ──> T11 (문서)
```

T7은 독립, 이미 완료. T8~T10은 순차. T11은 마지막.

## Phase 2 완료 기준

- [x] T7 완료 (chart.js SSoT, donut model 토글 정상 동작)
- [x] 헤더가 `[.header-left | .header-right]` 단순 구조로 복귀
- [x] stats chip이 `#chartSection .view-section-header` 안에 표시
- [x] default 모드에서 stats 정상 표시
- [x] detail 모드 진입 시 stats 자동 숨김 + 세션 메타 표시
- [x] api.js / stat-tooltip.js / 상태 클래스 동작 무변경
- [x] 반응형 1024/768/480 동작
- [x] screen-inventory.md / design-system.md Phase 2 현행화

---

# Phase 3 Tasks (2단 위계 재설계 — Hero In-Title / Secondary Strip)

사용자 follow-up: 7개 stat 1행 평탄 나열이 어지러움. 정보 손실 0으로 유지하되 시각 위계 재설계 필요.

## Phase 3 Tasks

### T12 — index.html `view-section-header` 3행(`vsh-row`) 재구성 (ADR-006)

- [x] `#chartSection > .view-section-header` 자식 구조를 다음으로 재작성:
  - `.vsh-row.vsh-row--title`: 기존 `.chart-default-meta` (요청 추이 라벨 + 부제) + 우측에 `.chart-actions` (접기 버튼 등). `chart-detail-meta`도 Title row 안에 흡수 (default/detail 모드 가시성 토글).
  - `.vsh-row.vsh-row--hero header-stats`: Hero chip 2개 (활성 / 오류율). 값 → 라벨 순서. `.header-stats` 클래스 합성으로 SSoT 유지.
  - `.vsh-row.vsh-row--secondary header-stats`: Secondary chip 5개 (평균 / P95 / 세션 / 요청 / 토큰). 값 → 라벨 순서.
- [x] 기존 폐기 DOM 제거: `.header-stat-group*`(Hero/Performance/Volume) 모두, `.header-stat-divider` 2개 모두 제거
- [x] 유지: `.header-stat`, `.header-stat--hero`(Hero 2개에만), `.header-stat-value`, `.header-stat-label`, DOM ID(`statActive` / `stat-error-rate` / `statAvgDuration` / `stat-p95` / `statSessions` / `statRequests` / `statTokens`), `data-stat-tooltip`, `#activeCard`
- [x] 라벨/값 순서 swap: `<span class="header-stat-value">…</span><span class="header-stat-label">…</span>`
- [x] role/aria-label 보강: `.vsh-row--hero[role="group"][aria-label="핵심 지표"]`, `.vsh-row--secondary[role="group"][aria-label="세부 지표"]`
- [x] `view-section-header--vsh` modifier 클래스 추가로 column flex 모드 활성화 (`.view-section-header--vsh { flex-direction: column }`)

**검증**: 페이지 로드 시 7개 chip 모두 표시. 값이 라벨보다 먼저 표시. 콘솔 에러 0.
**커밋 메시지**: `feat(web): view-section-header 2단 위계 재구성 (ADR-006)`

---

### T13 — `default-view.css` `#chartSection .header-stat*` 영역 재작성 (ADR-006)

- [x] 폐기 정의 제거: `#chartSection .header-stat-group`, `--hero`(그라디언트 포함), `.header-stat-divider`
- [x] 신규 행 컨테이너 정의 추가:
  - `#chartSection .view-section-header--vsh { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0 }`
  - `.vsh-row` 공통 (display: flex; align-items: center; gap: var(--space-3); min-width: 0)
  - `.vsh-row--title` (justify-content: space-between, chart-actions margin-left:auto)
  - `.vsh-row--hero` (gap: var(--space-6); padding-top: var(--space-1); flex-wrap: wrap)
  - `.vsh-row--secondary` (gap: var(--space-4); padding-top: var(--space-2); margin-top: var(--space-1); border-top: 1px solid var(--border); flex-wrap: wrap)
- [x] chip 단위 column flex 전환:
  - `#chartSection .header-stat { display: inline-flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 2px var(--space-2); position: relative; white-space: nowrap; border-radius: var(--radius-sm); }`
  - 자식 순서: `.header-stat-value`(상단) → `.header-stat-label`(하단)
- [x] Hero 변형 갱신:
  - `#chartSection .header-stat--hero { gap: var(--space-1); padding: var(--space-1) var(--space-2); }`
  - `#chartSection .header-stat--hero .header-stat-value { font-size: var(--font-hero); font-weight: var(--weight-hero); letter-spacing: -0.02em; line-height: 1; }`
  - `#chartSection .header-stat--hero .header-stat-label { font-size: var(--font-meta); letter-spacing: 0.05em; }`
- [x] Hero `.is-active-indicator` padding-left 조정 (22px) + dot 8px + 글로우 강화 (font-hero 폰트 크기에 맞춰 균형)
- [x] 상태 클래스 동등 동작 보장:
  - `.is-active-indicator::before { 6px green dot }` (Hero는 8px override)
  - `.is-error .header-stat-value { color: var(--red) }`
  - `.is-critical { background: linear-gradient(to right, var(--red-bg-subtle), transparent) }`
  - `.header-stat--hero.is-critical .header-stat-value { text-shadow: 0 0 12px rgba(239,68,68,0.3) }`
- [x] hover: `[data-stat-tooltip]:hover { background: var(--accent-bg-light) }` 유지
- [x] skeleton 자식 보정: 일반 chip 32×12px, Hero 48×22px
- [x] CSS 변수만 사용 (하드코딩 색상 0)
- [x] 신규 토큰 0

**검증**: Hero 폰트 24px, divider 0, 그룹 그라디언트 0, 상태 클래스 동등 동작.
**커밋 메시지**: `feat(web): view-section stats 2단 위계 CSS 재작성 (ADR-006)`

---

### T14 — 반응형 우선순위 노출 재조정 (ADR-006)

- [x] `default-view.css` 미디어쿼리 갱신:
  - `@media (max-width: 1024px)` — `chart-default-meta .panel-hint` 부제 숨김 + Hero gap → space-5 + Secondary gap → space-3 + chip padding → 2px space-1
  - `@media (max-width: 768px)` — Volume chip 3개 숨김 (`[data-stat-tooltip="sessions"|"requests"|"tokens"]`)
  - `@media (max-width: 480px)` — `.vsh-row--secondary { display: none }` (Hero만), Hero gap → space-4
- [x] 폐기된 미디어쿼리 정리:
  - `.header-stat-group--volume` 셀렉터 → `[data-stat-tooltip="sessions"|"requests"|"tokens"]`로 교체
  - `.header-stat-group--performance` 셀렉터 → 사용 안 함 (Performance는 480에서 secondary 전체 숨김으로 처리)
  - `.header-stat-divider:last-of-type` 등 divider 셀렉터 모두 제거

**검증**: 1024(부제), 768(Volume), 480(Secondary 전체) 폭에서 우선순위 노출 동작.
**커밋 메시지**: `feat(web): view-section stats 반응형 1024/768/480 재조정 (ADR-006)`

---

### T15 — detail 모드 가시성 처리 (ADR-006)

- [x] `default-view.css`:
  - 기존 `#chartSection.chart-mode-detail .header-stats { display: none }` 제거 (`.header-stats`는 vsh-row와 합성된 컨테이너로만 남음)
  - 신규 `#chartSection.chart-mode-detail .vsh-row--hero, .vsh-row--secondary { display: none }` 추가
- [x] Title row(`.vsh-row--title`)는 detail 모드에서도 노출 유지 — `chart-default-meta` hidden / `chart-detail-meta` 표시로 자연스러운 모드 전환 (기존 `.chart-mode-detail .chart-default-meta { display: none }` 패턴 그대로)

**검증**: 세션 detail 진입 시 Hero/Secondary 사라지고 세션 메타가 chart-detail-meta로 표시됨.
**커밋 메시지**: `feat(web): detail 모드에서 vsh-row Hero/Secondary 자동 숨김 (ADR-006)`

---

### T16 — screen-inventory.md / design-system.md Phase 3 현행화

- [x] `.claude/skills/ui-designer/references/web/screen-inventory.md`:
  - "최종 현행화"에 Phase 3 항목 추가 (2026-04-26 — 2단 위계 재설계, ADR-006)
  - 화면 1-1-H 섹션을 vsh-row 3행 구조 / 값→라벨 순서 / detail 모드 자동 숨김 / 반응형 1024-768-480으로 전면 갱신
  - 변경 이력 표에 Phase 3 행 추가
- [x] `.claude/skills/ui-designer/references/web/design-system.md`:
  - "View-Section Stats" 섹션 → "View-Section Stats (2단 위계 — header-summary-merge ADR-006)"로 갱신
  - 폐기: `.header-stat-group*`, `.header-stat-divider`
  - 신규: `.view-section-header--vsh`, `.vsh-row`, `.vsh-row--title`, `.vsh-row--hero`, `.vsh-row--secondary`
  - Hero 폰트: font-body → font-hero(24px) 변경 명시
  - 라벨/값 순서 swap (column flex) 명시
  - 반응형 브레이크포인트 코멘트 ADR-006 기준으로 갱신

**검증**: 문서가 현재 코드와 일치 (grep 정합성).
**커밋 메시지**: `docs(ui): screen-inventory / design-system Phase 3 현행화 (ADR-006)`

---

## Phase 3 의존 순서

```
T12 (HTML 재구성) ──> T13 (CSS 재작성) ──> T14 (반응형) ──> T15 (detail 모드) ──> T16 (문서)
```

T12부터 순차. T13~T15는 모두 default-view.css 수정이라 같은 작업 시점에 병행 가능하지만 검증 단계는 분리.

## Phase 3 완료 기준

- [x] 7개 stat 모두 표시 (정보 손실 0)
- [x] Hero font-hero(24px) 압도적 시각화
- [x] divider 0, 그룹 그라디언트 0
- [x] 값 → 라벨 순서로 swap 완료
- [x] 활성 dot / 오류율 색상 / critical 강조 동등 동작
- [x] stat-tooltip data 속성 호환 (api.js / stat-tooltip.js 무수정 — 셀렉터 grep 검증 완료)
- [x] detail 모드 자동 숨김 (Hero + Secondary 모두 사라짐, Title row만 유지)
- [x] 반응형 1024(부제) / 768(Volume 3 chip) / 480(Secondary 전체) 동작
- [x] screen-inventory.md / design-system.md 재현행화
- [x] CSS 변수만 사용 (신규 토큰 0)

> **Phase 3 사후 평가**: 위 체크리스트 모두 통과했으나 사용자가 "더 어지러워졌다"고 부정적 평가. ADR-006 자체가 틀림. Phase 4에서 분산 정책으로 재설계.

---

# Phase 4 Tasks (Stats Distribution to Natural Habitat — ADR-007)

ADR-007에 따라 7개 stat을 자기 의미와 가까운 영역으로 분산. ADR-006의 vsh-row* 모두 폐기.

## Phase 4 Tasks

### T17 — index.html 재구조화 (ADR-007)

- [ ] `view-section-header` 비우기:
  - vsh-row* 3행 구조 모두 제거 → 단일 flex row 복귀
  - 자식: `.chart-default-meta`(라벨+부제) + `.chart-detail-meta`(세션 메타, hidden) + `.chart-actions`
  - `view-section-header--vsh` modifier 제거
- [ ] LIVE 배지 통합 (`.badge-live`):
  - 기존 단순 텍스트 → `<span class="live-dot"></span>` + `<span class="badge-live-label">LIVE</span>` + `<span class="header-stat" id="activeCard" data-stat-tooltip="active"><span class="header-stat-value" id="statActive">--</span></span>`
- [ ] timeline-meta row 추가 (chart-wrap 안 canvas 위):
  - `<div class="timeline-meta" id="timelineMeta">` 안에 평균 / P95 / 오류율 chip 3개 (값 → 라벨)
- [ ] cache-panel-overall에 cps-volume row 추가:
  - `.cache-panel-overall`을 column flex로 전환
  - `<div class="cps-volume">`: `오늘` 라벨 + 세션/요청/토큰 chip 3개
  - 기존 3 cache-section을 `<div class="cps-cache">` wrapper로 감쌈
- [ ] DOM ID 8종 보존 grep 검증 (`statActive` / `stat-error-rate` / `statAvgDuration` / `stat-p95` / `statSessions` / `statRequests` / `statTokens` / `activeCard`)

**검증**: 7개 chip 분산 확인, 콘솔 에러 0, JS 무수정 동작.
**커밋 메시지**: `feat(web): stats를 자연스러운 거처로 분산 (ADR-007)`

---

### T18 — default-view.css 정리 (vsh-row* 모두 제거 + timeline-meta 정의 추가)

- [ ] 폐기 정의 모두 제거: `view-section-header--vsh`, `.vsh-row*` (4개)
- [ ] header-stat 정의 단순화 (단일 위계로 복귀):
  - `display: inline-flex; align-items: baseline; gap: var(--space-1); padding: 0; background: transparent`
  - `.header-stat--hero` 정의 모두 제거
  - column flex / Hero 폰트 변형 모두 제거
- [ ] timeline-meta 정의 추가:
  - `.chart-wrap { display: flex; flex-direction: column; gap: var(--space-1) }`
  - `.timeline-meta { display: flex; align-items: baseline; gap: var(--space-3); padding: 0 var(--space-2); flex-shrink: 0 }`
  - chip hover · 상태 클래스(is-error / is-critical) 동등 처리
  - `#chartSection.chart-mode-detail .timeline-meta { display: none }`
- [ ] view-section-header 단순 flex 복귀:
  - `display: flex; align-items: center; gap: var(--space-3); justify-content: space-between`
- [ ] vsh-row 미디어쿼리 모두 제거. 신규 1024/768 미디어쿼리는 timeline-meta gap 축소만.

**검증**: vsh-row* / `.header-stat--hero` grep 0, timeline 위 meta 한 줄 정상.
**커밋 메시지**: `refactor(web): vsh-row* 폐기 + timeline-meta 신설 (ADR-007)`

---

### T19 — header.css에 LIVE 배지 chip 통합 (ADR-007)

- [ ] `.badge-live` 자식 처리:
  - `.badge-live { display: inline-flex; align-items: center; gap: var(--space-2) }` 형태 유지/조정
  - `.badge-live-label { color: var(--accent); font-weight: var(--weight-strong) }`
  - `.badge-live .header-stat { padding: 0 0 0 var(--space-2); border-left: 1px solid var(--accent-border); display: inline-flex; align-items: baseline; gap: 2px }`
  - `.badge-live .header-stat-value { font-size: var(--font-meta); color: var(--accent); font-weight: var(--weight-strong); font-variant-numeric: tabular-nums }`
  - `.badge-live .header-stat::before { display: none !important }` (live-dot 충돌 방지)
- [ ] 활성 상태 토글:
  - `.badge-live .header-stat.is-active-indicator .header-stat-value { color: var(--green) }`
- [ ] OFFLINE 상태 정합 유지

**검증**: LIVE 배지에 활성 세션 숫자 표시. 활성>0 시 chip 값 green.
**커밋 메시지**: `feat(web): LIVE 배지에 활성 세션 chip 통합 (ADR-007)`

---

### T20 — cache-panel.css에 cps-volume + cps-cache wrapper (ADR-007)

- [ ] `.cache-panel-overall` 레이아웃 전환:
  - `display: flex; flex-direction: column; gap: 0` (Volume 위 / cache 아래)
- [ ] `.cps-volume` 정의:
  - `display: flex; align-items: baseline; gap: var(--space-3); padding: var(--space-2) var(--space-4); border-bottom: 1px solid var(--border); flex-wrap: wrap`
  - `.cps-volume-label { font-size: var(--font-micro); color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; font-weight: var(--weight-strong); flex-shrink: 0 }`
  - `.cps-volume .header-stat`, `.header-stat-value`, `.header-stat-label` chip 스타일
  - hover: `.cps-volume .header-stat[data-stat-tooltip]:hover { background: var(--accent-bg-light); border-radius: var(--radius-sm); padding: 0 var(--space-1) }`
- [ ] `.cps-cache` wrapper 정의:
  - `display: flex; align-items: stretch; gap: 0; min-height: 52px; flex: 1`
  - 기존 `.cache-section + .cache-section { border-left }`이 자식 cache-section에 그대로 적용
- [ ] 반응형: 768 gap 축소, 480 flex-wrap 자연 처리

**검증**: cache-panel 상단에 Volume row 표시. 하단에 기존 3 cache-section 그대로.
**커밋 메시지**: `feat(web): cache-panel-overall을 'Today Summary'로 격상 + cps-volume row 추가 (ADR-007)`

---

### T21 — detail 모드 + 반응형 일관 정리 (ADR-007)

- [ ] detail 모드 가시성:
  - `#chartSection.chart-mode-detail .timeline-meta { display: none }`
  - `.cps-volume`은 detail 모드에서도 표시 유지 (전역 'Today' 정보 의미)
- [ ] 폐기 미디어쿼리(vsh-row*) 모두 제거
- [ ] 반응형 1024/768/480 timeline-meta + cps-volume + badge-live 정합

**검증**: detail 진입 시 timeline-meta 숨김, cps-volume 유지, view-section-header 단순.
**커밋 메시지**: `feat(web): detail 모드 + 반응형 ADR-007 정합화`

---

### T22 — screen-inventory.md / design-system.md Phase 4 현행화 (ADR-007)

- [ ] `screen-inventory.md`:
  - "최종 현행화" Phase 4 항목 추가 (2026-04-26 ADR-007)
  - "화면 0 헤더" `.badge-live` 활성 세션 chip 통합 명세 추가
  - "화면 1-1-H" 전면 재작성: vsh-row* 폐기, view-section-header 단순화, timeline-meta 신설, 7 stat 분배 매핑
  - "화면 1-1 cache-panel" 'Today Summary' 격상 + cps-volume + cps-cache 명세
  - 변경 이력 표 Phase 4 행 추가
- [ ] `design-system.md`:
  - "View-Section Stats" → "Stats Distribution (ADR-007)" 개명 + 7 거처 매핑 표
  - 폐기: `.view-section-header--vsh`, `.vsh-row*`, `.header-stat--hero`
  - 신규: `.timeline-meta`, `.cps-volume`, `.cps-volume-label`, `.cps-cache`, `.badge-live .header-stat`
  - 반응형 코멘트 ADR-007 기준 갱신

**검증**: 문서가 현재 코드와 일치.
**커밋 메시지**: `docs(ui): screen-inventory / design-system Phase 4 현행화 (ADR-007)`

---

## Phase 4 의존 순서

```
T17 (HTML 재구조화) ──┬──> T18 (default-view.css)
                      ├──> T19 (header.css LIVE)
                      └──> T20 (cache-panel.css cps-volume) ──> T21 (detail+반응형) ──> T22 (문서)
```

T18~T20은 병행 가능, T21은 통합 검증.

## Phase 4 완료 기준

- [x] view-section-header가 "요청 추이" + 부제 + chart-actions만 보유
- [x] vsh-row* / `.view-section-header--vsh` / `.header-stat--hero` 0건 (grep — 코멘트 외 셀렉터 정의 0)
- [x] 활성 세션이 `.badge-live`에 통합 (`●LIVE 5` Playwright 검증)
- [x] 오류율 / 평균 / P95가 timeline-meta 표시 (`2.2s 평균  1.1s P95  1.1% 오류율`)
- [x] 세션 / 요청 / 토큰이 cps-volume 표시 (`오늘  12 세션  2,112 요청  3.4M 토큰`)
- [x] 7개 stat 정보 손실 0
- [x] DOM ID 8종 + `data-stat-tooltip` 보존 (api.js / stat-tooltip.js 무수정 — closest 셀렉터 그대로 동작)
- [x] 상태 클래스 동등 동작 (오류율 1.1% → critical 빨간 outline + 빨간 텍스트 시각 확인)
- [x] detail 모드 자동 처리 (timeline-meta `display: none`, cps-volume 유지, chart-default-meta 숨김 + chart-detail-meta 표시)
- [x] 반응형 1024/768/480 모두 정상 동작
- [x] 신규 디자인 토큰 0
- [x] screen-inventory / design-system 재현행화

> **추가 보강**: ADR-007 적용 후 LIVE 배지 chip 보존 호환성 위해 infra.js에 `setLiveStatus(connected)` helper 추가. api.js / infra.js의 `showError`/`clearError`가 이전엔 `liveBadge.innerHTML = '<span class="dot"></span>OFFLINE'`로 chip을 통째로 날렸는데, helper를 통해 클래스 토글 + `.badge-live-label` 텍스트만 갱신하도록 캡슐화. chip(`#statActive` / `#activeCard`) DOM이 보존되어 fetchDashboard 재호출 시 null 참조 에러 해소.

---

# Phase 5 Tasks (Cleanup & Consolidation — ADR-008)

ADR-008에 따라 사용자 요청 4종 정리.

## Phase 5 Tasks

### T23 — cache-mode-toggle / cache-panel-matrix 완전 제거

- [x] `index.html`: `<div class="cache-mode-toggle">` 블록 + `<div class="cache-panel-matrix">` 블록 모두 제거
- [x] `default-view.css`: `.cache-mode-toggle`, `.cache-mode-btn`, `:hover`, `.active`, `.cache-panel-matrix`, `.cache-matrix-row/name/bar*/rate` 정의 제거
- [x] `cache-panel.css`: `.cache-panel-matrix[hidden]` 제거
- [x] `main.js`: `fetchCacheMatrix` import / `_cacheMatrixCache` / `initCacheModeToggle()` 정의·호출 / `renderCacheMatrix()` 정의 모두 제거
- [x] `metrics-api.js`: `fetchCacheMatrix` 함수 정의 제거
- [x] grep 검증: `cache-mode|cache-matrix|cachePanelMatrix|fetchCacheMatrix|renderCacheMatrix|initCacheModeToggle` 0 hit (주석만 잔존)

**커밋**: `refactor(web): cache-mode-toggle / cache-panel-matrix 완전 제거 (ADR-008)`

---

### T24 — donut-mode-toggle 제거 + chart.js 모드 자동화

- [x] `index.html`: `<div class="donut-mode-toggle">` 블록 제거
- [x] `default-view.css`: `.donut-mode-toggle`, `.donut-mode-btn`, `:hover`, `.active` 제거
- [x] `chart.js`: `donutMode` 초기값을 `'model'`로 변경
- [x] `main.js`:
  - `initDonutModeToggle()` 정의·호출 제거
  - `setChartMode(mode)` 보강: `default` → `setDonutMode('model')` + (캐시 미스 시) `fetchModelUsage` + `setSourceData('model', data)`. `detail` → `setDonutMode('type')`.

**커밋**: `refactor(web): donut-mode-toggle 제거 + setChartMode가 모드 자동 결정 (ADR-008)`

---

### T25 — btn-close / detail-actions-sep 제거

- [x] `index.html`: `<span class="detail-actions-sep">` + `<button class="btn-close" id="btnCloseDetail">` 제거
- [x] `detail-view.css`: `.detail-actions-sep`, `.btn-close`, `:hover`, `svg` 제거
- [x] `main.js`: `btnCloseDetail` click handler 등록 1줄 제거. `closeDetail()` 함수는 유지 (Esc / 로고)
- [x] grep 검증: `btnCloseDetail|btn-close|detail-actions-sep` 0 hit (주석만 잔존)

**커밋**: `refactor(web): chart-section btn-close 제거 — Esc/로고 트리거로 충분 (ADR-008)`

---

### T26 — cps-volume → timeline-meta 통합 + 그룹 재배치

- [x] `index.html`:
  - `<div class="cps-volume">` 블록 제거 (cache-panel-overall 안)
  - `<div class="timeline-meta">`을 두 개의 `<div class="timeline-meta-group">`로 재구성:
    - 그룹 1: `[지난 30분]` 라벨 + 평균/P95/오류율 chip 3개
    - 그룹 2: `[오늘]` 라벨 + 세션/요청/토큰 chip 3개
- [x] `default-view.css`:
  - `.timeline-meta`: `justify-content: space-between; flex-wrap: wrap`
  - `.timeline-meta-group`: `display: flex; align-items: baseline; gap: var(--space-3); flex-wrap: wrap` 신규
  - `.timeline-meta-group-label`: `font-size: var(--font-micro); color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; font-weight: var(--weight-strong); flex-shrink: 0` 신규
- [x] `cache-panel.css`: `.cps-volume`, `.cps-volume-label` 정의 제거
- [x] DOM ID `statSessions`/`statRequests`/`statTokens` + data-stat-tooltip `sessions`/`requests`/`tokens` 보존

**커밋**: `feat(web): cps-volume을 timeline-meta로 통합 — 시간 컨텍스트 그룹 재배치 (ADR-008)`

---

### T27 — cache-panel-overall 단순화

- [x] `index.html`: `<div class="cps-cache">` wrapper 제거. cache-section 3개를 cache-panel-overall 직접 자식으로 복귀
- [x] `cache-panel.css`:
  - `.cache-panel-overall`을 `display: flex; flex-direction: column`에서 horizontal flex로 복귀 (ADR-007 이전 상태)
  - `.cps-cache` 정의 제거
  - 'Today Summary' 격상 코멘트 제거

**커밋**: `refactor(web): cache-panel-overall 'Today Summary' 격상 폐기 (ADR-008)`

---

### T28 — screen-inventory.md / design-system.md Phase 5 현행화

- [x] `screen-inventory.md`:
  - 최종 현행화에 Phase 5 섹션 추가 (ADR-008)
  - 화면 1-1-H 갱신: 6개 stat이 timeline-meta 두 그룹(지난 30분/오늘), btn-close 제거, donut MODEL 단일
  - 화면 1-1 cache-panel: 'Today Summary' 격상 폐기 + cache-mode-toggle 제거
  - 변경 이력 표 Phase 5 행 추가
  - 화면 2-0 상세 헤더: btn-close / detail-actions-sep 폐기 표기
- [x] `design-system.md`:
  - "Stats Distribution" 매핑 표 갱신 (ADR-008)
  - "Mode Toggle" 섹션 cache/donut toggle 폐기 명시 (Donut Mode SSoT 섹션 ADR-008 추가)
  - 신규: `.timeline-meta-group`, `.timeline-meta-group-label`
  - 폐기: `.cps-volume*`, `.cps-cache`, `.cache-mode-toggle/btn`, `.cache-panel-matrix`, `.cache-matrix-*`, `.donut-mode-toggle/btn`, `.btn-close`, `.detail-actions-sep`

**커밋**: `docs(ui): screen-inventory / design-system Phase 5 현행화 (ADR-008)`

---

## Phase 5 의존 순서

```
T23, T24, T25 (병행 가능, 독립적)  ──> T26 (cps-volume → timeline-meta) ──> T27 (cache-panel 단순화) ──> T28 (문서)
```

## Phase 5 완료 기준

- [x] cache-mode-toggle / cache-panel-matrix DOM·CSS·JS 0건 (주석만 잔존)
- [x] donut-mode-toggle DOM·CSS·JS 0건 (주석만 잔존)
- [x] btn-close + detail-actions-sep DOM·CSS·click handler 0건 (주석만 잔존)
- [x] cps-volume + cps-volume-label + cps-cache DOM·CSS 0건 (주석만 잔존)
- [x] fetchCacheMatrix / renderCacheMatrix / initCacheModeToggle / initDonutModeToggle 호출 0건
- [x] timeline-meta에 6개 chip + 2개 그룹 라벨
- [x] DOM ID 8종 + data-stat-tooltip 보존 (api.js / stat-tooltip.js 무수정)
- [x] default 모드 도넛 MODEL 분포
- [x] detail 모드 도넛 TYPE 분포
- [x] closeDetail 함수 유지 (Esc / 로고)
- [x] cache-panel-overall은 cache 효율 단일 책임 (horizontal 3 cache-section)
- [x] 반응형 1024/768/480 timeline-meta wrap graceful
- [x] 신규 디자인 토큰 0
- [x] screen-inventory / design-system 재현행화
