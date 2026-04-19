# Screen Inventory — Web 대시보드

> 디자이너 현행화 문서. 화면 구조·컴포넌트·디자인 상태를 추적합니다.
> **변경 발생 시 반드시 이 문서를 업데이트하세요.**

---

## 최종 현행화: 2026-04-20 (summary-strip-ux + turn-card-agent-name)

## 파일 구조

```
packages/web/
├── index.html                  ← HTML 마크업 전용 (330줄)
└── assets/
    ├── css/                    ← 컴포넌트별 CSS 분리 (12개 파일)
    │   ├── design-tokens.css   ← :root 변수 SSoT (ADR-003)
    │   ├── layout.css
    │   ├── header.css
    │   ├── summary-strip.css
    │   ├── left-panel.css
    │   ├── default-view.css
    │   ├── detail-view.css
    │   ├── table.css
    │   ├── badges.css          ← .cache-tooltip / .stat-tooltip 포함
    │   ├── skeleton.css
    │   ├── cache-panel.css
    │   ├── turn-view.css
    │   └── turn-gantt.css
    └── js/                     ← native ESM 모듈 (15개 파일)
        ├── main.js             ← 진입점
        ├── formatters.js
        ├── chart.js
        ├── renderers.js
        ├── infra.js
        ├── left-panel.js
        ├── session-detail.js
        ├── api.js
        ├── cache-tooltip.js    ← Cache 셀 hover 툴팁
        ├── stat-tooltip.js     ← Summary Strip stat-card hover 툴팁
        ├── cache-panel-tooltip.js ← Cache Intelligence Panel hover 툴팁
        ├── cache-panel.js
        ├── anomaly.js
        ├── panel-resize.js
        ├── col-resize.js
        └── resize-utils.js
```

---

## 전체 레이아웃 구조

```
┌─────────────────────────────────────────────────────────┐
│  HEADER (52px)  로고 | 날짜필터 | 상태배지 | 마지막갱신  │
├─────────────────────────────────────────────────────────┤
│  ERROR BANNER (1px, 평소 숨김)                          │
├─────────────────────────────────────────────────────────┤
│  SUMMARY STRIP (40px)  세션 | 요청 | 토큰 | 활성 | 응답 │
├───────────────────┬─────────────────────────────────────┤
│  LEFT PANEL       │  RIGHT PANEL                        │
│  (280px)          │  (1fr)                              │
│                   │                                     │
│  ┌─────────────┐  │  [기본 뷰] or [세션 상세 뷰]        │
│  │ PROJECTS    │  │                                     │
│  │ (215px)     │  │                                     │
│  ├─────────────┤  │                                     │
│  │ SESSIONS    │  │                                     │
│  │ (1fr)       │  │                                     │
│  ├─────────────┤  │                                     │
│  │ TOOL STATS  │  │                                     │
│  │ (160px)     │  │                                     │
│  └─────────────┘  │                                     │
├───────────────────┴─────────────────────────────────────┤
│  FOOTER (20px)  Claude Spyglass — real-time monitor     │
└─────────────────────────────────────────────────────────┘
```

---

## 화면 1 — 대시보드 기본 뷰 (defaultView)

**DOM ID**: `#defaultView`
**진입 조건**: 초기 진입 또는 세션 선택 해제 시
**상태**: ✅ 현행

### 1-1. 요청 추이 차트

| 항목 | 현재 값 |
|------|---------|
| 구성 | 타임라인 캔버스 (2fr) + 도넛 차트 (1fr) |
| 타임라인 | 30분 버킷, 실시간 갱신, Canvas 2D |
| 도넛 | 타입별 비율 (prompt/tool_call/system) + 범례 |
| 높이 | canvas height="100" |
| 섹션 라벨 | "요청 추이 (실시간)" / 부제 "최근 30분" |

### 1-2. 로그 리스트 (최근 요청 테이블)

**핵심 화면. 변경 이력 관리 필수.**

#### 컬럼 명세 (현재)

