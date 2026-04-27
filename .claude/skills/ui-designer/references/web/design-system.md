# Design System — Web 대시보드

> 공통 토큰: `../common/design-tokens.md` 참조

---

## CSS 변수 전체 (packages/web/assets/css/design-tokens.css)

```css
:root {
  /* 강조 */
  --accent:            #d97757;
  --accent-dim:        rgba(217,119,87,0.1);   /* 선택 행 배경 */
  --accent-bg-light:   rgba(217,119,87,0.04);  /* 일반 행 hover, 확장 패널 */
  --accent-bg-medium:  rgba(217,119,87,0.07);  /* clickable 행 hover */

  /* 배경 레이어 (깊이 순) */
  --bg:           #0f0f0f;   /* 최하층 */
  --surface:      #161616;   /* 패널 */
  --surface-alt:  #1c1c1c;   /* 헤더/푸터 */
  --border:       #272727;

  /* 역할 배지 배경 */
  --blue-bg-light: rgba(96,165,250,0.18);   /* role/cache 배지 */
  --red-bg-light:  rgba(239,68,68,0.18);    /* error/slow 배지 */
  --yellow-bg-light: rgba(251,191,36,0.15); /* spike 배지 */
  --sky-bg-light: rgba(147,197,253,0.12);   /* loop 배지 */

  /* 뱃지 텍스트 색상 */
  --blue-text: #93c5fd;   /* role-user, cache 배지 */
  --red-text:  #f87171;   /* error, slow 배지 */
  --sky-text:  #7dd3fc;   /* loop 배지 */

  /* 강조색 계열 (alpha 변형) */
  --accent-border: rgba(217,119,87,0.35); /* border 강조 (LIVE 배지) */
  --red-dim:       rgba(239,68,68,0.1);   /* error subtle 배경 (disconnected) */
  --red-border:    rgba(239,68,68,0.35);  /* error border */
  --red-bg-subtle: rgba(239,68,68,0.08);  /* error 배너 배경 */

  /* 흰색 계열 (subtle 배경) */
  --white-bg-subtle: rgba(255,255,255,0.02);  /* 약한 강조 배경 */

  /* 기타 배지 */
  --unknown-bg: rgba(80,80,80,0.2);           /* type-unknown 배지 */
  --model-badge-bg: rgba(217,119,87,0.15);    /* model-badge 배경 */

  /* Border Radius */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;          /* Card container (ADR-003) */

  /* Spacing Scale (ADR-002 — 8px Grid) */
  --space-1:   4px;          /* 인라인 미세 (배지 padding) */
  --space-2:   8px;          /* 기본 단위 */
  --space-3:  12px;          /* 행 간격 */
  --space-4:  16px;          /* 섹션 내부 padding */
  --space-5:  24px;          /* 섹션 간 간격 */
  --space-6:  32px;          /* 카드 간 간격 */

  /* Typography Scale (ADR-001/004 — 3-Tier Hierarchy) */
  --font-hero:   24px;       /* Primary 메트릭 (Hero 카드 활성/오류율 등) */
  --font-major:  18px;       /* 카드 헤드라인 / 섹션 라벨 강조 */
  --font-body:   13px;       /* 본문 (테이블 셀, 카드 내용) */
  --font-meta:   11px;       /* 미리보기, 힌트, 사이드 정보 */
  --font-micro:   9px;       /* 컬럼 헤더, 초소형 라벨 */

  --weight-hero:   700;      /* Primary 강조 */
  --weight-strong: 600;      /* Secondary 강조 */
  --weight-normal: 400;      /* 본문 */

  /* Card surface 변형 (ADR-003) */
  --card-bg:        var(--surface);
  --card-border:    var(--border);
  --card-shadow:    0 1px 3px rgba(0,0,0,0.2);

  /* 텍스트 위계 */
  --text:         #e8e8e8;
  --text-muted:   #888;
  --text-dim:     #505050;

  /* 상태 색상 */
  --green:        #4ade80;
  --orange:       #f59e0b;
  --red:          #ef4444;
  --blue:         #60a5fa;
  --purple:       #a78bfa;   /* Gantt/카드뷰 보라 (Task — --blue 통일 검토 중) */
  --pink:         #f472b6;   /* WebSearch/WebFetch 전용 */

  /* 타입 색상 (ADR-003 SSoT) */
  --type-prompt-color:    #e8a07a;
  --type-tool_call-color: #6ee7a0;
  --type-system-color:    #fbbf24;

  /* 레이아웃 */
  --left-panel-width:     280px;
  --tool-stats-height:    160px;
  --project-panel-height: 215px;
}
```

