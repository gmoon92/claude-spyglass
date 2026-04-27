# Screen Inventory — Web 대시보드

> 디자이너 현행화 문서. 화면 구조·컴포넌트·디자인 상태를 추적합니다.
> **변경 발생 시 반드시 이 문서를 업데이트하세요.**

---

## 최종 현행화: 2026-04-27 (chart-section-filter-sync) — date-filter ↔ timeline-meta 라벨 동기화

기능: chart-section-filter-sync — 백엔드는 이미 `/api/dashboard?from=X&to=Y`의 6 stat을 동일 fromTs/toTs 윈도우로 일관 산출하지만, 프론트엔드 라벨이 하드코딩되어 데이터-라벨 거짓 정보 발생. 이를 SSoT 기반으로 동기화.

핵심 변경 (chart-section-filter-sync ADR-001/002/003):

- **timeline-meta 라벨 SSoT 캡슐화** (ADR-001): main.js에 `RANGE_LABELS = { all: '전체 기간', today: '오늘', week: '이번 주' }` 상수 + `applyRangeLabels(range)` 함수 도입. dateFilter 클릭 핸들러와 `init()`(첫 로드)에서 동일 함수 호출 — 호출처 어디에서 추가되어도 라벨 일관성 보장. 본질 prefix(`['품질', '누적']`)와 aria prefix(`['요청 품질', '누적 볼륨']`)도 함수 내부 상수로 캡슐화.
- **chartSubtitle 의미 고정** (ADR-002): `#chartSubtitle`은 timelineChart(클라이언트 sliding 30분 · 실시간)의 부제이므로 필터와 무관해야 함. main.js의 `subtitles = { all/today/week }` 매핑 + 갱신 코드 삭제. HTML 초기값 `최근 30분` → `최근 30분 · 실시간`으로 고정. dateFilter 클릭은 더 이상 chartSubtitle을 건드리지 않음.
- **timeline-meta 그룹 라벨 형식: "본질 · 범위"** (ADR-003): 두 그룹의 본질(품질 vs 누적)을 유지하면서 활성 윈도우를 보조 표시. 예: `품질 · 전체 기간` / `누적 · 전체 기간`. 필터 변경 시 범위 부분만 갱신("품질 · 오늘", "누적 · 이번 주" 등). aria-label도 같은 패턴: "요청 품질 (전체 기간)" / "누적 볼륨 (전체 기간)".
- **신규 클래스/토큰 0**: 기존 `.timeline-meta-group-label` 스타일 그대로 사용. CSS 변경 없음.
- **import 추가**: `getActiveRange` from `./api.js` (초기 로드 시 활성 범위 조회).

### Stat 윈도우 ↔ 라벨 매핑 (filter sync 후)

| stat | DOM | 위치 | 라벨 동작 |
|------|-----|------|-----------|
| 평균 응답 / P95 / 오류율 | `statAvgDuration`, `stat-p95`, `stat-error-rate` | `.timeline-meta-group` (idx 0) | `품질 · {활성 범위}` — applyRangeLabels에서 갱신 |
| 세션 / 요청 / 토큰 | `statSessions`, `statRequests`, `statTokens` | `.timeline-meta-group` (idx 1) | `누적 · {활성 범위}` — applyRangeLabels에서 갱신 |
| timelineChart 부제 | `#chartSubtitle` | `.chart-default-meta` | **고정**: `최근 30분 · 실시간` (필터와 무관) |

상세: `.claude/docs/plans/chart-section-filter-sync/{plan.md, adr.md, tasks.md}`

## 이전 현행화: 2026-04-26 (header-summary-merge Phase 5) — Cleanup & Consolidation (ADR-008)

ADR-007 적용 후 사용자 4종 정리 요청. 핵심 의도: "필요 없는 것 모두 제거하고 시각을 더 정돈".

핵심 변경 (ADR-008):

- **cache-mode-toggle / cache-panel-matrix 완전 제거**: cache-panel-overall은 `Hit Rate / Cost / Creation·Read` 단일 책임으로 복귀. fetchCacheMatrix / renderCacheMatrix / initCacheModeToggle / cache-matrix-* 클래스 모두 제거. 서버 endpoint `/api/metrics/cache-matrix`는 유지 (다른 도구 재사용).
- **donut-mode-toggle 제거 + MODEL 기본**: TYPE/MODEL 토글 폐기. setChartMode가 모드 자동 결정 — `default → setDonutMode('model')` + (캐시 미스 시) `fetchModelUsage` / `detail → setDonutMode('type')` (session-detail.js 호환). chart.js의 `donutMode` 초기값 `'model'`로 변경. SSoT(setSourceData/setDonutMode/hasSourceData/getDonutMode)는 유지.
- **cps-volume → timeline-meta 통합 (그룹 재배치)**: cps-volume DOM/CSS 모두 제거. timeline-meta가 두 그룹으로 재구성 — `[지난 30분] 평균·P95·오류율` (좌, 품질) + `[오늘] 세션·요청·토큰` (우, 볼륨). `justify-content: space-between` + `flex-wrap: wrap`. divider DOM 0. 좁은 폭에서 자동 wrap (graceful degradation: 품질 한 줄 / 볼륨 한 줄).
- **btn-close / detail-actions-sep 제거**: view-section-header가 `[⌄] 접기` 버튼만 보유. closeDetail 함수는 유지 (Esc 키 / 로고 클릭 트리거 보존).
- **cache-panel-overall 'Today Summary' 격상 폐기**: ADR-007의 cps-volume 격상은 cps-volume 이동으로 자연 폐기. `display: column flex` → 다시 horizontal flex (3 cache-section 병렬).
- **신규 클래스**: `.timeline-meta-group`, `.timeline-meta-group-label`
- **폐기 클래스**: `.cache-mode-toggle`, `.cache-mode-btn`, `.cache-panel-matrix`, `.cache-matrix-row/name/bar*/rate`, `.donut-mode-toggle`, `.donut-mode-btn`, `.btn-close`, `.detail-actions-sep`, `.cps-volume`, `.cps-volume-label`, `.cps-cache`
- **유지 SSoT (변경 0)**: `.header-stat*` 시각 클래스, 상태 클래스, DOM ID 8종, `data-stat-tooltip`, chart.js setSourceData/setDonutMode/hasSourceData/getDonutMode SSoT. **api.js / stat-tooltip.js 무수정**.
- **신규 토큰 0**.

### ADR-007 분배 매핑 갱신

| stat | 거처 (ADR-007) | 거처 (ADR-008) |
|------|----------------|----------------|
| 활성 세션 | `.badge-live` | 변경 없음 |
| 오류율 / 평균 / P95 | `.timeline-meta` | `.timeline-meta .timeline-meta-group` (품질 · 활성 범위) |
| 세션 / 요청 / 토큰 | `.cps-volume` (cache-panel) | **`.timeline-meta .timeline-meta-group` (누적 · 활성 범위)** |

> chart-section-filter-sync 이후: "지난 30분" / "오늘" 하드코딩 라벨은 폐기되고, 활성 date-filter 윈도우와 동기화되는 동적 라벨("품질 · 전체 기간" 등)로 대체.

상세: `.claude/docs/plans/header-summary-merge/{plan.md (Phase 5), adr.md (ADR-008), tasks.md (T23~T28)}`

## 이전 현행화: 2026-04-26 (header-summary-merge Phase 4) — Stats Distribution to Natural Habitat (ADR-007)

Phase 3(2단 위계, ADR-006) 적용 후 사용자 검토 결과 "더 어지러워졌다. 정말 맞다고 생각하는거야?"라는 부정적 평가. **ADR-006 자체가 틀린 결정**임을 자기비판하고, 3라운드 회의를 거쳐 새 정책으로 전환:

> "stats를 어디에 통째로 둘까"의 답을 찾는 대신, **"각 stat이 자기 의미와 가까운 영역으로 분산"**하는 것이 답.