| 컬럼 | 너비 | 내용 | 스타일 |
|------|------|------|--------|
| 시각 | 130px | `HH:MM:SS · X분 전` (오늘) / `MM/DD HH:MM:SS · X분 전` | 12px, text-dim, tabular-nums |
| 행위 | 140px | 타입배지 + 아이콘 + 식별자 + extras | 복합 (아래 상세) |
| 메시지 | flex | contextPreview 60자, 클릭 시 확장 | 10px, text-dim, cursor:pointer (preview만) |
| in | 52px | tokens_input, fmtToken | text-dim, right-align |
| out | 52px | tokens_output, fmtToken / 미수집 시 `—` | text-dim, right-align |
| 응답시간 | 72px | formatDuration (ms/s) | text-dim, right-align |
| 세션 | 96px | session_id 앞 12자 | text-muted, .sess-id CSS |

> **📌 출력 토큰(out)**: 컬럼은 존재하나 현재 미수집으로 `—` 표시. `tokens_output > 0` 시 자동 표시됨.

#### 행위 셀 구성 (makeActionCell)

| 타입 | 렌더 구성 |
|------|-----------|
| `prompt` | `[P]` + `[user]` + 모델명(11px, dim) + 캐시히트배지(⚡Xk) |
| `tool_call` | `[T]` + `◉/◎` 아이콘(13px, green/orange) + 툴명(12px) |
| `system` | `[S]` + `System`(11px, dim) |

#### 행 타입 구분 (ADR-006)

- 각 행 `td:first-child`에 타입별 2px 좌측 border
- hover: `--accent-dim` 배경
- 선택: `--accent` 좌측 border (`!important`)

#### 인터랙션

| 동작 | 결과 |
|------|------|
| 행 클릭 | 세션 상세 뷰로 전환 |
| 메시지 셀 `.prompt-preview` 클릭 | 행 아래 확장 패널 토글 |
| 필터 버튼 (All/Prompt/Tool/System) | 타입별 행 필터링 |
| 더 보기 버튼 | 추가 50건 로드 |

#### 로딩/빈 상태

- 초기: 스켈레톤 3행 (shimmer 1.4s)
- 에러: `RECENT_REQ_COLS` colspan 빨간 텍스트
- 빈 목록: "데이터 없음"

---

## 화면 2 — 세션 상세 뷰 (detailView)

**DOM ID**: `#detailView`
**진입 조건**: 좌측 세션 목록에서 세션 클릭
**상태**: ✅ 현행

### 2-0. 상세 헤더

| 요소 | 클래스 | 내용 |
|------|--------|------|
| 세션 ID | `.detail-session-id` | accent 색상, 앞 8자, `flex-shrink:0` (항상 완전 표시) |
| 프로젝트명 | `.detail-project` | text-muted, `flex-shrink:1` (공간 부족 시 ellipsis 축소) |
| 총 토큰 | `.detail-tokens` | accent, `flex-shrink:0` |
| 종료 시각 | `.detail-ended-at` | text-muted, `flex-shrink:0` (인라인 스타일 없음) |
| 집계 배지 | `.detail-agg-badges` | inline-flex, `flex-shrink:0`, 숨김 시 `.detail-agg-badges--hidden` 클래스 사용 |
| 버튼 그룹 | `.detail-actions` | 우상단, flex 컨테이너, `flex-shrink:0`, 토글 버튼 + 구분선 + 닫기 버튼 |
| 접기/펼치기 토글 버튼 | `#btnToggleDetail` `.btn-toggle` | SVG chevron-down, 28×28px, hover: `var(--accent)` + `var(--accent-dim)` bg, 접힌 상태에서 180도 회전 |
| 구분선 | `.detail-actions-sep` | 1px × 14px, `var(--border)`, 두 버튼 사이 시각적 분리 |
| 닫기 버튼 | `#btnCloseDetail` `.btn-close` | SVG ✕, 28×28px, hover: `var(--red)` + `var(--red-dim)` bg, `closeDetail()` 호출 |

> **레이아웃 정책 (ADR-001~006)**: `detail-header`와 `detail-meta` 모두 `flex-wrap` 없음 — 1줄 고정. 인라인 스타일 없음 — 모든 상태 CSS 클래스로 제어.

#### 접기/펼치기 상태 (`context-chart-toggle`)