---

## 레이아웃 그리드

### 전체 body

```
grid-template-rows: 52px 1px 1fr 20px
← header (글로벌 네비) | error-banner | main | footer
```

> header-summary-merge:
> - Phase 1 (ADR-001): `.summary-strip` 행 제거 → `.header` 내부 `.header-stats` chip 그룹으로 통합
> - Phase 2 (ADR-004): `.header-stats`를 `#chartSection .view-section-header`로 이전. 헤더는 `[로고+LIVE | 날짜필터+갱신]` 단순 복귀.

### main-layout

```
grid-template-columns: 280px 1fr
← left-panel | right-panel
```

### left-panel

```
grid-template-rows: 215px 1fr 160px
← projects | sessions | tool-stats
```

### 반응형 브레이크포인트 (ADR-008 — Stats Distribution 기준)

```css
@media (max-width: 1024px) { /* chart-default-meta 부제 숨김 + .timeline-meta-group gap 축소 */ }
@media (max-width: 768px)  { /* 2컬럼 → 세로 재배치, .timeline-meta gap 축소(두 그룹 자연 wrap), .last-updated 숨김 */ }
@media (max-width: 480px)  { /* .timeline-meta padding 0(좁은 폭 wrap graceful), .badge-live 노출 유지(chip 핵심), .badge-live-label 숨김 */ }
```

---

## 타이포그래피

```css
font-family: 'SF Mono', 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
```

| 용도 | 크기 | 굵기 | 색상 |
|------|------|------|------|
| 로고 | 16px | 800 | `--text` |
| 본문 | 13px | 400 | `--text` |
| 서브텍스트 | 12px | 400 | `--text` |
| 미리보기/힌트 | 11px | 400 | `--text-muted` |
| 배지/라벨 | 10px | 600–700 | 타입별 |
| 초소형 | 9px | 600 | `--text-dim` |

---

## 컴포넌트 스펙

### 섹션 라벨

```css
.section-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-dim);
  padding: 6px 12px 4px;
}
```

### 타입 배지

```html
<span class="type-badge type-prompt">P</span>
```

```css
.type-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
}
.type-prompt    { color: #e8a07a; background: rgba(217,119,87,0.18); }
.type-tool_call { color: #6ee7a0; background: rgba(74,222,128,0.15); }
.type-system    { color: #fbbf24; background: rgba(245,158,11,0.15); }
```

### 테이블

```css
th { font-size: 10px; color: var(--text-dim); text-transform: uppercase; padding: 4px 8px; }
td { font-size: 12px; padding: 4px 8px; border-bottom: 1px solid var(--border); }
tr:hover td          { background: var(--accent-bg-light); }   /* 일반 행 */
tr.clickable:hover td { background: var(--accent-bg-medium); } /* 클릭 가능 행 */
tr.selected { border-left: 2px solid var(--accent); }
```

#### 행 타입 구분 (ADR-006)

```css
tr[data-type="prompt"]    td:first-child { border-left: 2px solid var(--type-prompt-color); }
tr[data-type="tool_call"] td:first-child { border-left: 2px solid var(--type-tool_call-color); }
tr[data-type="system"]    td:first-child { border-left: 2px solid var(--type-system-color); }
```

### 프로그레스 바

```
[████████░░░░░░░░░░] 45.2K / 100K
```