핵심 변경 (ADR-007 — ADR-001/004/006 모두 supersede):

- **view-section-header 가벼움 회복**: vsh-row 3행 구조 폐기. 단일 flex row로 복귀 — `[.chart-default-meta(요청 추이 + 부제)] | [.chart-detail-meta(세션 메타)] | [.chart-actions]`. stats 0개. "이 섹션이 무엇인가"만 알린다.
- **활성 세션 → 글로벌 헤더 LIVE 배지에 통합**: `.badge-live` 안에 `<span class="dot"></span><span class="badge-live-label">LIVE</span><span class="header-stat" id="activeCard"><span class="header-stat-value" id="statActive">7</span></span>` 구조. dot은 SSE 연결 상태(`.live-dot`이 담당), chip은 활성 세션 수. dot 충돌 방지 위해 chip의 `::before` 무력화. 활성>0 시 chip 값 green.
- **오류율 + 평균 + P95 → timeline 영역 meta line**: `chart-wrap`을 column flex로 전환. canvas 위에 `.timeline-meta` 한 줄 — `평균 1.2s · P95 3.4s · 오류율 0.5%`. timeline의 직접 부속 컨텍스트. detail 모드(`#chartSection.chart-mode-detail .timeline-meta`) 자동 숨김.
- **세션 + 요청 + 토큰 → cache-panel-overall의 'Today Summary' 격상**: `.cache-panel-overall`을 column flex로 전환. 위에 `.cps-volume`(`오늘 142세션 · 1.2k 요청 · 8.4M 토큰`) 신규 + 아래 `.cps-cache` wrapper(기존 3 cache-section: Hit Rate / Cost / Creation·Read). cache-panel 정체성을 'Today Summary'로 격상하여 누적 볼륨 + 캐시 효율을 한 묶음으로 표현.
- **폐기 클래스**: `.view-section-header--vsh`, `.vsh-row`, `.vsh-row--title|--hero|--secondary`, `.header-stat--hero`. Hero 변형 자체 폐기 — 분산 후 모든 chip이 동일 위계.
- **유지 SSoT (변경 0)**: `.header-stat` chip 클래스, `.header-stat-value`, `.header-stat-label`, 상태 클래스(`is-active-indicator` / `is-error` / `is-critical`), DOM ID 8종(`statActive` / `activeCard` / `stat-error-rate` / `statAvgDuration` / `stat-p95` / `statSessions` / `statRequests` / `statTokens`), `data-stat-tooltip` 속성. **api.js / stat-tooltip.js / chart.js 무수정**.
- **신규 토큰 0**, **JS 무수정**.

### ADR-006 자기비판 (사용자 부정 평가 반영)

1. chartSection 비대화 — view-section-header 약 40px → 약 88px. 차트 본체 자리 잠식.
2. 위계 역전 — Hero font-hero(24px)가 차트보다 무거움.
3. stats를 헤더의 본질로 오해 — view-section-header는 "이 섹션이 무엇인가"만 알리는 자리.
4. "각각 유의미"의 잘못된 해석 — 사용자 의도는 "각자 자기 자리"였음.
5. 자기검열 부재 — 형식 논리에 갇혀 실제 시각 임팩트를 보지 못함.

### 시각 무게 분포 비교

| 영역 | ADR-006 (Phase 3) | ADR-007 (Phase 4) |
|------|-------------------|-------------------|
| view-section-header | 88px (Title+Hero+Secondary) | 28~32px (Title only) |
| timeline-meta | 0 (없음) | 14~16px (font-meta inline) |
| charts-inner | 100px+ | 100px+ (변화 없음) |
| cache-panel-overall | 52px (3 cache-section) | 76~80px (Volume 24~28 + cache 52) |
| **chartSection 총 높이** | **약 240~260px** | **약 220~240px** |

상세: `.claude/docs/plans/header-summary-merge/{plan.md (Phase 4), adr.md (ADR-007), tasks.md (T17~T22)}`

## 이전 현행화: 2026-04-26 (header-summary-merge Phase 3, **사용자 부정 평가 후 ADR-007로 supersede**) — view-section stats 2단 위계 재설계 (ADR-006)

Phase 2 적용 후 사용자 피드백: "header-stat-group 컴포넌트들은 매우 중요하지만, 1행 평탄 나열 디자인이 너무 어지럽다." 7개 stat 정보 손실 없이 유지하면서 시각 위계 재설계 + 패러다임 전환.

핵심 변경:
- **view-section-header 2단 위계 재설계** (ADR-006): `view-section-header`를 column flex로 전환. 내부에 `.vsh-row` 3개 배치 — `vsh-row--title`(섹션 라벨 + 부제 + chart-actions, 정적) / `vsh-row--hero`(활성 + 오류율, font-hero 24px) / `vsh-row--secondary`(평균/P95/세션/요청/토큰, font-meta + border-top). divider DOM 0, 그룹 그라디언트 0 → 어지러움 핵심 원인 직접 제거.
- **Hero 압도적 시각화**: Hero chip 폰트 `font-body(13px)` → `font-hero(24px)` / `weight-hero(700)`. Secondary 대비 약 1.85배 시각 면적으로 시선 진입점 명확화.
- **라벨/값 순서 swap**: 기존 `[라벨][값]` → `[값][라벨]` (큰 숫자 먼저). chip 단위가 `inline-flex column`으로 전환되어 값(상단) → 라벨(하단) 수직 정렬.
- **폐기 DOM/클래스**: `.header-stat-group`, `.header-stat-group--hero|--performance|--volume`, `.header-stat-divider` 모두 삭제.
- **유지 SSoT**: `.header-stat`, `.header-stat--hero`, `.header-stat-value`, `.header-stat-label`, 상태 클래스 (`is-active-indicator` / `is-error` / `is-critical`), DOM ID, `data-stat-tooltip`, `#activeCard` 모두 보존 → **api.js / stat-tooltip.js / chart.js 무수정**.
- **detail 모드 자동 숨김**: `#chartSection.chart-mode-detail .vsh-row--hero, .vsh-row--secondary { display: none }` — Title row만 유지하여 세션 메타가 자연스럽게 표시.
- **반응형 우선순위**: 1024px(부제 숨김 + chip 간격 축소) / 768px(Volume 3 chip 숨김 — sessions/requests/tokens) / 480px(Secondary 행 전체 숨김, Hero만).
- **신규 토큰 0**: `--font-hero`, `--weight-hero`, `--space-1~6`, 색상 토큰 모두 design-tokens.css 기존 값 재사용.

신규 클래스: `.view-section-header--vsh`, `.vsh-row`, `.vsh-row--title`, `.vsh-row--hero`, `.vsh-row--secondary`
DOM 제거: `.header-stat-group`, `.header-stat-group--hero|--performance|--volume`, `.header-stat-divider`
시각 위계: Hero font-hero(24px) vs Secondary font-meta(11px) = 약 2.18배 시각 면적
view-section-header 세로 높이: 약 40px → 약 88px (Title 28 + Hero 36 + Secondary 24)

상세: `.claude/docs/plans/header-summary-merge/{plan.md (Phase 3), adr.md (ADR-006), tasks.md (T12~T16)}`

## 이전 현행화: 2026-04-26 (header-summary-merge Phase 2) — header-stats를 view-section-header로 이전 + Donut 버그 수정

Phase 1 결과를 사용자가 검토하고, 헤더는 글로벌 네비/필터 전용으로 유지하는 것이 정보 위계상 적합하다고 판단. stats chip은 view 컨텍스트에 종속이므로 `chartSection .view-section-header`로 이전.