| 상태 | 클래스 | 동작 |
|------|--------|------|
| 펼침 (기본) | — | 모든 콘텐츠 표시 |
| 접힘 | `.detail-collapsed` on `#detailView` + `.context-chart-section--collapsed` on `.context-chart-section` | **차트 영역만** 부드럽게 접힘 (grid-template-rows: 1fr → 0fr 전환, 0.3s ease-in-out) |
| 탭바·컨트롤바·콘텐츠 | 항상 표시 (ADR-002) | 차트를 접어도 탭 전환·검색·목록 조회 가능 |
| 접힌 헤더 | `.detail-collapsed .detail-header` | `cursor:pointer` — 전체 헤더 클릭으로 펼치기 |
| 토글 아이콘 | `.detail-collapsed .btn-toggle svg` | `transform:rotate(180deg)` — 펼치기 방향 표시 |

- 토글 버튼 클릭 → `toggleDetailCollapse()` 호출
- 접힌 상태에서 헤더 클릭 (`.detail-actions` 제외) → `toggleDetailCollapse()` 호출
- `closeDetail()` 호출 시 `.detail-collapsed` 자동 제거 (다음 세션 선택 시 펼친 상태로 진입)
- 차트 접기 구현: `grid-template-rows` + `.context-chart-inner { overflow: hidden }` 래퍼 패턴 (ADR-001)

### 2-0-1. Context Growth 차트

**DOM**: `.context-chart-section > .context-chart-inner > ...` — `.context-chart-inner` 래퍼로 overflow 클립
**CSS**: `context-chart.css`
**JS**: `context-chart.js`

#### 접기/펼치기 애니메이션 구조

```
.context-chart-section          ← display:grid, grid-template-rows 전환 (0.3s ease-in-out)
  └─ .context-chart-inner       ← overflow:hidden (클립 담당)
       ├─ .context-chart-header
       ├─ #contextGrowthChart   ← canvas
       ├─ #contextChartEmpty
       └─ .context-chart-footer
```

- 접힘: `.context-chart-section--collapsed` (grid-template-rows: 0fr, border-bottom: none)
- 펼침: grid-template-rows: 1fr

| 상태 | 동작 |
|------|------|
| 유효 데이터 있음 | `#contextGrowthChart` (canvas) 표시, `#contextChartEmpty` 숨김 |
| 유효 데이터 없음 | canvas에 `.context-chart-hidden` 추가, `#contextChartEmpty`에 `.context-chart-empty--visible` 추가 |
| 세션 변경 / 초기화 | `clearContextChart()` 호출 → 빈 상태 표시 |

빈 상태 텍스트: "컨텍스트 데이터 없음"

### 2-0-2. 탭 바 + 컨트롤 바 구조

```
view-tab-bar           (플랫 | 턴 뷰 | 간트) — 탭 내비게이션 전용
detail-controls-bar    (⌕ 검색창) (All/prompt/tool_call/system) — 필터링 전용
```

- `view-tab-bar`: 탭 버튼만, 컨트롤 요소 없음
- `detail-controls-bar`: `background: var(--surface-alt)`, `border-bottom: 1px solid var(--border)`, `justify-content: flex-end`
- 내부 `.feed-controls`: 검색창 + `.detail-type-filter-btns` 묶음 (gap 8px)
- `.detail-type-filter-btns`: `border-left: 1px solid var(--border)`, `padding-left: 12px`
- defaultView `view-section-header + .feed-controls` 패턴과 동일 시각 언어
- 인라인 스타일 없음 — 모든 규칙 `default-view.css` 로 이관

### 2-1. 로그 리스트 — 플랫 뷰 (detailFlatView)

**핵심 화면. 변경 이력 관리 필수.**

> 1-2 로그 리스트와 동일한 `makeRequestRow()` 사용. 차이점:

| 항목 | 대시보드 | 플랫 뷰 |
|------|----------|---------|
| 세션 컬럼 | ✅ 있음 | ❌ 없음 |
| 시각 포맷 | `fmtTimestamp` (상대시간 포함) | `fmtDate` (절대시간만) |
| colspan 상수 | `RECENT_REQ_COLS = 7` | `FLAT_VIEW_COLS = 6` |
| 하단 소계 행 | ❌ | ✅ 타입별 건수 배지 |

> **📌 출력 토큰(out)**: 대시보드와 동일하게 컬럼 존재, 미수집 시 `—` 표시.

