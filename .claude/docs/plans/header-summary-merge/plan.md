# header-summary-merge 개발 계획

> Feature: header-summary-merge
> 작성일: 2026-04-26
> 작성자: Claude Code (designer agent)

## 목표

claude-spyglass 웹 대시보드의 상단 정보 영역을 재구성한다.

1. **summary-strip 통합** — 별도 띠로 분리되어 있던 7개 stat-card(활성/오류율/평균응답/P95/세션/요청/토큰)를
   `.header` 영역에 인라인 chip 형태로 녹여 자연스럽게 표시한다.
2. **Insights 카드 완전 제거** — ADR-016에서 도입된 5종 sub-tile Insights 카드(heatmap/context/turn/agent/anomaly)를
   HTML/CSS/JS에서 모두 삭제한다.

## 배경

- 사용자 피드백: summary-strip이 화면 상단에 별도 행을 차지하면서 시각 노이즈가 됨.
  이미 헤더 라인이 비어 있으므로 chip 그룹으로 통합하면 세로 공간 56px 회수 + 시선 1줄 정리.
- Insights 카드는 도입 후 실 사용성이 낮다는 사용자 판단. 차지하는 세로 공간 대비 가치가 낮아 제거.
- 두 변경 모두 ADR-005(summary-strip 3섹션) / ADR-016(Insights 5종) / ADR-019(right-panel 스크롤) 정책의 일부 폐기를 동반하므로
  새 ADR로 Supersede 명시 필요.

## 범위

### 포함

- HTML: `packages/web/index.html`
  - `<!-- SUMMARY STRIP -->` 블록 → `.header` 내부 통합
  - `<!-- Insights 카드 -->` 블록 완전 삭제
  - `<link rel="stylesheet" href="/assets/css/insights.css">` 제거
- CSS:
  - `packages/web/assets/css/summary-strip.css` 삭제
  - `packages/web/assets/css/insights.css` 삭제
  - `packages/web/assets/css/header.css` 확장 — `.header-stats`, `.header-stat`, `.header-stat-label`, `.header-stat-value`, `.header-stat-divider` + 상태 클래스
  - `packages/web/assets/css/layout.css` — body grid-template-rows 정리
  - `packages/web/assets/css/design-tokens.css` — 신규 토큰 필요 시 추가 (현행 토큰만 사용 예정)
- JS:
  - `packages/web/assets/js/insights.js` 삭제
  - `packages/web/assets/js/main.js` — insights import, initInsights/loadInsights 호출, is-detail-mode insights hide 로직 제거
  - `packages/web/assets/js/api.js` — DOM ID 그대로 동작 (셀렉터 `closest('.stat-card')`을 `closest('.header-stat')`으로 변경)
  - `packages/web/assets/js/metrics-api.js` — Insights 전용 fetcher 5종(`fetchContextUsage` / `fetchActivityHeatmap` / `fetchTurnDistribution` / `fetchAgentDepth` / `fetchAnomaliesTimeseries`) 제거.
    `fetchModelUsage` / `fetchCacheMatrix` / `fetchToolCategories`는 cache-panel/tool-stats에서 사용 중이므로 유지.
- 디자인 문서:
  - `.claude/skills/ui-designer/references/web/screen-inventory.md`
  - `.claude/skills/ui-designer/references/web/design-system.md`

### 제외

- 서버 API (`/api/metrics/*`) 엔드포인트 자체는 그대로 유지 (다른 도구나 향후 재사용 가능성)
- DB 스키마, 마이그레이션, 훅 수집 스크립트
- TUI 코드 (현재 작업은 웹 대시보드 한정)
- 기존 stat 데이터 계산 로직 (활성/오류율/응답시간/세션/요청/토큰 — `fetchDashboard` 그대로 사용)

## 단계별 계획

### 1단계 — Insights 카드 제거 (의존성 없음, 단순 삭제)

1. `index.html`에서 `<!-- Insights 카드 -->` 블록 통째로 삭제
2. `index.html`에서 `<link rel="stylesheet" href="/assets/css/insights.css">` 줄 삭제
3. `main.js`에서 `import { initInsights, loadInsights } from './insights.js';` 제거
4. `main.js`에서 `initInsights(); loadInsights('24h');` 호출 제거
5. `main.js`에서 `rightPanel?.classList.add('is-detail-mode');` 주석/코드 정리
6. `insights.js`, `insights.css` 파일 삭제
7. `metrics-api.js`에서 미사용이 되는 5개 fetcher 제거 (사용처 grep 검증 후)

**예상 시간**: 15분
**검증**: 페이지 로드 시 콘솔 에러 0, 기존 차트 영역 정상 동작

### 2단계 — Header 통합 stat chip 디자인

디자인 결정 (ADR로 별도 기록):
- 헤더 단일 행 유지 (52px → 필요 시 56px 미세 확장)
- 좌(로고+LIVE) | 중(stats chip 그룹) | 우(날짜필터+갱신) 3분할
- chip 형태:
  - 라벨(uppercase, font-micro, text-dim) + 값(font-meta, weight-strong, text)
  - 활성/오류율 등 강조 카드는 hero 변형 (값 색상 강조 — accent/red/green)
  - 그룹 사이 `.header-stat-divider` 1px

**클래스 설계**:
```
.header
└── .header-left
    ├── .logo
    └── .badge-live
└── .header-stats              ← 신규 (data-stat-tooltip 자손 포함)
    ├── .header-stat-group .header-stat-group--hero
    │   ├── .header-stat[data-stat-tooltip="active"]   #activeCard
    │   └── .header-stat[data-stat-tooltip="err"]
    ├── .header-stat-divider
    ├── .header-stat-group .header-stat-group--performance
    │   ├── .header-stat[data-stat-tooltip="avg-duration"]
    │   └── .header-stat[data-stat-tooltip="p95"]
    ├── .header-stat-divider
    └── .header-stat-group .header-stat-group--volume
        ├── .header-stat[data-stat-tooltip="sessions"]
        ├── .header-stat[data-stat-tooltip="requests"]
        └── .header-stat[data-stat-tooltip="tokens"]
└── .header-right               ← 신규 묶음
    ├── .date-filter
    └── .last-updated
```

**상태 클래스** (현행 SSoT 그대로 이름만 새 클래스에 적용):
- `.header-stat.is-active-indicator` — 좌측 dot + 값 green
- `.header-stat.is-error` — 값 red
- `.header-stat.is-critical` — 배경 red-bg-subtle 그라디언트

**예상 시간**: 25분

### 3단계 — HTML / CSS / JS 적용

1. `index.html` `.summary-strip` 블록 → `.header` 내부로 이동/재구성
2. `header.css` 확장 (위 디자인 적용)
3. `summary-strip.css` 삭제 + `index.html` `<link>` 제거
4. `layout.css` body `grid-template-rows: auto auto auto 1fr auto` → `auto auto 1fr auto` 정리
5. `api.js` `closest('.stat-card')` → `closest('.header-stat')` 셀렉터 교체

**예상 시간**: 25분
**검증**: 7개 stat 모두 표시, 활성/오류율 토글, stat-tooltip 동작

### 4단계 — 반응형 / 접근성

