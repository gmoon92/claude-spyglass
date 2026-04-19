# Screen Inventory — Web 대시보드

> 디자이너 현행화 문서. 화면 구조·컴포넌트·디자인 상태를 추적합니다.
> **변경 발생 시 반드시 이 문서를 업데이트하세요.**

---

## 최종 현행화: 2026-04-19 (command-center-strip)

## 파일 구조

```
packages/web/
├── index.html                  ← HTML 마크업 전용 (261줄)
└── assets/
    ├── css/                    ← 컴포넌트별 CSS 분리 (11개 파일)
    │   ├── design-tokens.css   ← :root 변수 SSoT (ADR-003)
    │   ├── layout.css
    │   ├── header.css
    │   ├── summary-strip.css
    │   ├── left-panel.css
    │   ├── default-view.css
    │   ├── detail-view.css
    │   ├── table.css
    │   ├── badges.css
    │   ├── skeleton.css
    │   └── turn-view.css
    └── js/                     ← native ESM 모듈 (8개 파일)
        ├── main.js             ← 진입점
        ├── formatters.js
        ├── chart.js
        ├── renderers.js
        ├── infra.js
        ├── left-panel.js
        ├── session-detail.js
        └── api.js
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

| 요소 | 내용 |
|------|------|
| 세션 ID | accent 색상, 앞 8자 |
| 프로젝트명 | text-muted |
| 총 토큰 | accent |
| 종료 시각 | text-muted |
| 집계 배지 | 타입별 건수, 최다 툴, 캐시 히트 등 |
| 닫기 버튼 | 우상단 |

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

### 우측 그룹 — 비용·성능 지표

| 카드 | DOM ID | 값 포맷 | 경고 조건 |
|------|--------|---------|----------|
| 오늘 비용 | `stat-cost` | `$X.XX` | — |
| 캐시 절약 | `stat-cache-savings` | `$X.XX` | — |
| P95 응답시간 | `stat-p95` | `Xms` / `X.Xs` | — |
| 오류율 | `stat-error-rate` | `X.X%` | > 5% → `.is-alert` (red) |

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

---

## 미결 디자인 이슈

| ID | 화면 | 내용 | 우선순위 |
|----|------|------|---------|
| D-001 | 1-2 | 출력 토큰 수집 시 컬럼 복원 및 in/out 색상 구분 | 보류 |
| D-002 | 1-2, 2-1 | 시각 포맷 차이 (대시보드 상대시간 vs 플랫뷰 절대시간) 정책 결정 | 낮음 |
| D-003 | 2-2 | 턴 뷰 tokens_output 표시 — 다른 뷰와 불일치 | 낮음 |