### 2-3. Gantt 차트 뷰 (detailGanttView)

**DOM ID**: `#detailGanttView`
**탭 버튼**: `#tabGantt` (`data-tab="gantt"`)
**상태**: 구조 완료 (JS 렌더러 미구현)

#### 구조

```
.detail-content (flex:1, overflow-y:auto)
  └─ .gantt-toolbar (flex, justify-content:space-between)
       ├─ #ganttHint (.gantt-hint)   — "세션 전체 · N개 툴 호출"
       └─ #ganttLegend (.gantt-legend)  — JS가 동적 삽입
  └─ #ganttScroll (.gantt-scroll)  — flex:1, overflow-y:auto
       └─ #turnGanttChart (canvas)  — height는 JS 동적 설정
```

#### 범례 아이템 구조 (JS 동적 삽입)

```html
<span class="gantt-legend-item">
  <span class="gantt-legend-dot" style="background:#60a5fa"></span>
  Read
</span>
```

#### CSS 파일

`packages/web/assets/css/turn-gantt.css`

---

### 2-2. 로그 리스트 — 턴 뷰 (detailTurnView)

**DOM ID**: `#detailTurnView`
**상태**: ✅ 현행

#### 구조

```
[T1] 오전 02:15  프롬프트 요약 텍스트  1.2k  ▶
  └─ [prompt 행]  모델명  미리보기  tokens_in | tokens_out  응답시간  시각
  └─ [tool_call 행]  ◉툴명  미리보기  tokens_in | tokens_out  응답시간  시각
  └─ ...

[T2] ...
```

#### 턴 헤더 요소

| 요소 | 스타일 |
|------|--------|
| 턴 배지 `T1` | accent-dim bg, accent text, 10px bold |
| 시각 | 11px, text-dim |
| 메타 (요약) | 11px, text-muted |
| 토큰 합계 | 11px, accent bold |
| 토글 화살표 | 11px, text-dim, 90° rotation on open |

#### 턴 내 행 그리드

```css
grid-template-columns: 28px minmax(140px,1fr) 56px 56px 72px 80px
/* 아이콘 | 행위+미리보기 | 입력 | 출력 | 응답시간 | 시각 */
```

> **📌 턴 뷰는 tokens_output 표시 유지** — 대시보드/플랫뷰와 달리 in/out 구분 있음.

---

## 화면 3 — 좌측 패널

### 패널 너비 리사이즈

**핸들**: `.panel-resize-handle` (position:absolute, 우측 끝 4px, z-index:10)
**저장**: `localStorage('spyglass:panel-width')` — 새로고침 후 복원

| 동작 | 결과 |
|------|------|
| 핸들 드래그 | 180px~480px 범위에서 너비 자유 조절 |
| 핸들 더블클릭 | 패널 내 콘텐츠 최대 너비에 맞게 Auto-fit |
| 페이지 로드 | localStorage에서 마지막 너비 복원 |

**관련 파일**:
- `assets/js/panel-resize.js` — `initPanelResize(panelEl, handleEl)`
- `assets/js/resize-utils.js` — `measureMaxWidth(elements)` (col-resize.js와 공유)

> **테이블 컬럼 리사이즈도 동일한 UX**: `col-resize.js`의 각 컬럼 핸들도 드래그(기존) + 더블클릭 Auto-fit(추가됨)을 지원. 측정 로직은 `resize-utils.measureMaxWidth`를 공유.

### 3-1. 프로젝트 탐색기

**DOM ID**: 없음 (`.panel-section.flex-section`, tbody: `browserProjectsBody`)
**높이**: `var(--project-panel-height)` = 215px
**상태**: ✅ 현행

| 요소 | 내용 |
|------|------|
| 섹션 라벨 | "프로젝트" (`.panel-label` CSS `text-transform:uppercase` 적용) |
| 섹션 힌트 | "클릭하여 세션 조회" |
| 날짜 필터 | **없음** — 날짜 필터는 헤더에만 존재 (`#dateFilter`) |
| 테이블 컬럼 | **이름** (max-width 120px, ellipsis) \| **세션** (right-align) \| **토큰** (바+텍스트) |
| 선택 상태 | `.row-selected` 클래스 (accent 좌측 border + accent-dim bg) |