```css
.progress-fill  { background: var(--accent); transition: width 0.4s ease; }
.progress-track { background: var(--border); }
```

### LIVE 인디케이터

```css
.live-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--green);
  animation: pulse 1.8s ease-in-out infinite;
}
```

### 스켈레톤 로딩

```css
@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position:  200% 0; }
}
.skeleton {
  background: linear-gradient(90deg, var(--surface) 25%, var(--surface-alt) 50%, var(--surface) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
  border-radius: 3px;
}
```

### 확장 패널

```css
.prompt-expand-box {
  background: var(--accent-bg-light);   /* rgba(217,119,87,0.04) */
  border-left: 2px solid var(--accent);
  padding: 8px 16px;
  font-size: 11px;
  line-height: 1.7;
}
```

---

## 컴포넌트 — Card (ADR-003)

### Card SSoT

```html
<div class="card">
  <div class="card-header">
    <span class="card-title">제목</span>
    <span class="card-subtitle">부제</span>
    <div class="card-actions"><!-- 우측 액션 --></div>
  </div>
  <div class="card-body card-body--scroll card-body--padded">...</div>
  <div class="card-footer">메타 정보</div>
</div>
```

```css
.card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: var(--radius-lg); }
.card-header   { padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--card-border); }
.card-body--padded { padding: var(--space-3) var(--space-4); }
.card--hero    { border-color: var(--accent-border); }    /* 강조 카드 */
.card--compact { /* 패딩 축소 */ }
```

**적용처**: `#chartSection`(card+compact), `#defaultView .view-section.fill`, `#detailView`

## 컴포넌트 — State SSoT (ADR-009)

빈/로딩/에러 상태 통일. 텍스트 한국어 일관: "데이터가 없습니다" / "불러오는 중…" / "로드 실패 — 다시 시도".

```html
<div class="state-empty">
  <span class="state-empty-title">데이터가 없습니다</span>
</div>

<div class="state-loading">
  <div class="state-loading-spinner"></div>
  <span>불러오는 중…</span>
</div>

<div class="state-error">
  <div class="state-error-message">데이터를 불러올 수 없습니다</div>
  <button class="state-error-retry">다시 시도</button>
</div>
```

## 컴포넌트 — Keyboard Help Modal (ADR-012)

```html
<div class="kbd-help-backdrop" id="kbdHelpBackdrop" role="dialog">
  <div class="kbd-help-modal">
    <div class="kbd-help-header">...</div>
    <div class="kbd-help-body">
      <div class="kbd-help-row">
        <span class="kbd-key">/</span>
        <span class="kbd-help-desc">검색창에 포커스</span>
      </div>
    </div>
  </div>
</div>
```

활성화: `.visible` 클래스 토글. JS API: `toggleKbdHelp()` / `showKbdHelp()` / `hideKbdHelp()` (main.js).

## 컴포넌트 — Type Filter Grouping (ADR-006)

```html
<div class="type-filter-btns">
  <div class="filter-group filter-group--all">
    <button class="type-filter-btn active" data-filter="all">All</button>
  </div>
  <div class="filter-group filter-group--request">
    <button class="type-filter-btn type-filter-prompt" data-filter="prompt">prompt</button>
    <button class="type-filter-btn type-filter-system" data-filter="system">system</button>
  </div>
  <div class="filter-group filter-group--tool">
    <button class="type-filter-btn type-filter-tool_call" data-filter="tool_call">tool_call</button>
    <button class="type-filter-btn type-filter-agent" data-filter="agent">Agent</button>
    <button class="type-filter-btn type-filter-skill" data-filter="skill">Skill</button>
    <button class="type-filter-btn type-filter-mcp" data-filter="mcp">MCP</button>
  </div>
</div>
```

그룹 사이 `border-left: 1px solid var(--border)` 시각 분리.

## 컴포넌트 — Tools Matrix (ADR-007)

세션 상세 도구 탭. 1행 1도구, 6컬럼 grid (Tool / Avg / Calls / Tokens / 기여도% / Err).