- `@media (max-width: 1024px)` — Volume 그룹 라벨 단축 (예: "세션" → "S")
- `@media (max-width: 768px)` — Volume 그룹 숨김 또는 wrap, divider 숨김
- title 속성으로 풀라벨 fallback 보장

**예상 시간**: 10분

### 5단계 — 문서 현행화 + 검증

1. `.claude/skills/ui-designer/references/web/screen-inventory.md`
   - "화면 5 — 요약 스트립" 섹션을 "화면 4 — 헤더 (통합 stats 포함)"으로 흡수
   - "Insights 카드" 항목 제거
   - "최종 현행화" 섹션에 새 항목 추가
   - "변경 이력"에 행 추가
2. `.claude/skills/ui-designer/references/web/design-system.md`
   - 컴포넌트 SSoT에서 `.summary-strip` / `.insights-card` 항목 제거
3. (가능 시) Playwright 스크린샷으로 시각 검증

**예상 시간**: 15분

## 완료 기준

- [ ] 메인 화면에서 summary-strip 띠가 사라짐 (HTML/CSS/JS 모든 흔적 제거)
- [ ] 7개 stat 지표(활성/오류율/평균/P95/세션/요청/토큰)가 헤더 영역에 통합되어 표시
- [ ] 기존 상태 클래스 동등 동작 (활성 dot, 오류율 색상, critical 강조)
- [ ] stat-tooltip hover 시 정상 표시 (data-stat-tooltip 호환)
- [ ] Insights 카드 관련 HTML / CSS / JS 코드 0건 (grep 검증)
- [ ] 콘솔 에러 0건
- [ ] CSS 변수만 사용 (하드코딩 색상 없음)
- [ ] 모바일 / 좁은 폭에서 wrap 또는 우선순위 노출 동작
- [ ] `screen-inventory.md` / `design-system.md` 현행화 완료

## 리스크 / 검증 포인트

| 리스크 | 대응 |
|------|------|
| `api.js`가 `.stat-card` 셀렉터에 의존 | 새 `.header-stat`으로 교체 (line 63, 82) |
| `stat-tooltip.js`가 `[data-stat-tooltip]`만 사용 | 속성 보존만 보장 → 호환 OK |
| `metrics-api.js` 일부 fetcher가 다른 곳에서 사용 | grep 검증 — 현재 5종은 insights.js만 사용 확인됨 |
| ADR-005 (Hero/Performance/Volume 3섹션) Supersede 명시 | 새 ADR-020에서 Status 갱신 |
| ADR-016 (Insights 카드) Supersede 명시 | 새 ADR-021에서 Status 갱신 |
| ADR-019 (right-panel 스크롤) 정합성 | Insights 제거로 콘텐츠 짧아짐 → min-height 360px만 유지하면 OK |
| 헤더 폭 부족 | flex-wrap or media query로 우선순위 처리 |

## 예상 소요 시간

| 단계 | 시간 |
|------|------|
| 1. Insights 제거 | 15분 |
| 2. 디자인 설계 (ADR 포함) | 25분 |
| 3. 구현 적용 | 25분 |
| 4. 반응형 | 10분 |
| 5. 문서 현행화 | 15분 |
| **총** | **약 90분** |

---

# Phase 2 — header-stats를 view-section-header로 이전 (2026-04-26 follow-up)

## 배경

Phase 1 적용 후 사용자가 디자인 결과를 검토하고 추가 결정:

- 헤더(`.header`)는 **글로벌 네비/필터** 영역(로고/LIVE 배지/날짜 필터/갱신 시각)으로 유지하는 것이 정보 위계상 맞다.
- 통계 chip(활성/오류율/평균/P95/세션/요청/토큰)은 **현재 보고 있는 view 컨텍스트에 종속된 정보**이므로
  `chartSection`의 `.view-section-header`(요청 추이 라벨이 있는 영역)에 배치하는 것이 자연스럽다.
- view 전환(default → detail) 시 통계도 함께 변하는 관계가 시각적으로 표현되어야 한다:
  - default 모드: 전역 통계 chip 표시
  - detail 모드: 세션 메타(ID/프로젝트/토큰/종료시각/배지)가 우선 — 통계 chip 숨김 (기존 `.chart-mode-detail` 패턴 활용)

## 함께 처리한 버그 수정

Phase 1 통합 후 발견된 별개 버그도 같은 시점에 수정:

- **Donut Model 모드 토글이 동작하지 않는 버그** — `fetchDashboard()`의 5초 polling이 `setTypeData(d.types)`로 typeData를 무조건 덮어써서 Model 모드 도넛이 즉시 사라지던 문제. `chart.js`에 `setSourceData(kind, data)` SSoT를 도입하여 두 종류 데이터를 모듈 내부에 보관하고, 활성 모드에 맞는 데이터만 화면에 반영하도록 캡슐화.
- 외부 캐시 변수(`_modelUsageCache`, `_typeDataCache`) 제거 — chart.js가 단일 책임으로 모드/데이터 동기화를 담당.

## Phase 2 변경 범위

### HTML (`packages/web/index.html`)
- `.header-stats` 블록을 `.header`에서 제거
- `#chartSection`의 `.view-section-header` 내부에 stats 블록 삽입:
  - 기존 `.chart-default-meta`("요청 추이" 라벨 + "최근 30분" 부제) 다음에 `.header-stats` 위치
  - `.chart-actions` 우측 정렬 버튼 그룹 보존
- 헤더는 다시 단순화: `[.header-left(로고+LIVE) | .header-right(날짜필터+갱신)]`

### CSS
- `header.css`:
  - `.header-stats` / `.header-stat*` / 관련 상태 클래스 정의 제거 (이동)
  - 헤더 반응형 미디어쿼리에서 stats 우선순위 노출 로직 제거
  - 헤더는 다시 단순한 좌/우 분할로 복귀
- `default-view.css` (또는 신규 분리):
  - `.view-section-header` 내부에 stats가 들어가도록 레이아웃 보강
  - chart-default-meta + stats + chart-actions 한 행 정렬 (gap, flex-wrap 정책)
  - **클래스명은 `.header-stat*` 그대로 유지** — api.js 셀렉터 호환 + 기존 시각 SSoT 보존
  - `#chartSection.chart-mode-detail .header-stats { display: none }` — detail 모드 가시성 제어
- 반응형:
  - `≤ 1024px` — chart-default-meta 부제 단축 + stats Volume 그룹 라벨 단축
  - `≤ 768px` — Volume 그룹 숨김
  - `≤ 480px` — Performance 그룹 숨김 (Hero만)

### JS
- 변경 최소화:
  - `api.js`의 `closest('.header-stat')` 그대로 호환 (클래스명 유지 결정으로 무수정)
  - `stat-tooltip.js` 무수정 (속성 셀렉터 기반)

## Phase 2 단계별 계획

### 단계 1 — 도넛 Model 모드 버그 수정 (Hot fix)
**Status: 완료** (2026-04-26)
- `chart.js`에 `setSourceData(kind, data)` / `hasSourceData(kind)` SSoT 추가
- 두 종류(`type` / `model`) 데이터를 chart 모듈 내부에 보관
- `setDonutMode(mode)` 호출 시 활성 데이터셋이 자동 전환
- `setTypeData(data)`는 후방 호환 — 내부적으로 `setSourceData('type', data)` 위임 (api.js, session-detail.js 무수정)
- main.js의 외부 캐시 변수 제거, fetchDashboard 폴링이 model 모드 도넛을 덮어쓰지 않음