핵심 변경:
- **header-stats를 view-section-header로 이전** (ADR-004): `.header-stats` DOM을 `.header`에서 제거 → `#chartSection .view-section-header` 내부 `.chart-default-meta` 다음에 배치. 헤더는 다시 `[.header-left | .header-right]` 단순 구조로 복귀. CSS 정의는 header.css → default-view.css의 `#chartSection` 컨텍스트로 이동. detail 모드 자동 숨김 (`#chartSection.chart-mode-detail .header-stats { display: none }`).
- **Donut Model 모드 버그 수정** (ADR-005): `chart.js`에 `setSourceData(kind, data)` / `hasSourceData(kind)` SSoT 도입. 두 종류(`type` / `model`) 데이터를 chart 모듈 내부에 보관하여 `fetchDashboard` 5초 polling이 model 모드 활성 typeData를 덮어쓰지 않도록 단일 책임 캡슐화. 외부 캐시 변수(`_modelUsageCache` / `_typeDataCache`) 제거. `setTypeData(data)`는 후방 호환 — `setSourceData('type', data)` 위임으로 api.js / session-detail.js 무수정.
- **클래스명 SSoT 유지**: `.header-stat*` prefix 그대로 → api.js / stat-tooltip.js 변경 0.

신규 시그니처: `chart.js#setSourceData(kind, data)`, `chart.js#hasSourceData(kind)`
헤더 DOM 단순화: `[.header-left(로고+LIVE) | .header-right(날짜필터+갱신)]`
view-section-header 레이아웃: `[.chart-default-meta | .header-stats(flex:1) | .chart-actions]`

상세: `.claude/docs/plans/header-summary-merge/{plan,adr,tasks}.md` (Phase 2)

## 이전 현행화: 2026-04-26 (header-summary-merge Phase 1) — Summary Strip 헤더 통합 + Insights 카드 제거

상단 정보 영역 재구성: 별도 띠로 차지하던 `.summary-strip`(56px)를 `.header` 내부 `.header-stats` chip 그룹으로 흡수, ADR-016 Insights 카드(5종 sub-tile)는 사용성 부족으로 완전 제거.

핵심 변경:
- **Summary Strip → Header 통합** (ADR-001): `.summary-strip` DOM 블록 제거. `.header` 구조 = `[.header-left | .header-stats(7 chip + 2 divider) | .header-right]`. body grid-template-rows: `auto auto auto 1fr auto` → `auto auto 1fr auto` (행 1개 회수).
- **Insights 카드 완전 제거** (ADR-002): HTML 블록 / `insights.css` / `insights.js` 삭제. `metrics-api.js`에서 5종 fetcher 제거 (`fetchContextUsage`, `fetchActivityHeatmap`, `fetchTurnDistribution`, `fetchAgentDepth`, `fetchAnomaliesTimeseries`). 서버 엔드포인트는 유지.
- **Header chip SSoT** (ADR-003): 신규 클래스 `.header-stats`, `.header-stat-group`, `.header-stat-group--hero`, `.header-stat-divider`, `.header-stat`, `.header-stat--hero`, `.header-stat-label`, `.header-stat-value`. 신규 토큰 0 (기존 design-tokens.css 재사용). 상태 클래스(`is-active-indicator`/`is-error`/`is-critical`)는 동일 의미로 새 클래스에 적용. DOM ID + `data-stat-tooltip` 속성 모두 보존 → `stat-tooltip.js` 무수정 동작.

신규 클래스: `.header-stats`, `.header-stat`, `.header-stat-group`, `.header-stat-group--hero|--performance|--volume`, `.header-stat-divider`, `.header-stat--hero`, `.header-stat-label`, `.header-stat-value`, `.header-right`
파일 삭제: `assets/css/summary-strip.css`, `assets/css/insights.css`, `assets/js/insights.js`
DOM 제거: `.summary-strip`, `.stat-card`, `.stat-group`, `.stat-divider`, `.stat-label`, `.stat-value`, `.insights-card`, `.insight-tile`, `.heatmap-grid`, `.bar-list`, `.anomaly-bars`

상세: `.claude/docs/plans/header-summary-merge/{plan,adr,tasks}.md`

## 이전 현행화: 2026-04-23 (ui-redesign Phase 3) — 시각 지표 8종 + 가격 정책 + chartSection 통합

**data-engineer 신규 메트릭 API 8종 활용 + 디자인 통합 4종.**

핵심 변경:
- **chartSection 모드 전환** (ADR-017): default/detail 토글. detail 모드에서 chart 헤더에 세션 메타(ID/프로젝트/토큰/종료시각/배지/닫기) 표시 + timelineChart → contextGrowthChart swap + donut/cache panel 세션 단위 변환. **기존 `.detail-header` / `.context-chart-section` DOM 제거 → chartSection으로 흡수**.
- **Donut 모드 토글**: chartSection donut 옆 segment toggle (Type / Model). 모델 모드는 `/api/metrics/model-usage` 사용.
- **Cache panel 모드 토글**: 우상단 segment toggle (전체 / 모델별). 모델별 모드는 `/api/metrics/cache-matrix` 기반 stacked bar + hit_rate.
- **Tool 통계 도구/카테고리 토글**: left-panel 헤더 segment. 카테고리 모드는 `/api/metrics/tool-categories` 6 카테고리 (FileOps/Search/Bash/MCP/Agent/Other).
- **Insights 카드 신규** (ADR-016): chartSection 아래 default 모드 전용. 5종 sub-tile: 활동 heatmap / 컨텍스트 사용률 / turn 분포+compaction / 에이전트 깊이 / anomaly 시계열. 24h/7d/30d range 토글 + 접기 토글.
- **가격 정책 옵션 2** (ADR-015): UI에서 USD 표시 전면 제거. cache-panel 토큰 단위 ("no cache / actual / saved" 토큰). Summary Strip 비용/절감 카드 제거 → Volume 그룹.
- **로고 클릭 → 홈 복귀** (ADR-018): closeDetail + selectedSession/Project null + autoActivateProject + scroll top.

신규 파일: `metrics-api.js`, `insights.js`, `insights.css`
신규 토큰/클래스: `.chart-mode-detail`, `.chart-default-meta`, `.chart-detail-meta`, `.chart-actions`, `.donut-mode-toggle`, `.cache-mode-toggle`, `.cache-matrix-row`, `.tool-mode-toggle`, `.cat-row`, `.insights-card`, `.insight-tile`, `.heatmap-grid`, `.bar-list`, `.anomaly-bars`
DOM 제거: `.detail-header`, `.context-chart-section`, `.context-chart-inner`, `#stat-cost`, `#stat-cache-savings` 카드

상세: `.claude/docs/plans/ui-redesign/{adr.md (ADR-015~018), tasks.md (T34~T52), api-spec.md}`

## 이전 현행화: 2026-04-23 (ui-redesign Phase 2) — 14개 ADR 일괄 적용

**디자이너 피드백 4종("숨막힘 / 어디 봐야할지 모르겠음 / 그룹핑 부재 / AI같음")에 답하는 통합 재설계.**