```css
.ts-mx-row { display: grid; grid-template-columns: 1.4fr 1fr 0.8fr 0.9fr 1fr 0.6fr; gap: var(--space-3); }
.ts-mx-bar-fill--avg    { background: var(--orange); }
.ts-mx-bar-fill--calls  { background: var(--green); }
.ts-mx-bar-fill--tokens { background: var(--accent); }
```

JS: `tool-stats.js` — `loadToolStats(sessionId)` / `clearToolStats()` / 정렬 토글 3종 (`avg/calls/tokens`).

## 키보드 단축키 (ADR-012, 1차)

| 키 | 동작 |
|----|------|
| `?` | 도움말 모달 토글 |
| `Esc` | 모달 → 확장 패널 → 검색 클리어 → detail 닫기 (우선순위 순) |
| `/` | 현재 active 뷰의 검색창 포커스 |
| `Cmd/Ctrl+F` | 검색창 포커스 (브라우저 기본 가로채기) |
| `1~7` | 현재 active 뷰의 타입 필터 (그룹 순서) |

## localStorage 키 (ADR-014)

모두 `spyglass:` prefix 강제. 마이그레이션 자동 (init 시 1회).

| 키 | 역할 |
|----|------|
| `spyglass:lastProject` | 마지막 선택 프로젝트 |
| `spyglass:panel-width` | 좌측 패널 너비 |
| `spyglass:chart-collapsed` | 차트 영역 접힘 |
| `spyglass:left-panel-hidden` | 좌측 패널 숨김 |
| `spyglass:left-panel-state` | 섹션별 접힘 JSON |

## 컴포넌트 — Mode Toggle (ADR-016)

세그먼트 토글 (작은 라디오 버튼 그룹). 도넛 / cache panel / tool 통계에 일관 사용.

```html
<div class="<feature>-mode-toggle" role="group" aria-label="...">
  <button class="<feature>-mode-btn active" data-<feature>-mode="A">A</button>
  <button class="<feature>-mode-btn" data-<feature>-mode="B">B</button>
</div>
```

공통 스타일: surface-alt 배경 + radius-sm + 2px padding. 활성 시 accent-dim 배경 + accent 텍스트.

> header-summary-merge ADR-002: Insights 카드 제거에 따라 insights range toggle은 폐기됨.

## 컴포넌트 — Stats Distribution (header-summary-merge ADR-008 — ADR-007 partial supersede)

> ADR-007 적용 후 사용자 4종 정리 요청: "필요 없는 것 모두 제거하고 시각을 더 정돈". cps-volume의 cache-panel 격상이 cache-panel 정체성을 흐려뜨린다는 자기비판 → cps-volume을 timeline-meta로 통합하여 시간 컨텍스트 두 그룹(지난 30분 / 오늘)으로 재배치.
> ADR-008 폐기: `.cps-volume`, `.cps-volume-label`, `.cps-cache`, `.cache-mode-toggle`, `.cache-mode-btn`, `.cache-panel-matrix`, `.cache-matrix-row/name/bar*/rate`, `.donut-mode-toggle`, `.donut-mode-btn`, `.btn-close`, `.detail-actions-sep`
> ADR-007 폐기 (이전 단계): `.view-section-header--vsh`, `.vsh-row*`, `.header-stat--hero`, `.header-stat-group*`, `.header-stat-divider`
> 유지: `.header-stat*` 시각 클래스 SSoT — api.js / stat-tooltip.js / chart.js 무수정.

view-section-header는 단일 flex row(가벼움 회복) — `[.chart-default-meta] | [.chart-detail-meta] | [.chart-actions]`. stats 0개. chart-actions에는 접기 토글(`btnToggleChart`)만 유지.

6개 stat은 시간 컨텍스트 기준 2 거처로 분산 (활성 세션은 글로벌 LIVE 배지, ADR-007부터 유지).

### 6개 stat 거처 매핑 (ADR-008)