### 단계 2 — ADR-004 작성 (Phase 1 ADR-001 일부 supersede)
- header-stats 위치를 헤더에서 view-section-header로 변경하는 결정 기록
- ADR-001 Status를 "Superseded by ADR-004 (위치만 변경)"으로 갱신
- 클래스명/상태 클래스/data 속성 SSoT는 ADR-003 그대로 유지

### 단계 3 — Tasks 추가 (T7~T11)
- T7: `.header-stats` HTML을 `.view-section-header`로 이전 (기존 view-section-header 보강)
- T8: CSS 정의 이동 (header.css → default-view.css 또는 신규 view-stats 영역)
- T9: detail 모드 가시성 처리 (`.chart-mode-detail .header-stats { display: none }`)
- T10: 반응형 재조정 (1024/768/480)
- T11: screen-inventory / design-system 재현행화

### 단계 4 — 구현
ui-designer 스킬 Phase 4 워크플로우에 따라 구현.

### 단계 5 — 문서 현행화
- screen-inventory.md "화면 0 — 헤더"에서 header-stats 흡수 부분 제거
- "화면 1 — 대시보드 기본 뷰"의 1-1(요청 추이) 섹션에 stats chip 추가 명시
- design-system.md "Header Stats" 섹션을 "View-Section Stats" 또는 "Section Stats Chip"으로 개명 + 위치 변경 반영

## Phase 2 완료 기준

- [x] 헤더가 `[.header-left | .header-right]` 단순 구조로 복귀
- [x] stats chip이 `#chartSection .view-section-header` 안에 표시
- [x] default 모드에서 stats 정상 표시
- [x] detail 모드 진입 시 stats 자동 숨김 + 세션 메타 표시
- [x] api.js / stat-tooltip.js / 상태 클래스 동작 무변경
- [x] 도넛 Model 토글 정상 동작 (Hot fix)
- [x] 반응형 1024/768/480 동작
- [x] screen-inventory.md / design-system.md 재현행화

---

# Phase 3 — 2단 위계 재설계 (Two-Tier Stats Hierarchy) (2026-04-26 follow-up)

## 사용자 피드백

> "header-stat-group의 컴포넌트들은 매우 중요합니다. 각각 유의미합니다.
> 하지만 지금 디자인적 요소로서 지금 너무 지저분하게 보입니다.
> UI가 너무 어지럽고 다시 UI 설계를 해주세요. 해당 부분에 해당 컴포넌트를 어떻게 하면 잘 배치를 할지, 상세히 고민하고 작업해두세요."

7개 stat 정보 손실 없이 유지하되, **시각 위계 재설계 + 패러다임 전환**으로 어지러움을 해소해야 함.

## 어지러움 원인 진단 (sequential-thinking 분석)

`view-section-header` 한 줄에 약 13개 시각 토큰이 동시 존재:
- `chart-default-meta` 2 (라벨+부제) + `header-stats` 10 (7 chip + 2 divider + 1 Hero 그라디언트) + `chart-actions` 1

진단된 8가지 원인:

1. **수평 정보 토큰 폭주** — 13 토큰은 Miller's law(7±2) 임계를 명백히 초과. 한 행에서 시선이 안착할 곳을 못 찾음.
2. **위계 평탄화** — Hero(font-body 13px) vs Secondary(font-meta 11px)의 차이가 2px에 불과. Hero가 Hero답지 않다.
3. **반복된 라벨 노이즈** — 7개 uppercase 라벨이 같은 행에서 7번 반복 → 라벨/값 시각 리듬이 단조롭게 7회 반복.
4. **divider 시각 노이즈** — 1px × 18px 세로선 2개가 시선을 두 번 끊는다. 그룹화 의도와 별개로 시각적으로 거슬림.
5. **`chart-default-meta`와 stats 경합** — 정적 라벨("요청 추이 (실시간)" + 부제)과 동적 5초 갱신 stats가 같은 baseline에서 충돌.
6. **Hero 그라디언트 배경의 결속 파괴** — Hero 그룹에만 미세 그라디언트가 있어 다른 그룹과 시각 결속이 끊긴다. chip 배경 처리 불일치.
7. **Volume Heavy 우측 쏠림** — 큰 숫자(세션 / 요청 / 토큰)가 우측 끝에 몰려 시선이 우측으로 쏠리고 좌측 Hero가 묻힘.
8. **`chart-actions` 충돌** — Volume 우측 끝의 큰 숫자와 우측 접기 버튼이 가까워 시각 경계가 약하다.

핵심 진단: **"7개 chip을 1행 평탄 나열한 구조 자체"가 문제**. Hero를 진짜 Hero로 만들지 못한다. 단순 padding/margin 조정으로는 해결 불가 — **레이아웃 패러다임 전환** 필요.

## 옵션 비교 (ASCII Mockup + 평가)

### 옵션 A — 그룹별 카드/세그먼트(Pill segment)

```
│ 요청 추이 (실시간) · 최근 30분                                       [⌄] │
│ ┌Hero──────────┐ ┌Performance────┐ ┌Volume────────────────────┐         │
│ │● 7  0.5%     │ │ 1.2s   3.4s    │ │ 142    1.2k    8.4M       │         │
│ │  활성 오류율 │ │ 평균   P95     │ │ 세션   요청    토큰       │         │
│ └──────────────┘ └────────────────┘ └──────────────────────────┘         │
```
- 정보 손실: 0
- 장점: 그룹 시각 명확. divider 제거 가능.
- 단점: **카드 안에 카드** 구조. Insights 카드를 삭제한 의도(시각 노이즈 감소)와 정면 모순. 박스 천국으로 새 어지러움.
- 판정: **기각**

### 옵션 B — Hero 강조 + 나머지 접기/탭/툴팁

```
│ ● 7 활성   0.5% 오류율                       [세부 통계 ▼] [⌄]        │
│ ─────────────────────────────────────────────────────────────────       │
│ (펼친 상태) 평균1.2s P95 3.4s 세션142 요청1.2k 토큰8.4M                  │
```
- 정보 손실: 기본 상태에서 5개 숨김
- 장점: 평소 화면 압도적 정리, Hero 명확.
- 단점: 사용자가 "각 stat은 모두 유의미"라고 명시 → 기본 접기는 정보 가치 손상. 클릭 1회 추가.
- 판정: **기각** (사용자 요구 위반)

### 옵션 C — 도넛 차트와 통합 (좌우 컨텍스트 stats)

```
│ 요청 추이 (실시간)                                                  [⌄] │
├─────────────────────────────────────────────────────────────────────────┤
│                  ●7 활성                                                  │
│ [timeline ───]  0.5% 오류율   [donut]   142 세션  [cache panel]          │
│                  1.2s 평균              1.2k 요청                          │
│                  3.4s P95                8.4M 토큰                         │
```
- 정보 손실: 0
- 장점: 시각화와 stats 결합, 정보 결속.
- 단점: timeline 폭 손실. Hero/Performance/Volume 위계가 도넛 모드 토글과 시각 충돌. 5초 갱신이 차트 영역 산만 유발.
- 판정: **기각**