#### 프로젝트 행 렌더링 (`renderBrowserProjects`)

- 토큰 바 너비: `max(1, round(total_tokens / maxTotal * 100))`%
- 바 색상: `var(--accent)`
- 이름: max-width 120px, ellipsis + `title` 속성으로 전체 이름 표시

### 3-2. 세션 목록

**DOM ID**: 없음 (tbody: `browserSessionsBody`, 힌트: `sessionPaneHint`)
**높이**: 1fr (가변)
**상태**: ✅ 현행

각 세션 행 구성 (`makeSessionRow`):
```
[sess-id(8자)]  [상대시간]       [총토큰]  [●/○]
[첫 프롬프트 미리보기 텍스트 (최대 60자)]
```

| 요소 | 스타일 | 비고 |
|------|--------|------|
| sess-id | 11px, text-muted, max-width 90px, ellipsis | `s.id.slice(0, 8)` 앞 8자 |
| 상대시간 | 10px, text-dim, flex-shrink:0 | `fmtRelative(started_at)` |
| 총토큰 | 10px, text-dim, margin-left:auto (우측 끝 정렬) | `fmtToken(total_tokens)` |
| 활성 표시 | `●` green / `○` text-dim | `!s.ended_at` → 활성 |
| 미리보기 | 10px, text-dim, ellipsis | `extractFirstPrompt(first_prompt_payload)` 60자 |

#### 세션 패널 힌트 (`#sessionPaneHint`) 동적 변경

| 상태 | 표시 텍스트 |
|------|-------------|
| 프로젝트 미선택 | "프로젝트를 선택하세요" |
| 프로젝트 선택 후 | "{project_name} · {n}개" |

#### 세션 정렬

`started_at` 내림차순 (최신 세션이 위)

### 3-3. 툴 통계

**DOM ID**: `#toolStatsSection` (힌트: `#toolCount`, tbody: `#toolsBody`)
**높이**: `var(--tool-stats-height)` = 160px
**상태**: ✅ 현행

| 요소 | 내용 |
|------|------|
| 섹션 라벨 | "툴 통계 **(전체)**" — "(전체)"는 별도 span, font-weight:400, opacity:0.6 |
| 섹션 힌트 | `{n}개` (툴 종류 수) |

#### 테이블 컬럼

| 컬럼 | 내용 | 스타일 |
|------|------|--------|
| 툴 | 아이콘 + 툴명 + 서브텍스트 | `.tool-cell` (아래 상세) |
| 호출 | `call_count` | right-align, `.num-hi` |
| 평균토큰 | `avg_tokens > 0` → `fmtToken`, 없으면 `—` | right-align |
| 호출 비율 | 바 (green fill) + 퍼센트 텍스트 | `var(--green)` |

#### 툴 셀 구성 (`tool-cell`)

```
[◉ or ◎]  {tool_name}
           {tool_detail 50자 이내}  ← 있을 때만 표시 (.tool-sub)
```

| 아이콘 | 클래스 | 해당 툴 |
|--------|--------|---------|
| `◉` | `.tool-icon-default` | 일반 툴 |
| `◎` | `.tool-icon-agent` | `Agent`, `Skill`, `Task` 계열 |

---

## 화면 4 — 헤더

**DOM ID**: `.header`
**높이**: 52px
**상태**: ✅ 현행

| 요소 | 위치 | 내용 |
|------|------|------|
| 로고 | 좌 | 아이콘 + "Claude Spyglass" 16px 800 |
| 날짜 필터 | 중 | 전체/오늘/이번주 |
| 마지막 갱신 | 우 | "갱신: HH:MM:SS" 10px text-dim |
| LIVE 배지 | 우 | `● LIVE` (green pulse) / `○ OFFLINE` |

---

## 화면 5 — 요약 스트립 (Command Center)

**DOM ID**: `.summary-strip`
**높이**: 40px
**상태**: ✅ 현행

### 좌측 그룹 — 활동 지표

| 카드 | DOM ID | 값 포맷 |
|------|--------|---------|
| 총 세션 | `statSessions` | 숫자 |
| 총 요청 | `statRequests` | 숫자 |
| 총 토큰 | `statTokens` | fmtToken (k/M) |
| 활성 세션 | `statActive` | 숫자 (`active` 클래스 토글) |
| 평균 응답시간 | `statAvgDuration` | formatDuration |

