# Screen Inventory — Claude Spyglass Web UI

> 디자이너 현행화 문서. 화면 구조·컴포넌트·디자인 상태를 추적합니다.
> **변경 발생 시 반드시 이 문서를 업데이트하세요.**

---

## 최종 현행화: 2026-04-19
## 대상 파일 구조
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

### 3-1. 프로젝트 탐색기

**DOM ID**: `#projectsSection`  
**높이**: 215px  
**상태**: ✅ 현행

| 요소 | 내용 |
|------|------|
| 섹션 라벨 | "PROJECTS" |
| 날짜 필터 | 전체 / 오늘 / 이번주 (filter-btn) |
| 프로젝트 목록 | 프로젝트명 + 토큰 바 + 세션수 |
| 선택 상태 | accent 좌측 border + accent-dim bg |

### 3-2. 세션 목록

**DOM ID**: `#sessionsSection`  
**높이**: 1fr (가변)  
**상태**: ✅ 현행

각 세션 행 구성:
```
[sess-id]  [상대시간]  [총토큰]  [●/○ 활성]
[첫 프롬프트 미리보기 텍스트]
```

| 요소 | 스타일 |
|------|--------|
| sess-id | 11px, text-muted (CSS class) |
| 상대시간 | 10px, text-dim |
| 총토큰 | 10px, text-dim |
| 활성 표시 | `●` green / `○` text-dim |
| 미리보기 | 10px, text-dim, ellipsis |

### 3-3. 툴 통계

**DOM ID**: `#toolStatsSection`  
**높이**: 160px  
**상태**: ✅ 현행

컬럼: 툴명 | 호출수 | 평균토큰 | 호출비율(바)

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

## 화면 5 — 요약 스트립

**DOM ID**: `.summary-strip`  
**높이**: 40px  
**상태**: ✅ 현행

| 카드 | 값 포맷 |
|------|---------|
| 총 세션 | 숫자 |
| 총 요청 | 숫자 |
| 총 토큰 | fmtToken (k/M) |
| 활성 세션 | 숫자 |
| 평균 응답시간 | formatDuration |

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

---

## 미결 디자인 이슈

| ID | 화면 | 내용 | 우선순위 |
|----|------|------|---------|
| D-001 | 1-2 | 출력 토큰 수집 시 컬럼 복원 및 in/out 색상 구분 | 보류 |
| D-002 | 1-2, 2-1 | 시각 포맷 차이 (대시보드 상대시간 vs 플랫뷰 절대시간) 정책 결정 | 낮음 |
| D-003 | 2-2 | 턴 뷰 tokens_output 표시 — 다른 뷰와 불일치 | 낮음 |