### 옵션 D — 단일 컴팩트 바 (subtle 구분, 색상 최소화)

```
│ 요청 추이 (실시간)                                                  [⌄] │
│ ●7 활성 · 0.5% 오류율 · 1.2s 평균 · 3.4s P95 · 142 세션 · 1.2k 요청 · 8.4M 토큰 │
```
- 정보 손실: 0
- 장점: divider 0, 시각 노이즈 최소.
- 단점: 7개 모두 평탄 → Hero 강조 불가. 사용자 의도(Hero 우선 인지)와 충돌.
- 판정: **기각**

### 옵션 E — KPI 보드 그리드 (차트 위 카드 7장)

```
│ 요청 추이 (실시간)                                                  [⌄] │
├─────────────────────────────────────────────────────────────────────────┤
│ ┌Hero───┐ ┌Hero───┐ ┌Sub─┐ ┌Sub─┐ ┌Sub─┐ ┌Sub─┐ ┌Sub─┐                  │
│ │ 7     │ │ 0.5%  │ │1.2s│ │3.4s│ │142 │ │1.2k│ │8.4M│                  │
│ │ 활성  │ │ 오류율│ │평균│ │ P95│ │세션│ │요청│ │토큰│                  │
│ └───────┘ └───────┘ └────┘ └────┘ └────┘ └────┘ └────┘                  │
│ [timeline]                          [donut]              [cache panel]   │
```
- 정보 손실: 0
- 장점: KPI 보드 명확, 위계 카드 크기로 표현.
- 단점: 7개 카드 모두 박스화 → 카드 천국. Insights 카드 제거 의도와 정면 충돌. 세로 공간 회수 효과 무력화.
- 판정: **기각**

### 옵션 F — 좌측 수직 레일 (chart 좌측에 stats stack)

```
│ ● 7    │ 요청 추이 (실시간) · 최근 30분                          [⌄]   │
│ 활성   │─────────────────────────────────────────────────────────────  │
│        │                                                                 │
│ 0.5%   │ [timeline 그래프]                                                │
│ 오류율 │                                                                 │
│ 1.2s   │                                                                 │
│ 평균   │                                                                 │
│ ...    │                                                                 │
```
- 정보 손실: 0
- 장점: 수직 레일로 chart 폭 보존, 시각 분리 명확.
- 단점: chartSection grid 재설계 필요(도넛 패널/캐시 패널과 충돌). timeline 폭 손실. 모바일 대응 까다로움.
- 판정: **기각** (구조 변경 폭 큼)

### 옵션 G — 2단 위계 (Hero In-Title / Secondary Strip) ★

```
┌─ chartSection ──────────────────────────────────────────────────────────┐
│ 요청 추이 (실시간) · 최근 30분                                  [⌄]    │ ← Title row (정적)
│                                                                          │
│ ●  7  활성              0.5%  오류율                                    │ ← Hero row (font-hero 24px)
│ ─────────────────────────────────────────────────────────────────────── │
│ 1.2s 평균   3.4s P95   142 세션   1.2k 요청   8.4M 토큰                │ ← Secondary strip (font-body 13px)
├─────────────────────────────────────────────────────────────────────────┤
│ [timeline]                       [donut]              [cache panel]      │
└─────────────────────────────────────────────────────────────────────────┘
```
- 정보 손실: 0
- 장점:
  - Hero font-hero(24px) — Phase 2 font-body(13px) 대비 약 1.85배 시각 면적. **압도적 위계**.
  - divider 2개 / 그룹 그라디언트 모두 제거 — 어지러움 원인(4)·(6) 직접 해소
  - 행 분리 chunking으로 Hero 2 / Secondary 5 → 각 행이 7±2 적합. 시각 인지 안정.
  - 값 → 라벨 순(큰 숫자 먼저) — 시선 흐름 명료화
  - 신규 토큰 0, `.header-stat*` SSoT 유지 → JS 무수정
  - detail 모드 자동 숨김 (기존 `.chart-mode-detail` 패턴 재사용)
  - 반응형 자연: 1024(부제 단축) / 768(Volume 숨김) / 480(Secondary 전체 숨김, Hero만)
- 단점: view-section-header 세로 높이가 약 40px → 약 88px(Title 28 + Hero 36 + Secondary 24). 차트 영역 약 48px 줄어듦 — **수용 가능한 trade-off** (사용자가 "패러다임 자체를 재고" 명시).
- 판정: **채택** (1순위)

### 옵션 H — Sparkline 통합 (시각화 강화)

```
│ 요청 추이 (실시간)                                                  [⌄] │
│ ●7 활성 ████▁▁  0.5% 오류율 ▃▃▂▂  1.2s 평균 ▅▅▂▂  3.4s P95 ▇▇▃▂ ...    │
```
- 정보 손실: 0 (오히려 추세 추가)
- 장점: 추세까지 함께 보임.
- 단점: sparkline 데이터 신규 fetch 필요(서버 작업 폭증). 정보 밀도 폭주 → 또 다른 어지러움. 작업 범위 폭증.
- 판정: **기각** (작업 범위)

### 종합 비교표

| 옵션 | 정보 손실 | 위계 | 노이즈 | chart 균형 | 반응형 | SSoT 유지 | 채택 |
|------|----------|------|--------|----------|--------|----------|------|
| A 카드/세그먼트 | 0 | 약 | 약 (카드 in 카드) | 양호 | 보통 | 부분 | × |
| B Hero+접기 | 5개 숨김 | 강 | 강 | 양호 | 양호 | 부분 | × (요구 위반) |
| C 도넛 통합 | 0 | 약 | 약 | 약 | 약 | 부분 | × |
| D 컴팩트 바 | 0 | 없음 | 강 | 양호 | 양호 | 유지 | × (Hero 불가) |
| E KPI 그리드 | 0 | 강 | 약 (카드 천국) | 약 | 약 | 부분 | × |
| F 수직 레일 | 0 | 강 | 양호 | 약 (폭손실) | 약 | 새 구조 | × |
| **G 2단 위계** | **0** | **강 (1.85배)** | **강 (divider 0, gradient 0)** | **양호** | **자연** | **유지** | **✅ 채택** |
| H Sparkline | 0 | 강 | 보통 | 보통 | 약 | 부분 | × (작업 폭증) |

## 옵션 G 채택 — 2단 위계

### 디자인 (ASCII Mockup)

**Before (Phase 2)**:
```
┌─ chartSection ─────────────────────────────────────────────────────────────────┐
│ [요청추이(실시간) 최근30분] [활성7][오류율0.5%]│[평균1.2s][P953.4s]│[세션142][요청1.2k][토큰8.4M] [⌄] │
├──────────────────────────────────────────────────────────────────────────────┤
│ [timeline]                              [donut]              [cache panel]    │
└──────────────────────────────────────────────────────────────────────────────┘
```

**After (Phase 3 옵션 G)**:
```
┌─ chartSection ──────────────────────────────────────────────────────────┐
│ 요청 추이 (실시간) · 최근 30분                                  [⌄ ✕] │ ← Title row (정적)
│                                                                          │
│ ●  7  활성              0.5%  오류율                                    │ ← Hero row (font-hero 24px)
│ ─────────────────────────────────────────────────────────────────────── │
│ 1.2s 평균   3.4s P95   142 세션   1.2k 요청   8.4M 토큰                │ ← Secondary strip (font-body 13px)
├─────────────────────────────────────────────────────────────────────────┤
│ [timeline]                       [donut]              [cache panel]      │
└─────────────────────────────────────────────────────────────────────────┘
```