### 구분선

`.stat-divider` — `1px solid var(--border)`, `align-self: stretch` (ADR-001)

### 상태 클래스 (summary-strip-ux)

**활성 세션 있을 때**: `.stat-card.is-active-indicator`
- 녹색 dot (6px, shadow) + 미세 배경 틴트 (rgba(74,222,128,0.05))
- 조건: `activeSessions > 0`
- 적용 카드: `#activeCard`

**오류율 > 0%**: `.stat-card.is-error`
- 값 텍스트 빨간색 (var(--red))
- 조건: `errorRate > 0`
- 적용 카드: 오류율 카드

**오류율 > 1%**: `.stat-card.is-critical`
- 카드 테두리 강조 (var(--red-border))
- 배경 그래디언트 (var(--red-bg-subtle))
- 조건: `errorRate > 1` (1% 초과)
- 적용 카드: 오류율 카드

**소스 필드 및 적용 로직**: `api.js` 함수 `fetchDashboard()`
- activeSessions: `d.summary?.activeSessions` → `is-active-indicator` 토글
- errorRate: `d.summary?.errorRate` → `is-error`, `is-critical` 토글
- 기존 `active` 클래스와 동시 적용 (중복 제거 없음 — CSS 우선순위 관리)


### 우측 그룹 — 비용·성능 지표

| 카드 | DOM ID | 값 포맷 | 경고 조건 |
|------|--------|---------|----------|
| 오늘 비용 | `stat-cost` | `$X.XX` | — |
| 캐시 절약 | `stat-cache-savings` | `$X.XX` | — |
| P95 응답시간 | `stat-p95` | `Xms` / `X.Xs` | — |
| 오류율 | `stat-error-rate` | `X.X%` | > 0% → `.is-error` (red text); > 1% → `.is-critical` (red border+bg) |

- 서버 필드 미수신 시 초기값 `--` 유지
- 소스 필드: `d.summary.costUsd`, `cacheSavingsUsd`, `p95DurationMs`, `errorRate`

---

## 변경 이력