핵심 변경:
- **3-Tier Visual Hierarchy** (ADR-001/004): Hero / Secondary / Tertiary 토큰 도입 (font-hero 24px / major 18px / body 13px / meta 11px / micro 9px)
- **8px Spacing Grid** (ADR-002): `--space-1~6` 토큰으로 padding/margin 일관성 확보
- **Card Container System** (ADR-003, `card.css`): `.card` 클래스 신규 — Chart Strip / Default Feed / Detail View 모두 카드로 감쌈
- **State SSoT** (ADR-009, `state.css`): empty/loading/error 통일 — "데이터가 없습니다" 한국어 통일
- **Summary Strip 3섹션 재구성** (ADR-005): Hero(활성+오류율 24px) / Performance(평균/P95) / Volume·Cost(세션·요청·토큰·비용·절감 sub)
- **Type Filter Grouping** (ADR-006): 7개 평면 → 3그룹 (`[All]` | `[prompt | system]` | `[tool_call | Agent | Skill | MCP]`)
- **Tools Matrix View** (ADR-007): 3섹션 분산 → 1행 1도구 6컬럼 매트릭스 + 정렬 토글 3종
- **Turn Card Hierarchy** (ADR-008): 그룹 행 surface-alt 배경 + accent-border, chip-arrow SVG, footer % Hero 강조
- **closeDetail 핸들러 등록** (ADR-010 A-1): 닫기 버튼(`#btnCloseDetail`) 마크업 + main.js click 리스너
- **TUI maxTokens 200K** (ADR-010 C-1, ADR-013): Claude 모델 표준 한도 반영
- **TUI AlertBanner 노출** (ADR-010 A-2): app.tsx에 useAlerts + Header 위 conditional 렌더
- **TUI Sidebar selectedId** (ADR-013): 선택된 세션 시각 강조
- **TUI Top Requests Enter 점프** (ADR-013): Analysis → History 자동 전환 + 세션 선택
- **키보드 단축키 1차** (ADR-012): `?` 도움말 모달 / `Esc` 우선순위 닫기 / `/` 검색 포커스 / `Cmd/Ctrl+F` 가로채기 / `1~7` 타입 필터
- **localStorage prefix 통일** (ADR-014): 모든 키 `spyglass:` 강제 + 마이그레이션 헬퍼

신규 CSS 파일: `card.css`, `state.css`, `keyboard-help.css`
신규 토큰: `--space-1~6`, `--font-hero/major/body/meta/micro`, `--weight-hero/strong/normal`, `--radius-lg`, `--card-bg/border/shadow`

상세: `.claude/docs/plans/ui-redesign/{adr.md, tasks.md}`

## 이전 현행화: 2026-04-22 (turn-view-chevron-alignment) — 액션 행 왼쪽 정렬 48px 통일

**이전 상태**: 행 타입별 padding/border 합이 달라 두번째 grid 컬럼 시작 x좌표 불일치 (prompt 58px, 단독 tool 48px, 그룹 헤더/자식 50px).
**현재 상태**: 모든 행 타입에서 `margin 16 + border(0~2) + padding(30~32) = 48px`로 통일. chevron 유무와 무관하게 `Write`, `user`, `Bash ×3`, `Edit ×6` 네 행의 이름/아이콘 시작 x좌표 일치.

## 이전 현행화: 2026-04-21 (turn-view-action-grouping) — 턴뷰 연속 도구 그룹화 + × N 포맷 통일

**이전 상태 (제거됨)**: 목록/카드 토글 버튼 2개 (`#btnTurnList`, `#btnTurnCard`), `.turn-view-toolbar`, `#turnListBody`, `#turnCardBody` 별도 컨테이너
**현재 상태 (신규)**: `#turnUnifiedBody` 단일 컨테이너, 카드 accordion 방식으로 세부 로그 펼침, 턴 내림차순 정렬

## 파일 구조

```
packages/web/
├── index.html                  ← HTML 마크업 전용 (header에 stats 통합)
└── assets/
    ├── css/                    ← 컴포넌트별 CSS 분리
    │   ├── design-tokens.css   ← :root 변수 SSoT (ADR-003)
    │   ├── layout.css
    │   ├── header.css          ← 로고/LIVE/.header-stats(chip)/날짜필터/갱신 SSoT
    │   ├── card.css
    │   ├── state.css
    │   ├── keyboard-help.css
    │   ├── left-panel.css
    │   ├── default-view.css
    │   ├── detail-view.css
    │   ├── table.css
    │   ├── badges.css          ← .cache-tooltip / .stat-tooltip 포함
    │   ├── skeleton.css
    │   ├── cache-panel.css
    │   ├── context-chart.css
    │   ├── turn-view.css
    │   ├── turn-gantt.css
    │   └── tool-stats.css
    └── js/                     ← native ESM 모듈
        ├── main.js             ← 진입점
        ├── formatters.js
        ├── chart.js
        ├── renderers.js
        ├── infra.js
        ├── left-panel.js
        ├── session-detail.js
        ├── api.js              ← .header-stat 셀렉터 사용
        ├── metrics-api.js      ← model-usage / cache-matrix / tool-categories만 유지
        ├── cache-tooltip.js
        ├── stat-tooltip.js     ← .header-stat[data-stat-tooltip] hover 툴팁
        ├── cache-panel-tooltip.js
        ├── cache-panel.js
        ├── tool-stats.js
        ├── context-chart.js
        ├── turn-gantt.js
        ├── anomaly.js
        ├── panel-resize.js
        ├── col-resize.js
        └── resize-utils.js
```

> header-summary-merge: `summary-strip.css`, `insights.css`, `insights.js` 삭제됨.

---

## 전체 레이아웃 구조

**패널 숨김 상태(기본):**
```
┌────────────────────────────────────────────────────────────────────────┐
│ HEADER (52px)   로고·LIVE                              날짜필터·갱신    │
├────────────────────────────────────────────────────────────────────────┤
│  ERROR BANNER (1px, 평소 숨김)                                         │
├────────────────────────────────────────────────────────────────────────┤
│  CHART SECTION  요청추이 │ 활성 오류율 │ 평균 P95 │ 세션 요청 토큰 │ ⌄  │
│                 ┌─────────────────────┬──────┬─────────────┐           │
│                 │ timeline            │donut │ cache panel │           │
│                 └─────────────────────┴──────┴─────────────┘           │
├────────────────────────────────────────────────────────────────────────┤
│  RIGHT PANEL (1fr)                                                     │
│  [기본 뷰: 최근 요청 피드] or [세션 상세 뷰]                            │
│  (왼쪽 패널 숨김, 전체 너비 차지)                                       │
├────────────────────────────────────────────────────────────────────────┤
│  FOOTER (20px)  Claude Spyglass — real-time monitor                    │
└────────────────────────────────────────────────────────────────────────┘
```