| stat | DOM ID | 거처 | 거처 클래스 | 시간 컨텍스트 |
|------|--------|------|-------------|----------------|
| 활성 세션 | `statActive` (`#activeCard`) | 글로벌 헤더 LIVE 배지 | `.badge-live .header-stat` | 실시간 (NOW) |
| 평균 응답 | `statAvgDuration` | timeline 영역 (지난 30분) | `.timeline-meta-group .header-stat` | 지난 30분 |
| P95 | `stat-p95` | timeline 영역 (지난 30분) | `.timeline-meta-group .header-stat` | 지난 30분 |
| 오류율 | `stat-error-rate` | timeline 영역 (지난 30분) | `.timeline-meta-group .header-stat` | 지난 30분 |
| 세션 수 | `statSessions` | timeline 영역 (오늘) | `.timeline-meta-group .header-stat` | 오늘 |
| 요청 수 | `statRequests` | timeline 영역 (오늘) | `.timeline-meta-group .header-stat` | 오늘 |
| 토큰 | `statTokens` | timeline 영역 (오늘) | `.timeline-meta-group .header-stat` | 오늘 |

### chip 단위 (어디 있든 동일)

- `.header-stat`: `inline-flex; align-items: baseline; gap: var(--space-1); padding: 0; background: transparent`
- 자식 순서: `.header-stat-value` (`font-meta`, weight-strong, tabular-nums) → `.header-stat-label` (`font-micro`, text-dim, uppercase)
- hover: `.header-stat[data-stat-tooltip]:hover { background: var(--accent-bg-light) }` (layout shift 없음 — padding 변경 없음)
- cursor: help

### 거처 ① — `.badge-live` 안 chip 통합 (header.css)

```html
<span class="badge-live" id="liveBadge">
  <span class="dot"></span>
  <span class="badge-live-label">LIVE</span>
  <span class="header-stat" id="activeCard" data-stat-tooltip="active">
    <span class="header-stat-value" id="statActive">7</span>
  </span>
</span>
```

- `.dot`: SSE 연결 상태(pulse 애니메이션) — `.live-dot`이 시각 dot 담당
- `.badge-live-label`: "LIVE" 텍스트
- `.header-stat`: 활성 세션 chip — `border-left: 1px solid var(--accent-border)`로 분리, `font-micro`, color accent
- chip의 `::before { display: none !important }` — `.live-dot`과 시각 충돌 방지
- 활성>0: chip value green (`.is-active-indicator`)
- disconnected: dot/border/value 모두 red

### 거처 ② — `.timeline-meta` (default-view.css, chart-wrap 안 — 6 chip 통합 두 그룹)

```html
<div class="chart-wrap">
  <div class="timeline-meta" id="timelineMeta" role="group" aria-label="요약 지표">
    <div class="timeline-meta-group" role="group" aria-label="요청 품질 (지난 30분)">
      <span class="timeline-meta-group-label">지난 30분</span>
      <div class="header-stat" data-stat-tooltip="avg-duration">
        <span class="header-stat-value" id="statAvgDuration">1.2s</span>
        <span class="header-stat-label">평균</span>
      </div>
      <div class="header-stat" data-stat-tooltip="p95">
        <span class="header-stat-value" id="stat-p95">3.4s</span>
        <span class="header-stat-label">P95</span>
      </div>
      <div class="header-stat" data-stat-tooltip="err">
        <span class="header-stat-value" id="stat-error-rate">0.5%</span>
        <span class="header-stat-label">오류율</span>
      </div>
    </div>
    <div class="timeline-meta-group" role="group" aria-label="누적 볼륨 (오늘)">
      <span class="timeline-meta-group-label">오늘</span>
      <div class="header-stat" data-stat-tooltip="sessions">
        <span class="header-stat-value" id="statSessions">142</span>
        <span class="header-stat-label">세션</span>
      </div>
      <div class="header-stat" data-stat-tooltip="requests">
        <span class="header-stat-value" id="statRequests">1.2k</span>
        <span class="header-stat-label">요청</span>
      </div>
      <div class="header-stat" data-stat-tooltip="tokens">
        <span class="header-stat-value" id="statTokens">8.4M</span>
        <span class="header-stat-label">토큰</span>
      </div>
    </div>
  </div>
  <canvas id="timelineChart" height="64"></canvas>
  ...
</div>
```