| 날짜 | 화면 | 변경 내용 | feature |
|------|------|-----------|---------|
| 2026-04-19 | 전체 | index.html 단일 파일 → CSS 11개 + JS 8개 분리 | web-component-split |
| 2026-04-19 | 1-2, 2-1 | 출력 토큰 컬럼 제거 (미수집) | dashboard-design-fix |
| 2026-04-19 | 1-2 | 필터 버튼 라벨 개선 (Tool/Prompt/System) | dashboard-design-fix |
| 2026-04-19 | 1-2, 2-1 | 메시지 셀 cursor를 prompt-preview로 이동 | dashboard-design-fix |
| 2026-04-19 | 3-2 | sess-id inline style accent 제거 → CSS 클래스 | dashboard-design-fix |
| 2026-04-19 | 1-2, 2-1 | system 행위 셀에 "System" 라벨 추가 | dashboard-design-fix |
| 2026-04-19 | 3-1 | DOM ID 없음으로 정정, 날짜 필터 없음 정정, 컬럼 순서 정정 | screen-inventory-sync |
| 2026-04-19 | 3-2 | DOM ID 없음으로 정정, sess-id 8자 명시, 힌트 동적 변경 추가 | screen-inventory-sync |
| 2026-04-19 | 3-3 | 라벨 "(전체)" 추가, 툴 셀 서브텍스트·아이콘 명세 추가 | screen-inventory-sync |
| 2026-04-19 | 3 | 패널 너비 리사이즈 핸들 추가 (드래그 + 더블클릭 Auto-fit) | left-panel-resize |
| 2026-04-19 | 1-2, 2-1 | 테이블 컬럼 핸들 더블클릭 Auto-fit 추가 (col-resize.js) | left-panel-resize |
| 2026-04-19 | 3-1 | 프로젝트 이름 컬럼 max-width:120px 제거 → .cell-proj-name CSS 클래스로 전환, colgroup 추가 | proj-name-truncation-fix |
| 2026-04-19 | 5 | summary strip → Command Center: 구분선 + 비용·성능 지표 4개 추가 | command-center-strip |
| 2026-04-19 | 1-2, 2-1 | cell-target ellipsis 버그 수정 (text-overflow + white-space 추가) | log-page-ux-fix |
| 2026-04-19 | 1-2, 2-1 | 확장 패널 총글자수 힌트 제거 (복사 부작용 해소, ADR-002) | log-page-ux-fix |
| 2026-04-19 | 전체 | CSS 하드코딩 rgba → 토큰 교체 (table.css 3곳, badges.css 3곳, turn-view.css 3곳) | log-page-ux-fix |
| 2026-04-19 | 전체 | design-tokens.css 신규 토큰 6종: --accent-bg-light/medium, --blue/red-bg-light, --radius-sm/md | log-page-ux-fix |
| 2026-04-19 | 전체 | badges.css border-radius 불일치 해소 → --radius-sm/--radius-md 일관 적용 | log-page-ux-fix |
| 2026-04-19 | 1-2, 2-1 | Model 컬럼 'synthetic' 값을 '—'로 표시 (낶부 마커 숨김) | synthetic-model-display |
| 2026-04-19 | 전체 | 툴팁 보완: Cache Panel 3섹션(hover), turn-meta/detail-agg-badge(title), liveBadge/날짜필터/타입필터(title) | tooltip-supplement |
| 2026-04-19 | 2 | 세션 상세 뷰에 간트 탭 추가 (탭 버튼 + Gantt 컨테이너 HTML + turn-gantt.css) | turn-trace-gantt |
| 2026-04-19 | 2 | detailView feed-controls 분리: view-tab-bar에서 검색+필터 제거, detail-controls-bar 신설 (defaultView와 레이아웃 패턴 통일) | feed-controls-layout |
| 2026-04-19 | 2-0 | detail-header 1줄 고정: flex-wrap 제거, 프로젝트명 ellipsis 축소, 인라인 스타일 → CSS 클래스 이관 (detail-ended-at, detail-agg-badges--hidden) | detail-header-layout |
| 2026-04-19 | 2-0 | "닫기" → "접기" 버튼 (‹ 아이콘 추가, hover 색상 red → text-muted 변경) | detail-ux-improvements |
| 2026-04-19 | 2-0-1 | Context Growth 차트 항상 표시: inline display:none 제거, 빈 상태(.context-chart-empty) 추가, JS 클래스 토글 방식으로 전환 | detail-ux-improvements |
| 2026-04-19 | 2-0 | 접기/펼치기 + 닫기 버튼 분리: .detail-actions 그룹, SVG chevron 토글(rotate), SVG ✕ 닫기, .detail-collapsed CSS 클래스 상태, 접힌 헤더 클릭 펼치기 | detail-collapse-toggle |
| 2026-04-19 | 2-0-1 | 접기 범위 축소: 차트 영역만 접기/펼치기 (탭바·컨트롤바·콘텐츠는 항상 표시). grid-template-rows 전환 애니메이션(0.3s ease-in-out), .context-chart-inner 래퍼 추가 | context-chart-toggle |
| 2026-04-20 | 5 | Summary Strip 상태 클래스 추가: is-active-indicator (활성 세션), is-error (오류 > 0%), is-critical (오류 > 1%) | summary-strip-ux |
| 2026-04-20 | 2-3 (card) | 턴 카드 chip에서 Agent/Skill 호출 시 서브에이전트명 표기: .agent-chip 클래스 + .agent-chip-name (max-width:10ch ellipsis) + toolIconHtml() 재사용, 압축 키 name+agentName 복합으로 변경 | turn-card-agent-name |

---

## 미결 디자인 이슈

| ID | 화면 | 내용 | 우선순위 |
|----|------|------|---------|
| D-001 | 1-2 | 출력 토큰 수집 시 컬럼 복원 및 in/out 색상 구분 | 보류 |
| D-002 | 1-2, 2-1 | 시각 포맷 차이 (대시보드 상대시간 vs 플랫뷰 절대시간) 정책 결정 | 낮음 |
| D-003 | 2-2 | 턴 뷰 tokens_output 표시 — 다른 뷰와 불일치 | 낮음 |