**패널 펼침 상태 (토글 클릭):**
```
┌────────────────────────────────────────────────────────────────────────┐
│ HEADER (52px)   로고·LIVE                              날짜필터·갱신    │
├────────────────────────────────────────────────────────────────────────┤
│  ERROR BANNER (1px, 평소 숨김)                                         │
├───────────────────┬────────────────────────────────────────────────────┤
│  LEFT PANEL       │  RIGHT PANEL                        │
│  (var(--left-    │  (1fr)                              │
│   panel-width)    │                                     │
│  = 280px          │  [기본 뷰] or [세션 상세 뷰]        │
│                   │                                     │
│  ┌─────────────┐  │                                     │
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

**메커니즘**: `.main-layout.left-panel-hidden` 클래스 토글
- 숨김: `grid-template-columns: 1fr` + `.left-panel { display: none }`
- 펼침: `grid-template-columns: var(--left-panel-width) 1fr`

---

## 화면 0 — 헤더 (Header) — 글로벌 네비/필터 전용

**DOM**: `<header class="header">`
**높이**: 52px (flex-shrink: 0)
**상태**: ✅ 현행 (2026-04-26 Phase 2 — header-stats는 view-section-header로 이전됨)

구조: `[.header-left] | [.header-right]` flex (justify-content: space-between)

> stats chip은 화면 1 — 1-1. 요청 추이 차트의 view-section-header에서 표시 (ADR-004).

### 0-1. 헤더 왼쪽 영역 (.header-left)

| 요소 | 설명 |
|------|------|
| `.logo` | "Claude**Spyglass**" (span은 일반 텍스트색). 클릭 시 홈 복귀 (ADR-018) |
| `.badge-live` | SSE 상태 + 활성 세션 chip 통합 (ADR-007). 구조: `[.dot(SSE pulse)] [.badge-live-label("LIVE")] [.header-stat#activeCard(active sessions)]`. 활성>0 시 chip value green. disconnected 시 dot/border/value red. chip의 `::before` 무력화로 live-dot과 충돌 방지. |

> `.btn-panel-collapse`는 헤더에서 제거됨. 현재 위치는 화면 3 좌측 패널 참조.

### 0-2. 헤더 오른쪽 영역 (.header-right)

| 요소 | 설명 |
|------|------|
| `.date-filter` | 전체 / 오늘 / 이번주 (`.active` 강조) |
| `.last-updated` | 마지막 갱신 시각 (font-meta, `--text-dim`) |

### 헤더 반응형 (header.css @media)

| 브레이크포인트 | 동작 |
|---------------|------|
| `≤ 768px` | `.last-updated` 숨김, gap/padding 축소 |
| `≤ 480px` | `.badge-live` 노출 유지 (활성 세션 chip이 핵심 정보, ADR-007). padding 축소 + `.badge-live-label` 숨김 (chip 값만 노출 — `●  7`) |

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
| 도넛 | 타입별 또는 모델별 비율 + 범례 (Type/Model 토글) |
| 높이 | canvas height="100" |
| 섹션 라벨 | "요청 추이 (실시간)" / 부제 "최근 30분" |

#### 1-1-H. chartSection 영역 — Stats Distribution (ADR-007)

ADR-007로 view-section-header에 stats를 두는 발상 자체가 폐기됨. 7개 stat이 자기 의미와 가까운 영역으로 분산:

##### view-section-header — 단일 flex row (가벼움 회복)

```
[.chart-default-meta(라벨+부제)] | [.chart-detail-meta(세션 메타, default 시 hidden)] | [.chart-actions(접기/닫기)]
```

stats 0개. 약 28~32px. "이 섹션이 무엇인가"(요청 추이 / 세션 메타)만 알린다.

##### 6개 stat 거처 매핑 (ADR-008 — ADR-007 부분 supersede)

| stat | DOM ID | 거처 | 거처 클래스 | 시간 컨텍스트 |
|------|--------|------|-------------|----------------|
| 활성 세션 | `statActive` (`#activeCard`) | 글로벌 헤더 LIVE 배지 | `.badge-live .header-stat` | 실시간 (NOW) |
| 평균 응답 | `statAvgDuration` | timeline 영역 (품질 그룹) | `.timeline-meta-group .header-stat` | **활성 date-filter 윈도우** (chart-section-filter-sync) |
| P95 | `stat-p95` | timeline 영역 (품질 그룹) | `.timeline-meta-group .header-stat` | **활성 date-filter 윈도우** |
| 오류율 | `stat-error-rate` | timeline 영역 (품질 그룹) | `.timeline-meta-group .header-stat` | **활성 date-filter 윈도우** |
| 세션 수 | `statSessions` | timeline 영역 (누적 그룹) | `.timeline-meta-group .header-stat` | **활성 date-filter 윈도우** |
| 요청 수 | `statRequests` | timeline 영역 (누적 그룹) | `.timeline-meta-group .header-stat` | **활성 date-filter 윈도우** |
| 토큰 | `statTokens` | timeline 영역 (누적 그룹) | `.timeline-meta-group .header-stat` | **활성 date-filter 윈도우** |

> chart-section-filter-sync 이후: 6 stat 모두 `/api/dashboard?from=X&to=Y`의 동일 fromTs/toTs 윈도우. 두 그룹 라벨이 활성 범위에 동기화되어 데이터-라벨 일관성 확보.

##### timeline-meta (chart-wrap 안 canvas 위 — 6 chip 두 그룹 통합)

```html
<div class="chart-wrap">
  <div class="timeline-meta" id="timelineMeta" role="group" aria-label="요약 지표">
    <!-- 라벨/aria-label은 main.js applyRangeLabels(range)가 RANGE_LABELS SSoT에서 갱신. 초기값은 'all'. -->
    <div class="timeline-meta-group" role="group" aria-label="요청 품질 (전체 기간)">
      <span class="timeline-meta-group-label">품질 · 전체 기간</span>
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
    <div class="timeline-meta-group" role="group" aria-label="누적 볼륨 (전체 기간)">
      <span class="timeline-meta-group-label">누적 · 전체 기간</span>
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

- `chart-wrap { display: flex; flex-direction: column; gap: var(--space-1); position: relative }`
- `timeline-meta { display: flex; justify-content: space-between; flex-wrap: wrap; gap: var(--space-4) }` — 두 그룹이 좌(품질) / 우(볼륨)로 분리
- `timeline-meta-group { display: flex; align-items: baseline; gap: var(--space-3); flex-wrap: wrap }` — 그룹 내부 chip 정렬
- `timeline-meta-group-label { font-size: var(--font-micro); color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; font-weight: var(--weight-strong); flex-shrink: 0 }` — 본질·범위 라벨 ("품질 · {범위}" / "누적 · {범위}"). chart-section-filter-sync ADR-001/003: main.js의 `applyRangeLabels(range)`가 `RANGE_LABELS` SSoT를 통해 dateFilter 클릭 / 초기 로드 시점에 갱신.
- chip은 inline-flex baseline (값 → 라벨, gap: var(--space-1))
- divider DOM 0 (그룹 라벨이 시각 구분 담당)
- detail 모드(`#chartSection.chart-mode-detail .timeline-meta`) 자동 숨김

##### cache-panel-overall (cache-panel.css — cache 효율 단일 책임 복귀)

> ADR-008: ADR-007의 'Today Summary' 격상 폐기. cps-volume이 timeline-meta로 이동하면서 cache-panel은 cache 효율(`Hit Rate / Cost / Creation·Read`)에만 집중 — horizontal flex 3 cache-section 병렬.

```html
<div class="cache-panel" id="cachePanel">
  <div class="cache-panel-overall" id="cachePanelOverall">
    <div class="cache-section" data-cache-panel-tooltip="hit-rate">...</div>
    <div class="cache-section" data-cache-panel-tooltip="cost">...</div>
    <div class="cache-section" data-cache-panel-tooltip="ratio">...</div>
  </div>
</div>
```

- `cache-panel-overall { display: flex; align-items: stretch; gap: 0; flex: 1; min-width: 0 }` (horizontal — ADR-007 column flex 폐기, 이전 상태로 복귀)
- `cache-section + cache-section { border-left: 1px solid var(--border) }` — section 사이 1px divider (기존 SSoT)
- cache-mode-toggle / cache-panel-matrix 폐기 — 모델별 cache 비교는 다른 도구(Insights 등)에서 담당
- 서버 endpoint `/api/metrics/cache-matrix`는 다른 도구 재사용을 위해 유지

##### LIVE 배지 — 활성 세션 chip 통합 (header.css)

```html
<span class="badge-live" id="liveBadge">
  <span class="dot"></span>
  <span class="badge-live-label">LIVE</span>
  <span class="header-stat" id="activeCard" data-stat-tooltip="active">
    <span class="header-stat-value" id="statActive">7</span>
  </span>
</span>
```

- `.dot`: SSE 연결 상태 (pulse 애니메이션)
- `.badge-live-label`: "LIVE" 텍스트
- `.header-stat`: 활성 세션 chip — `border-left: 1px solid var(--accent-border)` 분리, value 폰트 micro, color accent
- chip의 `::before { display: none !important }` — `.live-dot`과 시각 충돌 방지
- 활성>0 시 chip value green (`.is-active-indicator`)
- disconnected 시 dot/border/value 모두 red

##### 상태 클래스 적용 로직 (api.js#fetchDashboard() — 무수정)

- `activeSessions > 0` → `#activeCard.is-active-indicator` (LIVE 배지 chip 값 green)
- `errorRate > 0` → `#stat-error-rate` 부모 chip의 `.is-error` (timeline-meta chip 값 red)
- `errorRate > 0.01` → `.is-critical` (timeline-meta chip 배경 red + outline)
- 셀렉터: `closest('.header-stat')` — chip 클래스 SSoT 그대로 동작

##### 반응형 (ADR-008)

| 브레이크포인트 | 동작 |
|---------------|------|
| `≤ 1024px` | `chart-default-meta .panel-hint` 숨김 + `.timeline-meta-group` gap 축소 |
| `≤ 768px` | `.timeline-meta` gap 축소 (두 그룹 wrap 자연 처리) + last-updated 숨김 |
| `≤ 480px` | `.timeline-meta` padding 0 (좁은 폭에서도 wrap graceful) + badge-live `padding` 축소 + label 숨김(chip만) |

> **(폐기) 이전 ADR-006 1-1-H 섹션 — vsh-row 3행 구조**: 사용자 부정 평가 후 ADR-007로 supersede. 본문 명세(레이아웃 mockup, chip 명세 표, Hero font-hero 24px, vsh-row gap, 반응형 vsh-row 셀렉터 등) 모두 무효. 변경 이력만 보존.

#### 1-1-D. 도넛 모드 SSoT (chart.js — ADR-005)

도넛 데이터/모드 동기화는 `chart.js`가 단일 책임으로 캡슐화.

| API | 역할 |
|-----|------|
| `setSourceData(kind, data)` | `kind ∈ {'type', 'model'}`. 두 종류 데이터를 모듈 내부에 보관. 활성 모드와 일치하는 종류만 화면에 반영 |
| `setDonutMode(mode)` | 활성 데이터셋(`typeData`)을 `dataByKind[mode]`로 전환 |
| `setTypeData(data)` | 후방 호환 — `setSourceData('type', data)` 위임 |
| `hasSourceData(kind)` | 외부 캐시 hit 검사 (model 모드 진입 시 fetch 필요 여부) |

**버그 수정 사항**: ADR-016 도입 후 `fetchDashboard` 5초 polling이 `setTypeData(d.types)`로 typeData를 무조건 덮어써 Model 모드 도넛이 즉시 사라지던 문제. chart.js 내부에서 `kind === donutMode`일 때만 활성 데이터 갱신하므로 polling 안전.

##### ADR-008 — donut-mode-toggle 폐기 + 자동 전환

`donut-mode-toggle` UI 폐기. `setChartMode(mode)`(main.js)가 chartSection 상태에 따라 도넛 모드 자동 결정:

| chartSection 모드 | donut 모드 | 데이터 |
|-------------------|-----------|--------|
| `default` | `'model'` | `fetchModelUsage` (캐시 미스 시) → `setSourceData('model', data)` |
| `detail` | `'type'` | `setSourceData('type', sessionTypeData)` (session-detail.js) |

`chart.js`의 `donutMode` 초기값 `'model'`. SSoT 함수 4종(`setSourceData/setDonutMode/hasSourceData/getDonutMode`)는 변경 0.

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
| 필터 버튼 (All/prompt/tool_call/system/Agent/Skill/MCP) | 타입별 행 필터링. Agent/Skill/MCP는 `data-sub-type` 기준 클라이언트 필터 |
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

### 2-0. 상세 헤더 (ADR-017로 chartSection 통합 — `chart-detail-meta`)

> ADR-017: detail-header가 별도 영역이 아니라 `#chartSection .view-section-header > .chart-detail-meta` 안에 통합됨. detail 모드 진입 시 chart-default-meta는 hidden, chart-detail-meta는 표시.
> ADR-008: `btnCloseDetail` / `btn-close` / `detail-actions-sep` 제거. `chart-actions`는 `btnToggleChart`(접기 토글) 단독.

| 요소 | 클래스 / DOM | 내용 |
|------|--------------|------|
| 세션 ID | `.detail-session-id` | accent 색상, 앞 8자, `flex-shrink:0` (항상 완전 표시) |
| 프로젝트명 | `.detail-project` | text-muted, `flex-shrink:1` (공간 부족 시 ellipsis 축소) |
| 총 토큰 | `.detail-tokens` | accent, `flex-shrink:0` |
| 종료 시각 | `.detail-ended-at` | text-muted, `flex-shrink:0` (인라인 스타일 없음) |
| 집계 배지 | `.detail-agg-badges` | inline-flex, `flex-shrink:0`, 숨김 시 `.detail-agg-badges--hidden` 클래스 사용 |
| 접기/펼치기 토글 | `#btnToggleChart` `.btn-toggle` | SVG chevron-down, 28×28px, hover: `var(--accent)` + `var(--accent-dim)` bg, 접힌 상태 180도 회전 (chart-actions 안 단독) |
| ~~닫기 버튼~~ | ~~`#btnCloseDetail` `.btn-close`~~ | **ADR-008로 폐기**. `closeDetail()`은 Esc 키 / 로고 클릭으로 트리거 (function 보존, click handler 제거) |
| ~~구분선~~ | ~~`.detail-actions-sep`~~ | **ADR-008로 폐기**. 단일 토글 버튼만 남아 시각 분리 불필요 |

> **레이아웃 정책 (ADR-001~008)**: `chart-detail-meta`는 `flex-wrap` 없음 — 1줄 고정. 인라인 스타일 없음 — 모든 상태 CSS 클래스로 제어.

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
detail-controls-bar    (⌕ 검색창) (All/prompt/tool_call/system/Agent/Skill/MCP) — 필터링 전용
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

### 2-2. 통합 카드 뷰 — 턴 뷰 (detailTurnView)

**DOM ID**: `#detailTurnView` > `#turnUnifiedBody`
**상태**: ✅ 현행 (2026-04-22 turn-view-chevron-alignment 적용 — 액션 행 왼쪽 정렬 48px 통일)

#### 정렬 상수 (turn-view.css)

모든 `.turn-row` 변종에서 두번째 grid 컬럼 시작 x좌표를 `margin(16) + border(0~2) + padding(30~32) = 48px`로 통일. chevron 유무와 무관하게 `◉/•/✓/×` 아이콘·이름 수직선 일치.

| 행 타입 | margin-L | border-L | padding-L | 두번째 컬럼 x |
|---------|----------|----------|-----------|---------------|
| `.turn-row-prompt` (user) | 16 | 2 | 30 | 48 |
| `.turn-row-tool` (단독) | 16 | 0 | 32 | 48 |
| `.turn-row-group` (그룹 헤더) | 16 | 2 | 30 | 48 |
| `.turn-row-group-children > .turn-row-tool` (그룹 자식) | 16(부모) | 2(부모) | 30 | 48 |

#### 구조 (통합 accordion 카드)

```
#turnUnifiedBody
  └─ .turn-card[data-card-turn-id]        ← T5 (최신, 내림차순)
       ├─ .turn-card-summary[data-toggle-card, role="button", aria-expanded, tabindex="0"]
       │    ├─ .turn-card-header
       │    │    ├─ .turn-card-index (T5)
       │    │    ├─ .turn-card-preview (프롬프트 미리보기 60자)
       │    │    ├─ .turn-complexity (복잡/중간 배지)
       │    │    └─ .turn-card-expand-btn (▶ 회전 애니메이션)
       │    ├─ .turn-card-flow (tool chip 흐름)
       │    └─ .turn-card-footer (IN/OUT 토큰, 응답시간, 토큰 비율%)
       └─ .turn-card-expanded (클릭 시 펼쳐짐)
            ├─ .turn-row.turn-row-prompt
            └─ .turn-row.turn-row-tool (N개)
  └─ .turn-card ...  (T4, T3, T2, T1 순)
```

#### 카드 정렬

`turn_index` 내림차순 — 최신 턴이 위 (5, 4, 3, 2, 1)

#### 카드 확장 상태 관리

- `_expandedTurnIds: Set<string>` — 모듈 변수, SSE 갱신 후에도 유지
- 세션 전환 시 `loadSessionDetail()` 내 `_expandedTurnIds.clear()` 자동 초기화
- `toggleCardExpand(turnId)` — 펼침/닫힘 토글, `aria-expanded` 동기화

#### 카드 헤더 인터랙션

| 동작 | 결과 |
|------|------|
| 카드 `.turn-card-summary` 클릭 | accordion 펼침/닫힘 |
| `.turn-card-expanded` 내부 클릭 | 버블링 차단 (카드 토글 충돌 방지) |
| `[data-expand-id]` 클릭 | 프롬프트 확장 패널 토글 |
| 키보드 Enter/Space (`.turn-card-summary` 포커스 시) | accordion 펼침/닫힘 |

#### 세부 행 그리드 (펼침 영역)

```css
grid-template-columns: 28px minmax(140px,1fr) 56px 56px 72px 80px
/* 아이콘 | 행위+미리보기 | 입력 | 출력 | 응답시간 | 시각 */
```

> **세부 행 렌더링**: `buildTurnDetailRows(turn)` 함수로 생성 — `contextPreview`, `toolStatusBadge`, `toolResponseHint`, `targetInnerHtml` 재사용 (HTML 직접 작성 없음)

#### 제거된 요소

| 제거 | 이유 |
|------|------|
| `#btnTurnList`, `#btnTurnCard` | 통합 뷰로 불필요 |
| `.turn-view-toolbar` | 통합 뷰로 불필요 |
| `#turnListBody`, `#turnCardBody` | `#turnUnifiedBody` 단일 컨테이너로 통합 |
| `_turnViewMode` 상태 변수 | 항상 카드 뷰만 사용 |
| `setTurnViewMode()` | no-op stub으로 하위 호환 유지 |

---

## 화면 3 — 좌측 패널

### 패널 전체 접기/펼치기 토글 (`btnPanelCollapse`)

**DOM 위치**: `.left-panel` 직접 자식 (`.panel-resize-handle` 바로 다음)
**배치 방식**: `position: absolute; top: 50%; right: -12px; transform: translateY(-50%)` — 패널 우측 border 위에 절반씩 걸쳐 세로 가운데 floating
**스타일**: 원형(`border-radius: 50%`), 24px, `var(--surface-alt)` 배경, `1px solid var(--border)` 테두리
**Hover**: `border-color: var(--accent)`, `color: var(--accent)`
**숨김 상태**: SVG `rotate(180deg)` — 오른쪽 화살표(펼치기 방향)
**z-index**: 20 (resize-handle의 z-index:10 위)
**참고 패턴**: VS Code·JetBrains IDE border floating 패턴

---

### 섹션 접기/펼치기 토글

**기능**: 각 섹션 헤더에 `<` 화살표 토글 버튼 추가
**클래스**: `.btn-panel-toggle` (28x28px, flex center)
**상태 저장**: `localStorage('left-panel-state')` — JSON 포맷 `{projects: bool, sessions: bool, tools: bool}`

| 동작 | 결과 |
|------|------|
| 토글 버튼 클릭 | `.panel-section--collapsed` 토글, `.panel-body` 숨김, SVG 180도 회전 |
| 페이지 로드 | localStorage에서 상태 복원, 각 섹션 접힘 상태 초기화 |
| 버튼 호버 | background: `var(--accent-dim)`, color: `var(--accent)` |

**마크업**: 각 섹션 헤더에 `<div class="panel-header-right">` 추가
```html
<div class="panel-header-right">
  <span class="panel-hint">...</span> <!-- 있을 때만 -->
  <button class="btn-panel-toggle" data-panel="projects">
    <svg>...</svg>
  </button>
</div>
```

**관련 파일**:
- `assets/js/main.js` — `togglePanelSection(panelId)`, `restorePanelState()`, `getPanelState()`, `savePanelState()`
- `assets/css/left-panel.css` — `.btn-panel-toggle`, `.panel-header-right`, `.panel-section--collapsed`

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

**DOM ID**: `#panelProjects` (`.panel-section.flex-section`, tbody: `browserProjectsBody`)
**높이**: `var(--project-panel-height)` = 215px (접힘 시 29px)
**상태**: ✅ 현행

| 요소 | 내용 |
|------|------|
| 섹션 라벨 | "프로젝트" (`.panel-label` CSS `text-transform:uppercase` 적용) |
| 토글 버튼 | `<` 화살표 (`.btn-panel-toggle[data-panel="projects"]`) |
| 날짜 필터 | **없음** — 날짜 필터는 헤더에만 존재 (`#dateFilter`) |
| 테이블 컬럼 | **이름** (max-width 120px, ellipsis) \| **세션** (right-align) \| **토큰** (바+텍스트) |
| 선택 상태 | `.row-selected` 클래스 (accent 좌측 border + accent-dim bg) |

#### 프로젝트 행 렌더링 (`renderBrowserProjects`)

- 토큰 바 너비: `max(1, round(total_tokens / maxTotal * 100))`%
- 바 색상: `var(--accent)`
- 이름: max-width 120px, ellipsis + `title` 속성으로 전체 이름 표시

### 3-2. 세션 목록

**DOM ID**: `#panelSessions` (tbody: `browserSessionsBody`, 힌트: `sessionPaneHint`)
**높이**: 1fr (가변, 접힘 시 29px)
**상태**: ✅ 현행

각 세션 행 구성 (`makeSessionRow`):
```
[sess-id(8자)]  [상대시간]       [총토큰]  [●/○]
[첫 프롬프트 미리보기 텍스트 (최대 60자)]
```

| 요소 | 스타일 | 비고 |
|------|--------|------|
| 섹션 라벨 | "세션" | 헤더 좌측 |
| 힌트 텍스트 | 10px, text-dim | 헤더 우측, 동적 변경 |
| 토글 버튼 | `<` 화살표 (`.btn-panel-toggle[data-panel="sessions"]`) | 헤더 우측 끝 |
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

**DOM ID**: `#panelTools` (섹션), `#toolStatsSection` (레거시), 힌트: `#toolCount`, tbody: `#toolsBody`)
**높이**: `var(--tool-stats-height)` = 160px (접힘 시 29px)
**상태**: ✅ 현행