### 위계 핵심

- **Hero (font-hero 24px / weight-hero 700)** — 활성 / 오류율. 압도적 시각 면적으로 시선 진입점
- **Secondary (font-body 13px / weight-strong 600)** — 평균 / P95 / 세션 / 요청 / 토큰. 컴팩트 strip, 한 번에 스캔
- **값 → 라벨 순** — 큰 숫자가 먼저 보이고 라벨은 보조. 시선 흐름 명료화
- **divider 0, 그룹 그라디언트 0** — 시각 노이즈 직접 제거
- **행 분리 1px border-top (Hero ↔ Secondary)** — 두 위계 시각 구분, divider보다 미세

### 채택 근거

1. Hero가 font-hero(24px)로 진짜 Hero — Phase 2 font-body 대비 약 1.85배 큰 시각 면적
2. divider 2개 / 그룹 그라디언트 모두 제거 — 어지러움 핵심 원인 직접 해소
3. 행 분리(2단)로 Hero 2 + Secondary 5 → 7±2 임계 적합. 시각 chunking 자연스러움
4. 폰트 크기 차이(24px vs 13px = 약 1.85배)로 위계 즉각 인지
5. detail 모드 자동 숨김 (`.chart-mode-detail` 기존 패턴 재사용)
6. 반응형 자연: 1024(부제 숨김) / 768(Volume 그룹 숨김) / 480(Secondary 전체 숨김, Hero만)
7. 신규 디자인 토큰 0, `.header-stat*` 클래스 SSoT 유지 → JS 무수정

## 영향 범위

### 코드
- `index.html`: `view-section-header` 내부를 `vsh-row` 3개(`--title`, `--hero`, `--secondary`)로 재구성. Hero 2개 + Secondary 5개로 분리. 값/라벨 순서 swap (값 먼저). `.header-stat-group--hero/--performance/--volume` / `.header-stat-divider` 제거.
- `default-view.css`: `#chartSection .header-stat*` 영역 전면 재작성. 신규 구조 클래스 `.vsh-row`, `.vsh-row--title`, `.vsh-row--hero`, `.vsh-row--secondary` 추가. detail 모드 숨김 / 반응형 갱신.
- JS: 변경 0 (api.js / stat-tooltip.js / chart.js 그대로)

### 문서
- `screen-inventory.md` Phase 3 섹션, 화면 1-1-H 갱신 (2단 위계 spec)
- `design-system.md` View-Section Stats Chip 섹션 갱신 (2단 디자인 도식)

## Phase 3 단계별 계획

### 단계 1 — ADR-006 작성
- 어지러움 진단 7가지 + 옵션 비교 + 옵션 G 결정
- ADR-001 (chip 그룹화), ADR-003 (`.header-stat-group*` 정의 일부 supersede)
- ADR-004 (위치 결정) Status 유지

### 단계 2 — Tasks T12~T16 추가
- T12: HTML 재구성 (vsh-row 3개, 값/라벨 swap, group/divider 제거)
- T13: CSS 재작성 (default-view.css `#chartSection .header-stat*` 영역 + vsh-row)
- T14: 반응형 재조정 (1024/768/480)
- T15: detail 모드 가시성 (`.chart-mode-detail .vsh-row--hero`, `.vsh-row--secondary` 숨김)
- T16: screen-inventory / design-system 재현행화

### 단계 3 — 구현
ui-designer 스킬 Phase 4 워크플로우.

### 단계 4 — 검증
- 화면 비교 (Before/After)
- 7개 stat 모두 표시 확인
- Hero 압도성 시각 확인
- 상태 클래스 동등 동작 확인
- detail 모드 / 반응형 확인

## Phase 3 완료 기준

- [x] 7개 stat 모두 표시 (정보 손실 0)
- [x] Hero font-hero(24px) 압도적 시각화
- [x] divider 0, 그룹 그라디언트 0
- [x] 활성 dot / 오류율 / critical 동등 동작
- [x] stat-tooltip data 속성 호환 (api.js / stat-tooltip.js 무수정)
- [x] detail 모드 자동 숨김
- [x] 반응형 1024/768/480 동작
- [x] screen-inventory / design-system 재현행화
- [x] CSS 변수만 사용 (신규 토큰 0)

> **Phase 3 사후 평가 (2026-04-26)**: 위 체크리스트는 모두 통과했지만 **사용자 검토 결과 "더 어지러워졌다"는 강한 부정적 피드백**을 받음. 디자인 결정 자체가 틀렸음. Phase 4에서 자기비판 후 재설계.

---

# Phase 4 — Stats Distribution to Natural Habitat (자연스러운 거처로의 분산) (2026-04-26 follow-up)

## 사용자 피드백 (Phase 3 결과에 대한 부정적 평가)

> "view-section-header 헤더 자체엔 '요청 추이'라는 타이틀만 남기고, 각 정보들을 cache-panel-overall 패널에 넣는건 어떻게 생각해? 너가 진짜 이게 정말 맞다고 생각하는거야? 너무 더 디자인이 이상해졌어. 상세히 검토 다시해. 회의를 통해 3라운드 진행하고, 각 정보들이 어디 영역에 배치하면 좋을지 다시 생각해봐. 너무 지저분해."

핵심 메시지:
- ADR-006(2단 위계)이 오히려 더 어지러워졌다
- view-section-header에 stats를 통째로 두는 발상 자체를 의심
- "요청 추이" 타이틀만 남기고 stats는 다른 곳으로 분산 제안
- 3라운드 회의 요구

## ADR-006 자기비판 (정직한 진단)