- `chart-wrap`: column flex (`display: flex; flex-direction: column; gap: var(--space-1); position: relative`)
- `timeline-meta`: `display: flex; justify-content: space-between; flex-wrap: wrap; gap: var(--space-4); padding: 0 var(--space-1)` — 두 그룹이 좌(품질) / 우(볼륨)로 분리
- `timeline-meta-group`: `display: flex; align-items: baseline; gap: var(--space-3); flex-wrap: wrap` — 그룹 내부 chip 정렬
- `timeline-meta-group-label`: `font-micro`, text-dim, uppercase, letter-spacing 0.5px, weight-strong, flex-shrink: 0 — "지난 30분" / "오늘" 라벨
- divider DOM 0 (그룹 라벨이 시각 구분 담당)
- detail 모드 자동 숨김 (`#chartSection.chart-mode-detail .timeline-meta { display: none }`) — chart 영역이 contextGrowthChart로 swap
- 좁은 폭에서 자연 wrap (graceful degradation: 품질 그룹 한 줄 / 볼륨 그룹 한 줄)

### 거처 ③ — `.cache-panel-overall` (cache-panel.css, cache 효율 단일 책임)

> ADR-008: ADR-007의 'Today Summary' 격상 폐기. cps-volume이 timeline-meta로 이동하면서 cache-panel-overall은 다시 horizontal flex 3 cache-section 병렬로 복귀 — `Hit Rate / Cost / Creation·Read` 단일 책임.

```html
<div class="cache-panel" id="cachePanel">
  <div class="cache-panel-overall" id="cachePanelOverall">
    <div class="cache-section" data-cache-panel-tooltip="hit-rate">...</div>
    <div class="cache-section" data-cache-panel-tooltip="cost">...</div>
    <div class="cache-section" data-cache-panel-tooltip="ratio">...</div>
  </div>
</div>
```

- `cache-panel-overall`: `display: flex; align-items: stretch; gap: 0; flex: 1; min-width: 0` (horizontal)
- `cache-section`: `flex: 1`, `cache-section + cache-section { border-left: 1px solid var(--border) }`
- cache-mode-toggle / cache-panel-matrix 폐기 — cache 모델별 비교는 다른 도구(Insights)에서 담당

### 상태 클래스 SSoT (chip이 어디 있든 동일 의미)

- `.is-active-indicator`
  - 일반 chip: `::before` 6px green dot, padding-left 처리
  - `.badge-live` 컨텍스트: `::before` 무력화, value color green만 적용
- `.is-error`: value `color: var(--red)`
- `.is-critical`: `outline: 1px solid var(--red-border); background: linear-gradient(to right, var(--red-bg-subtle), transparent)` (layout shift 없음)

### 반응형 (ADR-008)

| 브레이크포인트 | 동작 |
|---------------|------|
| `≤ 1024px` | `chart-default-meta .panel-hint` 숨김 + `.timeline-meta-group` gap 축소 |
| `≤ 768px` | `.timeline-meta` gap 축소 (두 그룹 wrap 자연 처리) + last-updated 숨김 |
| `≤ 480px` | `.timeline-meta` padding 0 (좁은 폭에서도 wrap graceful) + `.badge-live` 노출 유지 (chip 핵심 정보) + `.badge-live-label` 숨김 |

### 폐기 컴포넌트 (ADR-008 — DOM/CSS/JS 0건 검증)