| 요소 | 내용 |
|------|------|
| 섹션 라벨 | "툴 통계 **(전체)**" — "(전체)"는 별도 span, font-weight:400, opacity:0.6 |
| 힌트 텍스트 | `{n}개` (툴 종류 수) — 동적 업데이트 |
| 토글 버튼 | `<` 화살표 (`.btn-panel-toggle[data-panel="tools"]`) — 헤더 우측 끝 |

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

## 화면 4 — (DEPRECATED) 헤더 — 화면 0에 통합

> 별도 항목으로 두지 않습니다. **화면 0 — 헤더 (Header) — 통합 stats 포함**을 참조하세요.

## 화면 5 — (DEPRECATED) 요약 스트립 — 화면 0에 흡수됨

> header-summary-merge ADR-001로 `.summary-strip` DOM 자체가 제거되었습니다.
> 7개 stat chip(활성 / 오류율 / 평균 / P95 / 세션 / 요청 / 토큰)은 **화면 0의 0-2 헤더 중앙 영역**에 통합되었습니다.
> 상태 클래스(`is-active-indicator` / `is-error` / `is-critical`)는 의미 그대로 `.header-stat`에 적용됩니다.

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
| 2026-04-20 | 3 | 좌측 패널 섹션 접기/펼치기 토글 버튼 추가 (프로젝트/세션/툴 통계) | left-panel-collapse |
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
| 2026-04-21 | 1-2, 2-1 | 타입 필터 버튼 7개로 확장(순서: All/prompt/Agent/Skill/MCP/tool_call/system). Agent=orange(--orange), Skill=orange, MCP=cyan(#22d3ee). data-sub-type 속성, 클라이언트 필터링, fetchRequests 스킵 버그 수정 | type-filter-expansion |
| 2026-04-21 | 2-2 | 목록/카드 토글 제거 → 통합 accordion 카드 뷰. #turnUnifiedBody 단일 컨테이너, turn_index 내림차순, 카드 클릭 시 세부 로그 펼침, _expandedTurnIds Set 상태관리, 키보드 접근성(Enter/Space) | turn-view-unified |
| 2026-04-21 | 3, 0 | btnPanelCollapse를 panel-header에서 .left-panel 직접 자식으로 이동. position:absolute, top:50%, right:-12px, border-radius:50%으로 border floating 배치. 숨김 상태 overflow:visible 전환 | panel-toggle-button-position |
| 2026-04-21 | 1-1 | #chartSection 차트 영역 접기/펼치기 토글 추가. btnToggleChart(.btn-toggle), chart-collapsed 클래스, grid-template-rows 0.25s 전환, spyglass:chart-collapsed localStorage 저장 | chart-section-collapse |
| 2026-04-21 | 2-2 | 턴뷰 세부 행 연속 동일 도구 그룹화. compressContinuousTools SSoT 추출, turn-row-group 헤더(× N 포맷), turn-row-group-children 접기/펼침, chip × N 포맷 통일 | turn-view-action-grouping |
| 2026-04-23 | 전체 | ui-redesign Phase 2 — 14개 ADR 일괄 적용. 3-Tier Hierarchy / 8px Grid / Card / State SSoT / Summary Hero / Filter Grouping / Tools Matrix / Turn Card 강화 / closeDetail 수정 / 키보드 단축키 1차 / localStorage prefix 통일 / TUI maxTokens 200K / TUI AlertBanner 노출 / TUI selectedId 전달 / TUI Top Requests Enter 점프 | ui-redesign |
| 2026-04-23 | 전체 | ui-redesign Phase 3 — 시각 지표 8종 + 가격 정책 + chartSection 통합 + 로고. ADR-015 가격 옵션 2 (USD 제거 → 토큰) / ADR-016 Donut/Cache panel/Tool 카테고리 모드 토글 + Insights 카드 5종 sub-tile / ADR-017 chartSection default↔detail 모드 전환 + detail-header & context-chart 흡수 / ADR-018 로고 홈 복귀 | ui-redesign |
| 2026-04-26 | 0 | Summary Strip을 헤더 chip 그룹으로 통합 (ADR-001). `.summary-strip` DOM 제거 + `.header-stats`·`.header-stat`·`.header-stat-group`·`.header-stat-divider`·`.header-stat--hero` 신규 클래스. 7개 chip(활성/오류율/평균/P95/세션/요청/토큰) + 2개 divider. 상태 클래스(is-active-indicator/is-error/is-critical) 의미 그대로 적용. body grid 4행으로 축소. 반응형 1024/768/480 브레이크포인트 우선순위 노출 | header-summary-merge (Phase 1) |
| 2026-04-26 | 1 | Insights 카드 완전 제거 (ADR-002). HTML/CSS/JS 모두 삭제. metrics-api.js 5종 fetcher 제거 (서버 엔드포인트는 유지). ADR-016 일부 폐기 | header-summary-merge (Phase 1) |
| 2026-04-26 | 0, 1-1 | header-stats를 헤더에서 view-section-header로 이전 (ADR-004). 헤더는 `[.header-left | .header-right]` 단순 구조로 복귀. stats CSS 정의는 default-view.css의 `#chartSection` 컨텍스트로 이동. detail 모드 자동 숨김. 클래스명 SSoT 유지로 JS 무수정. ADR-001 위치 결정 부분 supersede | header-summary-merge (Phase 2) |
| 2026-04-26 | 1-1 | Donut Model 모드 버그 수정 (ADR-005). chart.js에 `setSourceData(kind, data)` / `hasSourceData(kind)` SSoT 캡슐화. 두 종류 데이터(`type`/`model`)를 모듈 내부 보관. fetchDashboard 폴링이 model 활성 typeData를 덮어쓰지 않음. main.js 외부 캐시 변수 제거 | header-summary-merge (Phase 2) |
| 2026-04-26 | 1-1-H | view-section-header 2단 위계 재설계 (ADR-006). 1행 평탄 chip 나열을 column flex + `.vsh-row` 3행 구조로 전환. Title row(라벨+actions) + Hero row(활성/오류율, font-hero 24px) + Secondary row(평균/P95/세션/요청/토큰, border-top 1px). divider DOM/그룹 그라디언트 모두 제거. 라벨/값 순서 swap(값 → 라벨). detail 모드 Hero+Secondary 자동 숨김. 반응형 1024(부제 숨김)/768(Volume chip 숨김)/480(Secondary 전체 숨김) 재조정. `.header-stat-group*` / `.header-stat-divider` 클래스 폐기. `.header-stat*` 시각 클래스 SSoT 유지로 api.js / stat-tooltip.js / chart.js 무수정. 신규 토큰 0 | header-summary-merge (Phase 3) |
| 2026-04-26 | 0-1, 1-1-H, 1-1-cache | **Stats Distribution to Natural Habitat (ADR-007 — ADR-006 supersede)**. ADR-006(2단 위계)이 더 어지러워졌다는 사용자 부정 평가 후 자기비판. 3라운드 회의를 거쳐 stats를 자기 의미와 가까운 영역으로 분산: 활성 세션 → `.badge-live` 안 chip 통합 / 오류율 + 평균 + P95 → `chart-wrap` 안 `.timeline-meta` / 세션 + 요청 + 토큰 → `.cache-panel-overall` 안 `.cps-volume` ('Today Summary' 격상). view-section-header는 단일 flex로 복귀 (요청 추이 라벨 + 부제 + chart-actions만). 폐기 클래스: `.view-section-header--vsh`, `.vsh-row*` (4종), `.header-stat--hero`. 신규 클래스: `.timeline-meta`, `.cps-volume`, `.cps-volume-label`, `.cps-cache`, `.badge-live-label`. chip 클래스 `.header-stat*` 시각 SSoT + 상태 클래스 + DOM ID 8종 + `data-stat-tooltip` 모두 보존 → api.js / stat-tooltip.js / chart.js 무수정. 신규 디자인 토큰 0 | header-summary-merge (Phase 4) |
| 2026-04-26 | 0-1, 1-1-H, 1-1-cache, 1-1-D | **Cleanup & Consolidation (ADR-008 — ADR-007 부분 supersede)**. 사용자 4종 정리 요청 처리: (1) cache-mode-toggle / cache-panel-matrix / fetchCacheMatrix / renderCacheMatrix / initCacheModeToggle 완전 제거 — cache-panel은 Hit Rate / Cost / Creation·Read 단일 책임. (2) donut-mode-toggle 제거, donutMode 초기값 `'model'`로 변경, setChartMode가 default→model / detail→type 자동 결정. (3) cps-volume → timeline-meta 통합 — 두 그룹 (지난 30분 / 오늘) 라벨 + flex space-between + flex-wrap. divider DOM 0. (4) btn-close + detail-actions-sep 제거 — closeDetail 함수는 유지 (Esc / 로고 트리거). 신규 클래스: `.timeline-meta-group`, `.timeline-meta-group-label`. 폐기 클래스: cache-mode/cache-matrix/donut-mode/btn-close/detail-actions-sep/cps-volume/cps-cache 모두. 신규 디자인 토큰 0. JS 무수정 (api.js / stat-tooltip.js / chart.js SSoT). | header-summary-merge (Phase 5) |

---

## 미결 디자인 이슈

| ID | 화면 | 내용 | 우선순위 |
|----|------|------|---------|
| D-001 | 1-2 | 출력 토큰 수집 시 컬럼 복원 및 in/out 색상 구분 | 보류 |
| D-002 | 1-2, 2-1 | 시각 포맷 차이 (대시보드 상대시간 vs 플랫뷰 절대시간) 정책 결정 | 낮음 |
| D-003 | 2-2 | 턴 뷰 tokens_output 표시 — 다른 뷰와 불일치 | 낮음 |