표면적 검증(Miller's law 해소 / 위계 강화 / divider 제거)은 맞았지만, 더 큰 그림에서 다음 실수:

1. **chartSection 비대화** — view-section-header 약 40px → 약 88px. 차트 본체(timeline + donut + cache panel)가 들어갈 자리를 헤더가 잡아먹었다.
2. **위계 역전** — Hero font-hero(24px) 두 개가 차트 헤더 안에 들어가니, 헤더가 차트보다 시각 무게중심이 됐다. 차트 섹션의 본질은 차트인데, 헤더가 차트보다 무거우면 위계가 거꾸로다.
3. **stats를 헤더의 본질로 오해** — view-section-header의 본질은 "이 섹션이 무엇인가"를 알리는 것(요청 추이). stats는 별개 정보. 헤더에 통째로 두는 발상 자체가 잘못이었다.
4. **"각각 유의미"의 잘못된 해석** — 사용자가 "각 stat은 모두 유의미"라 했을 때, 이는 "각자 자기 자리가 있어야 한다"는 뜻. 나는 "한 곳에 모아 위계로 정렬하라"로 잘못 해석했다.
5. **자기검열 부재** — ASCII mockup만 보고 옵션 G가 "1순위"라는 형식 논리에 갇혔다. 실제 화면의 시각 비율과 무게 임팩트를 보지 못했다.

**근본 진단**: ADR-001/004/006 모두 "stats를 어디에 통째로 둘까"의 답을 찾았는데, 진짜 답은 **"통째로 두지 말고 각자의 거처로 분산"**.

## Round 1 — 진단 회의 ("왜 이상하게 보였는가")

전문가 페르소나 3명:
- **A — 정보 아키텍트**
- **V — 시각 디자이너**
- **U — UX 연구자**

**A**: "ADR-006이 어지러운 진짜 이유는 7개 stat이 모두 view-section-header라는 한 컨테이너에 속한다는 가정. 정보 아키텍처로 7개를 분류하면 3카테고리:
- 활성 세션 = 시스템 상태(state)
- 오류율 / 평균 / P95 = 요청 품질(quality, timeline 부속)
- 세션 / 요청 / 토큰 = 볼륨(volume, 누적치)
각 카테고리는 다른 거처가 있어야 자연스럽다."

**V**: "ADR-006의 시각 실패 추가 진단: Hero 24px가 너무 컸다. 24px font-hero는 단일 KPI 카드용 크기다. 차트 위 헤더 안에 24px 두 개가 들어가면, 차트 자체보다 헤더가 시각 무게중심이 된다. 위계 역전. 해결 방향은 명확 — 헤더를 가볍게(요청 추이 타이틀만), stats는 자기 시각 무게에 어울리는 위젯과 결합."

**U**: "사용자가 'header-stat-group의 컴포넌트들은 매우 중요. 각각 유의미'라고 한 것 + 'cache-panel-overall에 넣어'라고 한 것을 합치면 — 사용자는 stats가 '다른 정보의 컨텍스트가 되어야 한다'고 본다. 단독 KPI가 아니라 컨텍스트 정보. 'cache-panel을 볼 때 hit rate 80%만 보지 말고, 오늘 8.4M 토큰 처리하는 시스템이 80% hit rate이라는 풍부한 맥락'이 필요. 다만 모두 cache에 몰면 cache-panel이 거대해진다. 카테고리별 분산이 맞다."

**Round 1 결론**:
1. ADR-006이 어지러운 진짜 이유 = stats를 한 컨테이너에 모은 발상 자체가 틀림
2. view-section-header에 "요청 추이" 타이틀만 남기는 건 옳다
3. stats는 분산이 맞다. cache-panel은 후보 1순위지만 거기에 다 넣으면 안 된다

## Round 2 — 분배 회의 ("각 stat의 자연스러운 거처")

7개 stat을 하나씩 토론.

### 1. 활성 세션
- **A**: 시스템 전역 상태. timeline 시간축과 다름.
- **U**: LIVE 배지와 의미 비슷. "지금 동작 중"의 시그널. `LIVE · 7세션` 형태.
- **V**: 글로벌 상태이므로 글로벌 헤더 영역(.header-left .badge-live)에 흡수가 자연스럽다. dot 모양도 LIVE의 dot과 의미가 겹쳐 충돌이 아니라 강화.
- **결정**: **글로벌 헤더 LIVE 배지에 통합** (`●LIVE · 7`)

### 2. 오류율
- **A**: timeline 데이터의 직접 부속. 시계열의 점들 중 몇 %가 에러인지 요약.
- **V**: critical 상태(>1%) 시 timeline의 빨간 점/배지와 시각 결합 자연스럽다.
- **U**: 사용자가 timeline을 볼 때 "에러 얼마나 났지?"는 자연스러운 행위.
- **결정**: **timeline 영역의 meta inline**

### 3·4. 평균 + P95
- **A**: 요청 처리 성능 = timeline의 부속.
- **U**: timeline을 볼 때 "평균 응답 얼마지?", "P95 얼마지?"는 자연스러운 흐름.
- **V**: 오류율과 같은 영역에 둔다. timeline 위에 한 줄 — `평균 1.2s · P95 3.4s · 오류 0.5%`.
- **결정**: **timeline 영역의 meta inline (오류율과 함께)**

### 5·6·7. 세션 / 요청 / 토큰
- **U**: cache-panel은 "얼마나 캐시했나"인데, 거기에 "오늘 처리한 총 토큰/요청/세션" 컨텍스트가 붙으면 캐시 효과의 절대값을 가늠 가능.
- **V**: cache-panel-overall은 현재 3 cache-section. 추가만 하면 거대해진다(사용자 우려).
- **A**: cache-panel-overall 재구성으로 접근. 'Today Summary'로 격상. 'Volume 라인'을 cache section과 분리해 위 또는 좌측에 배치.
- **A**: 토큰은 cache 정보와 의미적으로 가장 가까움(cost 섹션이 토큰 단위). 세션/요청은 절대 컨텍스트로 묶어 'Volume'.
- **결정**: **cache-panel-overall의 Volume row로 통합** (cache-panel을 'Today Summary'로 격상)

## Round 3 — 통합 회의 ("최종 배치 검증")

매핑을 chartSection 전체 레이아웃에서 검증.

### 시각 무게 분포
- view-section-header: 28~32px (라벨 + 부제 + actions)
- timeline meta: 14~16px (font-meta)
- charts-inner: 100px+ (timeline 64 + donut 80~90)
- cache-panel(Today Summary): Volume 28~32 + cache 52 = 76~80px
- 총 chartSection 약 220~240px (ADR-006 대비 비슷하거나 약간 줄어듦)
- **핵심**: 시각 무게가 stats가 아닌 차트(timeline + donut)로 돌아간다. 위계 정상화.

### 자기검열 라운드 (의심 7가지)

1. timeline meta가 새 어지러움? → 차트 부속 컨텍스트로 인지되어 자막 같은 위치. 어지러움 아님.
2. cache-panel을 'Today Summary'로 격상하면 정체성 흐려짐? → 확장. Volume + 캐시 효율은 모두 "오늘의 활동" 묶음.
3. LIVE 배지가 비대화? → `●LIVE · 7` 약 11~12자. 여전히 컴팩트.
4. cache-panel-overall에 안 넣고 분산하면 사용자 의도 위반? → 사용자가 "어떻게 생각해?"라고 물었고, 추가 지시에서 "cache-panel-overall이 거대해지는 것을 경계"라고 직접 언급. 분산이 사용자 의도에 더 충실.
5. view-section-header에 진짜 타이틀만? → 사용자 제시안의 본질.
6. 7개 stat 모두 정보 손실 없이? → 모두 매핑 완료.
7. ADR-001/004/006 supersede가 큰 변경? → 반복되는 디자인 결정 실패의 종착점. 사용자 피드백 재학습 결과.

### Round 3 결론

| stat | 거처 | 시각 처리 |
|------|------|-----------|
| 활성 세션 | 글로벌 헤더 `.badge-live` | `●LIVE · 7` (chip이 LIVE 배지 안 통합) |
| 오류율 | timeline 영역 `.timeline-meta` | `0.5% 오류율` (font-meta inline) |
| 평균 응답 | timeline 영역 `.timeline-meta` | `1.2s 평균` |
| P95 | timeline 영역 `.timeline-meta` | `3.4s P95` |
| 세션 수 | cache-panel-overall `.cps-volume` | `142 세션` (Volume row) |
| 요청 수 | cache-panel-overall `.cps-volume` | `1.2k 요청` |
| 토큰 | cache-panel-overall `.cps-volume` | `8.4M 토큰` |

**view-section-header에 남는 것**: "요청 추이 (실시간)" + 부제 + chart-actions(접기/닫기). vsh-row* 모두 폐기.

## Before (ADR-006) → After (ADR-007) ASCII Mockup

### Before (Phase 3 ADR-006 — 2단 위계, 어지러움)

```
┌─ HEADER 52px : Claude Spyglass    ●LIVE             전체 오늘 이번주 방금 ─┐
├─────────────────────────────────────────────────────────────────────────────┤
│  CHART SECTION                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │ 요청 추이 (실시간) · 최근 30분                              [⌄]    │  │
│  │                                                                      │  │
│  │ ●  7   0.5%                  ← Hero 24px (시각 무게 폭발)           │  │
│  │   활성  오류율                                                         │  │
│  │ ─────────────────────────────────────────────────────────────────── │  │
│  │ 1.2s 3.4s 142  1.2k 8.4M    ← Secondary strip                       │  │
│  │ 평균 P95 세션 요청 토큰                                               │  │
│  ├─────────────────────────────────────────────────────────────────────┤  │
│  │ [timeline ────────]  [donut]                                         │  │
│  │ [cache panel: Hit Rate / Cost / Creation·Read]                       │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### After (Phase 4 ADR-007 — 자연스러운 거처로 분산)

```
┌─ HEADER 52px : Claude Spyglass    ●LIVE · 7        전체 오늘 이번주 방금 ─┐
│                                          ↑                                  │
│                                  활성 세션 통합                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  CHART SECTION                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │ 요청 추이 (실시간) · 최근 30분                              [⌄] [✕] │  │ ← 비움
│  ├─────────────────────────────────────────────────────────────────────┤  │
│  │ 1.2s 평균 · 3.4s P95 · 0.5% 오류율           ← timeline-meta        │  │
│  │ ┌──────────────────────────────────┬──────────┬────────────┐        │  │
│  │ │ [timeline canvas]                │ [donut]  │ legend     │        │  │
│  │ └──────────────────────────────────┴──────────┴────────────┘        │  │
│  │                                                                      │  │
│  │  TODAY SUMMARY (cache-panel-overall 격상)                            │  │
│  │  ┌────────────────────────────────────────────────────────────────┐ │  │
│  │  │ 오늘  142 세션 · 1.2k 요청 · 8.4M 토큰          ← cps-volume   │ │  │
│  │  ├────────────────────────────────────────────────────────────────┤ │  │
│  │  │ Hit Rate 80% │ Cost no:6.2k actual:4.1k saved:2.1k │ Cre/Read │ │  │
│  │  │              │                                     │ 30/70%   │ │  │
│  │  └────────────────────────────────────────────────────────────────┘ │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

**개선점**:
- view-section-header가 진짜로 가벼워짐 (라벨 + actions 한 줄)
- 시각 무게 중심이 차트로 돌아감 (timeline + donut)
- 각 stat이 자기 의미와 가까운 영역에 안착
- 'Today Summary' 정체성으로 cache-panel 격상

## Phase 4 단계별 계획

### 단계 1 — ADR-007 작성
- Round 1/2/3 회의록 발언 형식 기록
- 7개 stat 분배 매핑 + 시각 처리 명세
- ADR-001/004/006 명시적 Supersede

### 단계 2 — Tasks T17~T22 추가
- T17: index.html 재구조화
- T18: default-view.css의 vsh-row* 정의 모두 제거 + timeline-meta 정의 추가
- T19: header.css에 LIVE 배지 chip 통합 CSS
- T20: cache-panel.css에 cps-volume + cps-cache wrapper CSS
- T21: detail 모드 가시성 + 반응형 정리
- T22: screen-inventory.md / design-system.md 재현행화

### 단계 3 — 구현
ui-designer 스킬 Phase 4 워크플로우.

## Phase 4 완료 기준

- [x] view-section-header가 "요청 추이" 라벨 + 부제 + chart-actions만 보유
- [x] vsh-row* / .header-stat--hero / .header-stat-group* / .header-stat-divider 클래스 0건 (grep 검증)
- [x] 활성 세션이 `.badge-live`에 통합 (`●LIVE 5` Playwright 검증)
- [x] 오류율 / 평균 / P95가 timeline 영역의 meta로 표시
- [x] 세션 / 요청 / 토큰이 cache-panel-overall의 Volume row로 표시
- [x] 7개 stat 모두 정보 손실 없이 표시
- [x] DOM ID 8종 + `data-stat-tooltip` 보존 (api.js / stat-tooltip.js 무수정)
- [x] 상태 클래스(is-active-indicator / is-error / is-critical) 동등 동작
- [x] detail 모드 자동 가시성 처리 (timeline-meta 숨김, cps-volume 유지, chart-detail-meta 표시)
- [x] 반응형 1024/768/480 모두 동작
- [x] 신규 디자인 토큰 0
- [x] screen-inventory.md / design-system.md 재현행화

> **추가 보강**: LIVE 배지 chip 보존을 위해 infra.js에 `setLiveStatus(connected)` helper 추가. api.js/infra.js의 `showError`/`clearError`가 `liveBadge.innerHTML`을 통째 덮어쓰던 동작을 helper로 캡슐화 — chip DOM(`#statActive` / `#activeCard`)이 보존되어 fetchDashboard 재호출 시 null 참조 에러 해소.

---

# Phase 5 — Cleanup & Consolidation (2026-04-26 follow-up)

## 사용자 피드백 (정리 요청 4종)

1. cache-mode-toggle 영역 제거 (다른 의존성 없으면)
2. donut-meta는 model만 의미 있음. type 모드 제거 → model 기본 노출
3. cps-volume → timeline-meta 통합 + 재배치
4. view-section-header의 btn-close 제거

핵심 의도: **"필요 없는 것 모두 제거하고 시각을 더 정돈"**.

## 의존성 분석 (LSP/grep 검증 결과)

### A. cache-mode-toggle / cache-panel-matrix
- 사용처: main.js L653-693 (initCacheModeToggle, renderCacheMatrix), `fetchCacheMatrix` import L3
- DOM ID 의존: `cacheModeToggle`, `cachePanelMatrix`
- 외부 의존 0 — initCacheModeToggle / renderCacheMatrix는 다른 곳에서 호출 안 됨
- `fetchCacheMatrix` 사용처 1곳 (main.js)
- 서버 endpoint `/api/metrics/cache-matrix`는 유지 (다른 도구 재사용 가능성)
- **결론: 안전하게 제거 가능**

### B. donut-mode-toggle (TYPE 모드 제거 / MODEL 기본)
- 사용처: main.js L627-643 (initDonutModeToggle)
- chart.js: `setSourceData(kind)` / `setDonutMode(mode)` / `hasSourceData(kind)` / `getDonutMode()` SSoT
- api.js L91 `setTypeData((d.types || []).sort(...))` — fetchDashboard 폴링이 type 데이터 공급
- session-detail.js L129 `setTypeData(sessionTypeData)` — **세션 detail에서 type 분포 도넛 사용**
- 모드별 의미:
  - default: type 분포 → model 분포로 변경 (사용자 결정)
  - detail: 세션 단위 type 분포 (세션 안 prompt/tool_call/system 비율) — model로 대체 불가능 (세션은 보통 단일 모델)
- **결론: default→model / detail→type 자동 전환**. setDonutMode SSoT 유지하되 toggle 폐기. setChartMode가 자동 결정.

### C. btn-close (#btnCloseDetail)
- HTML L177 + detail-actions-sep L176
- main.js L298 click handler → `closeDetail()`
- `closeDetail()` 함수는 main.js L156 정의 + L551 (Esc 키) / L742 (로고 클릭)에서도 호출
- **결론: btn-close UI/separator/click handler 제거. closeDetail 함수는 유지** (Esc / 로고 트리거 보존).

### D. cps-volume → timeline-meta 통합
- HTML 위치 이동 + cache-panel-overall은 `cps-cache` wrapper만 남음
- 실질적으로 'Today Summary' 격상이 무효화 → cache-panel-overall 정체성 'cache 효율'로 복귀
- 6개 stat을 timeline-meta로 흡수 — 시각 위계 재배치 필요

## 6개 stat 재배치 설계 (timeline-meta)

옵션 비교:
- **A**: 한 줄 6개 inline — 단조, 그룹 위계 불명
- **B**: divider DOM 분리 — ADR-006 supersede 학습에 어긋남
- **C**: 좌(품질) / 우(볼륨) — justify-content: space-between, 두 그룹 시간 컨텍스트 다름 명시
- **D**: 두 줄 — chart-wrap 추가 잠식, 비대화 우려

**옵션 C 채택 + 그룹 라벨**:

```
[지난 30분]  평균  ·  P95  ·  오류율            [오늘]  세션  ·  요청  ·  토큰
└─ 윈도우 컨텍스트                              └─ 누적 컨텍스트
```

- 시간 범위 라벨로 두 그룹 의미 명확화 (timeline은 30분 윈도우 / 볼륨은 오늘 누적)
- 두 그룹 사이 큰 gap (justify-content: space-between)
- 좁은 폭: 자동 wrap → 품질 한 줄 / 볼륨 한 줄 graceful degradation
- divider DOM 0
- 그룹 라벨 클래스: `.timeline-meta-group` + `.timeline-meta-group-label` (cps-volume-label 패턴 차용)

## ADR-007 분배 매핑 갱신

| stat | 거처 (이전 ADR-007) | 거처 (Phase 5) |
|------|---------------------|----------------|
| 활성 세션 | `.badge-live` | **그대로 유지** |
| 오류율 | `.timeline-meta` | **그대로 유지** (품질 그룹) |
| 평균 응답 | `.timeline-meta` | **그대로 유지** (품질 그룹) |
| P95 | `.timeline-meta` | **그대로 유지** (품질 그룹) |
| 세션 수 | `.cps-volume` | **`.timeline-meta` 볼륨 그룹**으로 이동 |
| 요청 수 | `.cps-volume` | **`.timeline-meta` 볼륨 그룹**으로 이동 |
| 토큰 | `.cps-volume` | **`.timeline-meta` 볼륨 그룹**으로 이동 |

cache-panel-overall: 'Today Summary' 격상 폐기 → cache 효율 (Hit Rate / Cost / Creation·Read) 단일 책임 복귀.

## Before / After ASCII Mockup

**Before (Phase 4 ADR-007)**

```
┌─ chartSection ──────────────────────────────────────────────────────────┐
│ 요청 추이 (실시간) · 최근 30분                              [⌄] [✕]    │
├─────────────────────────────────────────────────────────────────────────┤
│ 평균 1.2s · P95 3.4s · 오류율 0.5%                                      │
│ ┌──────────────────────────────────┬──────────────┐                     │
│ │ [timeline canvas]                │ [donut TYPE] │ [TYPE | MODEL]      │
│ └──────────────────────────────────┴──────────────┘                     │
│ ┌─────────────────────────────────────────────────────────────────────┐│
│ │ 오늘 142 세션 · 1.2k 요청 · 8.4M 토큰              ← cps-volume     ││
│ ├─────────────────────────────────────────────────────────────────────┤│
│ │ Hit Rate │ Cost │ Creation/Read         [전체 | 모델별]              ││
│ └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
```

**After (Phase 5 ADR-008)**

```
┌─ chartSection ──────────────────────────────────────────────────────────┐
│ 요청 추이 (실시간) · 최근 30분                                  [⌄]    │ ← btn-close 제거
├─────────────────────────────────────────────────────────────────────────┤
│ [지난 30분] 평균 · P95 · 오류율           [오늘] 세션 · 요청 · 토큰       │ ← timeline-meta 통합
│ ┌──────────────────────────────────┬──────────────┐                     │
│ │ [timeline canvas]                │ [donut MODEL]│ ← model 기본, toggle 제거
│ └──────────────────────────────────┴──────────────┘                     │
│ ┌─────────────────────────────────────────────────────────────────────┐│
│ │ Hit Rate │ Cost │ Creation/Read              ← cache 효율 단일 책임  ││
│ └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
```

## Phase 5 단계별 계획

### 단계 1 — ADR-008 작성
- 4종 변경 결정 + ADR-005/007 정합성 정리
- ADR-007 매핑 표 갱신 (cps-volume → timeline-meta)
- ADR-005 SSoT 보강: setChartMode가 setDonutMode를 자동 호출하는 단방향 의존

### 단계 2 — Tasks T23~T28
- T23: cache-mode-toggle / cache-panel-matrix 제거 (HTML/CSS/JS/fetcher)
- T24: donut-mode-toggle 제거 + chart.js mode 자동화 (default→model, detail→type)
- T25: btn-close / detail-actions-sep 제거 + click handler 제거
- T26: cps-volume → timeline-meta 통합 + 그룹 재배치
- T27: cache-panel-overall 단순화 (cps-volume 제거 후 cps-cache 단일)
- T28: screen-inventory.md / design-system.md 현행화

### 단계 3 — 구현
ui-designer 스킬 Phase 4 워크플로우.

## Phase 5 완료 기준

- [ ] cache-mode-toggle / cache-panel-matrix DOM·CSS·JS 0건 (grep 검증)
- [ ] donut-mode-toggle DOM·CSS·JS 0건 (grep 검증)
- [ ] btn-close (#btnCloseDetail) DOM·CSS·click handler 0건
- [ ] detail-actions-sep DOM·CSS 0건
- [ ] cps-volume / cps-volume-label DOM·CSS 0건 (timeline-meta로 통합)
- [ ] cps-cache wrapper는 유지 (cache-panel-overall 단일 자식)
- [ ] timeline-meta 안에 6개 chip 모두 표시 (좌측 품질 3 + 우측 볼륨 3)
- [ ] 시간 컨텍스트 라벨 ("지난 30분", "오늘") 표시
- [ ] DOM ID 8종 + data-stat-tooltip 보존 (api.js / stat-tooltip.js 무수정)
- [ ] 도넛이 default 모드에서 MODEL 분포 표시
- [ ] 도넛이 detail 모드에서 type 분포 표시 (session-detail.js 호환)
- [ ] closeDetail() 함수는 유지 (Esc / 로고 트리거)
- [ ] fetchCacheMatrix 호출 0건
- [ ] 반응형 1024/768/480
- [ ] 신규 디자인 토큰 0
- [ ] screen-inventory / design-system 재현행화