| 컴포넌트 | 도입 ADR | 폐기 사유 |
|----------|----------|-----------|
| `.cps-volume`, `.cps-volume-label` | ADR-007 | timeline-meta로 통합 → 시간 컨텍스트 그룹 재배치 |
| `.cps-cache` | ADR-007 | cache-panel-overall 'Today Summary' 격상 폐기 → horizontal flex 복귀 |
| `.cache-mode-toggle`, `.cache-mode-btn` | (이전) | cache-panel-matrix 폐기로 동반 폐기 |
| `.cache-panel-matrix`, `.cache-matrix-row/name/bar*/rate` | (이전) | cache 모델별 비교는 다른 도구로 이전 |
| `.donut-mode-toggle`, `.donut-mode-btn` | (이전) | setChartMode가 default→model / detail→type 자동 결정 |
| `.btn-close`, `.detail-actions-sep` | (이전) | Esc 키 / 로고 클릭으로 충분 |
| `.view-section-header--vsh`, `.vsh-row*`, `.header-stat--hero`, `.header-stat-group*`, `.header-stat-divider` | ADR-006 | ADR-007에서 stats 분산 정책으로 폐기 (이전 단계) |

폐기 동반 함수: `fetchCacheMatrix`, `renderCacheMatrix`, `initCacheModeToggle`, `initDonutModeToggle`, `_cacheMatrixCache`, `btnCloseDetail` click handler 등록.
서버 endpoint `/api/metrics/cache-matrix`는 다른 도구 재사용을 위해 유지.

### SSoT 호환 (JS 무수정)

- DOM ID 8종 보존: `statActive` / `activeCard` / `stat-error-rate` / `statAvgDuration` / `stat-p95` / `statSessions` / `statRequests` / `statTokens`
- `data-stat-tooltip` 속성 보존 → `stat-tooltip.js` 무수정
- `closest('.header-stat')` 셀렉터 호환 → `api.js` 무수정
- `chart.js` SSoT 함수 보존 (`setSourceData/setDonutMode/hasSourceData/getDonutMode/setTypeData`)
- 신규 디자인 토큰 0 — 모두 design-tokens.css 기존 토큰 재사용

## 컴포넌트 — Donut Mode SSoT (chart.js — header-summary-merge ADR-005 + ADR-008)

도넛 데이터/모드 동기화는 `chart.js`가 단일 책임으로 캡슐화. 외부 캐시 변수 0.

### ADR-008: donut-mode-toggle 폐기 + 자동 전환 정책

`donut-mode-toggle` UI는 폐기. 도넛 모드는 `setChartMode(mode)`가 chartSection 상태에 따라 자동 결정:

| chartSection 모드 | donut 모드 | 데이터 소스 |
|-------------------|-----------|-------------|
| `default` | `'model'` | `fetchModelUsage()` (캐시 미스 시), 전역 model 사용량 분포 |
| `detail` | `'type'` | `setSourceData('type', sessionTypeData)` (session-detail.js), 세션 단위 type 분포 |

`chart.js`의 `donutMode` 초기값 `'model'`. SSoT 함수(`setSourceData/setDonutMode/hasSourceData/getDonutMode`)는 그대로 유지 — 모드 전환만 `setChartMode`가 자동화.

### 사용 예시

```js
import { setSourceData, setDonutMode, hasSourceData, drawDonut, renderTypeLegend } from './chart.js';

// 두 종류 데이터를 chart 모듈에 공급. 활성 모드와 일치하는 종류만 화면에 반영됨.
setSourceData('type', typeData);
setSourceData('model', modelUsageData);

// 모드 전환 시 활성 데이터셋 자동 전환
setDonutMode('model');
drawDonut();
renderTypeLegend();

// 캐시 hit 검사 — fetch 필요 여부 판단
if (!hasSourceData('model')) {
  const data = await fetchModelUsage({ range: '24h' });
  setSourceData('model', data);
}
```

- `setSourceData(kind, data)`: `kind ∈ {'type', 'model'}`. 활성 모드 일치 시에만 typeData에 반영.
- `setDonutMode(mode)`: 활성 데이터셋(typeData) 자동 전환.
- `setTypeData(data)`: 후방 호환 — `setSourceData('type', data)` 위임.
- `hasSourceData(kind)`: 캐시 hit 검사.

**버그 수정**: ADR-016 도입 후 `fetchDashboard` 5초 polling이 `setTypeData(d.types)`로 typeData를 무조건 덮어써 Model 모드 도넛이 즉시 사라지던 문제. chart.js 내부에서 `kind === donutMode`일 때만 활성 데이터 갱신하므로 polling 안전.

## 컴포넌트 — chartSection 모드 (ADR-017 + ADR-008)

```
[default 모드]                       [detail 모드]
 .chart-default-meta                  .chart-detail-meta (세션 ID/프로젝트/토큰/배지)
 .timeline-meta (6 chip 두 그룹)      .timeline-meta 자동 숨김
 #timelineChart 표시                  #contextGrowthChart 표시
 donut(전역 model 분포)               donut(세션 type 분포 — 클라 계산)
 cache panel(전역 stats)              cache panel(세션 stats — 클라 계산)
```

JS API:
- `setChartMode('default' | 'detail')` (main.js) — donut 모드 자동 결정 (ADR-008)
  - `default` → `setDonutMode('model')` + (캐시 미스 시) `fetchModelUsage` → `setSourceData('model', data)`
  - `detail` → `setDonutMode('type')` (session-detail.js의 `setTypeData` 호환)
- detail 모드 진입 시 `.right-panel.is-detail-mode` → Insights 카드 hide
- `chart-actions`에는 `btnToggleChart`(접기 토글)만 유지. ADR-008로 `btn-close` / `detail-actions-sep` 제거 — closeDetail은 Esc / 로고 클릭으로 트리거

## 가격 정책 (ADR-015) — USD 표시 전면 제거

- cache-panel: `no cache / actual / saved` (토큰 단위, fmtToken 사용)
- Summary Strip: 비용/절감 카드 제거 → 토큰 chip만 유지 (ADR-006 Secondary strip의 `data-stat-tooltip="tokens"`)
- 신규 메트릭 API는 `_deprecated_cost_fields` 메타로 가격 필드 deprecated 표시
- designer는 토큰 단위만 사용, USD 환산 호출 금지

## 신규 메트릭 API 8종 (Phase 3)

| 엔드포인트 | UI 위치 |
|------------|---------|
| `/api/metrics/model-usage` | chartSection donut "Model" 모드 |
| `/api/metrics/cache-matrix` | (ADR-008로 cache panel UI 폐기, endpoint는 유지 — 다른 도구 재사용) |
| `/api/metrics/context-usage` | Insights tile (4 버킷 막대) |
| `/api/metrics/activity-heatmap` | Insights tile (7×24 grid) |
| `/api/metrics/turn-distribution` | Insights tile (5 버킷 + Compaction %) |
| `/api/metrics/agent-depth` | Insights tile (3-그룹 요약) |
| `/api/metrics/tool-categories` | left-panel 툴 통계 "카테고리" 모드 |
| `/api/metrics/anomalies-timeseries` | Insights tile (스택 막대) |

상세: `.claude/docs/plans/ui-redesign/api-spec.md`. JS 모듈: `metrics-api.js` (8종 fetch 래퍼).

## 구현 규칙

- CSS 변수만 사용 — 하드코딩 색상 금지
- 타입 컬러는 ADR-003 변수로만 참조
- 반응형 브레이크포인트 768px / 480px 유지
- `inline style` 사용 금지 (클래스로 처리)
- spacing은 `--space-1~6` 토큰만 사용 (raw px 금지)
- typography는 `--font-hero/major/body/meta/micro` + `--weight-hero/strong/normal` 토큰 사용
- 빈/로딩/에러는 `.state-empty/.state-loading/.state-error` SSoT 재사용
- 큰 영역(차트/피드/상세)은 `.card` 컴포넌트로 감쌈
- 가격($) 환산 노출 금지 — 토큰 단위만 (ADR-015)
- 메트릭 API 호출은 `metrics-api.js` 래퍼 사용 (직접 fetch 금지)
- CSS 파일 위치: `packages/web/assets/css/`
