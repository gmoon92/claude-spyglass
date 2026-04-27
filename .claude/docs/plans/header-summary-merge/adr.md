# ADR — header-summary-merge

> Feature: header-summary-merge
> 작성일: 2026-04-26
> 작성자: Claude Code (designer agent)

상단 stats 영역 통합 + Insights 카드 제거에 대한 아키텍처 결정 기록.

---

## ADR-001: summary-strip을 헤더에 chip 그룹으로 통합

### 상태
**부분 대체됨 (Partially Superseded)** (2026-04-26) — Supersedes `ui-redesign/adr.md` ADR-005 "Summary Strip 3섹션 재구성"
- "summary-strip 제거 + 7개 stat 정보 보존" 결정은 유지
- "헤더 내부에 배치한다" 위치 결정 부분 → ADR-004로 대체됨 (stats는 `.view-section-header`로 이전)
- "chip 평탄 1행 구성" 부분 → ADR-006로 대체됨 (2단 위계: Hero In-Title / Secondary Strip)

### 배경
- 현재 `.summary-strip`은 화면 상단 헤더 바로 아래 별도 행(min-height 56px)으로 7개 stat-card를 표시한다.
- 사용자 피드백: 상단 정보 행이 2개(.header + .summary-strip)로 분리되어 시각 노이즈가 됨. 시선이 한 곳으로 모이지 않는다.
- `.header`(52px)는 로고 / LIVE 배지 / 날짜 필터 / 마지막 갱신만 표시하여 가로 공간이 비어 있다.
- summary-strip의 7개 지표(활성/오류율/평균/P95/세션/요청/토큰)는 정보 자체로는 가치 있어 제거 대상이 아님.
- ADR-005에서 도입한 3섹션(Hero/Performance/Volume) 그룹핑은 시각 위계로 보존할 가치가 있음.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | `.header` 내부에 `.header-stats` chip 그룹으로 통합 | 56px 세로 공간 회수, 시선 1줄 정리, 모든 모드(default/detail)에서 일관된 노출 | 좁은 폭에서 wrap/숨김 처리 필요 |
| B | `chartSection`의 `.view-section-header`에 통합 | 카드 내부 통합으로 카드 호흡 강화 | detail 모드 진입 시 chart 헤더가 세션 메타로 바뀌어 stat 사라짐 |
| C | `.summary-strip` 위치만 헤더 위로 이동 | 시각 변경 최소 | 행 수 그대로 → 세로 공간 회수 효과 없음 |

### 결정
**옵션 A 채택** — `.summary-strip` DOM 블록을 제거하고 `.header` 내부에 `.header-stats` chip 그룹으로 이동한다.

- `.header` 구조: 좌(`.header-left`: 로고 + LIVE) | 중(`.header-stats`: 7개 chip + 2개 divider) | 우(`.header-right`: 날짜 필터 + 마지막 갱신)
- 7개 stat 모두 유지 (활성/오류율/평균/P95/세션/요청/토큰) — 정보 손실 0
- 3그룹 위계(Hero/Performance/Volume)는 `.header-stat-divider`(1px × 14px)로 시각 보존
- 상태 클래스(`is-active-indicator` / `is-error` / `is-critical`)는 새 `.header-stat`에 동등 적용
- DOM ID(`statActive` / `stat-error-rate` / `statAvgDuration` / `stat-p95` / `statSessions` / `statRequests` / `statTokens`) 보존 → `api.js` 변경 최소화
- `data-stat-tooltip` 속성 보존 → `stat-tooltip.js` 변경 0 (셀렉터 기반 호환)

### 이유
1. **세로 공간 회수**: 56px 회수로 메인 콘텐츠 영역 가시성 향상.
2. **시선 일관성**: 상단 정보 영역을 단일 "command bar" 행으로 격상 → dashboard 직관성 강화.
3. **모드 독립성**: 헤더는 default/detail 모드와 무관하게 항상 표시되므로 stat 가시성 항상 보장.
4. **변경 최소화**: DOM ID + data 속성 보존으로 JS 동작 호환 유지. 기존 상태 토글 로직 그대로 사용.

### 영향 / Consequences
- ✅ 56px 세로 공간 회수
- ✅ `.header`가 dashboard "command bar"로 격상
- ✅ default/detail 모드 모두 동일한 stat 노출
- ⚠️ 좁은 폭(< 1024px)에서 chip 일부 우선순위 노출 또는 라벨 단축 필요 (반응형 대응 — ADR-003 참조)
- ⚠️ ADR-005 SSoT 폐기 → screen-inventory.md / design-system.md 동기화 필요

---

## ADR-002: Insights 카드 완전 제거

### 상태
**결정됨** (2026-04-26) — Supersedes `ui-redesign/adr.md` ADR-016 일부 (Insights 카드 도입 결정만 폐기. Donut 모드 토글 / Cache panel 모드 토글 / Tool 카테고리 토글은 유지)

### 배경
- ADR-016(`ui-redesign` Phase 3)에서 default 모드 전용 Insights 카드를 도입했다.
- 5종 sub-tile: 활동 heatmap (7×24) / 컨텍스트 사용률 분포 / 세션당 turn 분포 + Compaction / 에이전트 깊이 분포 / Anomaly 시계열
- 사용자가 도입 후 실 사용성이 낮다고 판단. 차지하는 세로 공간 대비 정보 가치가 낮음.
- 접힘 default(ADR-019)로도 첫 진입 시 ~40px, 펼침 시 280px+ 차지.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | HTML/CSS/JS 완전 제거 | 코드/번들 경량화, 세로 공간 회수, 유지보수 부담 0 | 향후 재도입 시 ADR + 코드 재작성 필요 |
| B | 접힘 default + 옵트인만 유지 | 코드 보존, 사용자 선택 가능 | 사용자가 명시적으로 가치 낮다고 판단 → 옵트인도 의미 없음 |
| C | 별도 페이지로 분리 | 단일 페이지 부담 해소 | 현재 SPA 단일 페이지 정책에 라우팅 추가 부담 |

### 결정
**옵션 A 채택** — Insights 카드 관련 HTML/CSS/JS 코드를 완전히 제거한다.

- `index.html` `<!-- Insights 카드 (ADR-016 — default 모드 전용) -->` 블록 삭제
- `index.html`의 `<link rel="stylesheet" href="/assets/css/insights.css">` 줄 삭제
- 파일 삭제: `packages/web/assets/css/insights.css`, `packages/web/assets/js/insights.js`
- `main.js`: `import { initInsights, loadInsights } from './insights.js';` 제거, `initInsights()` / `loadInsights('24h')` 호출 제거, `is-detail-mode insights hide` 주석/코드 정리
- `metrics-api.js`: Insights 전용 fetcher 5종 제거 (`fetchContextUsage`, `fetchActivityHeatmap`, `fetchTurnDistribution`, `fetchAgentDepth`, `fetchAnomaliesTimeseries`). 다른 곳에서 사용하는 `fetchModelUsage` / `fetchCacheMatrix` / `fetchToolCategories`는 유지.
- 서버 API 엔드포인트(`/api/metrics/context-usage` 등)는 유지 — 향후 재사용 여지 보존.

### 이유
1. **사용자 결정**: 실 사용성이 낮다는 사용자 판단을 존중.
2. **세로 공간**: 접힘 ~40px / 펼침 280px+ 회수 → 기본 뷰 콘텐츠(로그 피드) 가시성 향상.
3. **코드 경량화**: ~240줄 JS, ~235줄 CSS 제거. 5개 fetcher + 5개 렌더 함수 제거로 유지보수 부담 0.
4. **API 보존**: 서버 측 엔드포인트는 유지 → 향후 재도입 시 fetcher만 다시 구현하면 됨.

### 영향 / Consequences
- ✅ 세로 공간 회수 (접힘 ~40px, 펼침 ~280px+)
- ✅ 코드/CSS/번들 경량화 (~470줄 삭제)
- ⚠️ heatmap / context-usage / turn-distribution / agent-depth / anomaly-timeseries 시각화 기능 상실
- ⚠️ 향후 재도입 시 새 ADR + 구현 필요
- ⚠️ ADR-016 일부 폐기 → screen-inventory.md / design-system.md 동기화 필요

---

## ADR-003: Header chip 디자인 토큰 및 상태 클래스 SSoT

### 상태
**부분 대체됨 (Partially Superseded)** (2026-04-26)
- `.header-stat`, `.header-stat-label`, `.header-stat-value`, `.header-stat--hero` 클래스 SSoT는 유지
- 상태 클래스(`.is-active-indicator` / `.is-error` / `.is-critical`) 의미 유지
- DOM ID 보존 / `data-stat-tooltip` 속성 보존 결정 유지
- 신규 토큰 0 정책 유지
- `.header-stat-group(--hero|--performance|--volume)` / `.header-stat-divider` 클래스 SSoT 부분만 ADR-006으로 대체 (구조용 클래스가 `.vsh-row*`로 변경되며 group/divider 폐기)
- Hero 변형 폰트 사이즈가 font-body → font-hero(24px)로 변경됨 (ADR-006)
- 라벨 위치가 값 앞 → 값 뒤(값 → 라벨 순)로 변경됨 (ADR-006)

### 배경
- ADR-001에서 `.summary-strip` → `.header-stats` chip 그룹으로 이동하기로 결정.
- 기존 `.stat-card` 시각 패턴(Hero font-hero 24px / Sub font-body / 활성 dot / 오류 red / critical bg-gradient)을 헤더 chip 형태에 어떻게 매핑할지, 그리고 신규 토큰 추가 여부를 명시 필요.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | 신규 클래스 prefix `.header-stat*` + 기존 토큰 재사용 | 디자인 시스템 변경 0, 시맨틱 명확 | CSS 작성량 약간 증가 |
| B | `.stat-card` 클래스명 그대로 헤더로 이동 | CSS 변경 최소 | 시맨틱 충돌 (별도 영역 카드 ≠ 헤더 chip), 기존 `.summary-strip .stat-card` 셀렉터 잔재 우려 |
| C | 신규 토큰(`--header-stat-*`) 추가 | 헤더 컨텍스트 명시 | 토큰 폭증, SSoT 분산 |

### 결정
**옵션 A 채택** — 신규 클래스 prefix `.header-stat*`를 도입하고 모든 시각 속성은 기존 design-tokens.css 토큰을 재사용한다.

#### 신규 클래스 SSoT (header.css)

| 클래스 | 역할 | 주요 속성 |
|--------|------|-----------|
| `.header-stats` | 7개 chip + 2개 divider 컨테이너 | display: flex; align-items: center; gap: var(--space-3); flex: 1; min-width: 0; overflow: hidden |
| `.header-stat-group` | 그룹 단위 (Hero/Performance/Volume) | display: flex; align-items: center; gap: var(--space-3); min-width: 0 |
| `.header-stat-group--hero` | Hero 그룹 미세 그라디언트 | background: linear-gradient(90deg, rgba(217,119,87,0.04) 0%, transparent 100%) |
| `.header-stat-divider` | 그룹 간 구분선 | width: 1px; height: 14px; background: var(--border) |
| `.header-stat` | chip 단위 카드 | display: inline-flex; align-items: baseline; gap: var(--space-2); padding: 0 var(--space-1); position: relative; white-space: nowrap |
| `.header-stat-label` | 라벨 | font-size: var(--font-micro); color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.07em; font-weight: var(--weight-strong) |
| `.header-stat-value` | 값 | font-size: var(--font-meta); color: var(--text); font-weight: var(--weight-strong); font-variant-numeric: tabular-nums |
| `.header-stat--hero .header-stat-value` | Hero 변형 (활성/오류율) | font-size: var(--font-body); letter-spacing: -0.02em |

#### 상태 클래스 SSoT (기존 의미 보존)

| 클래스 | 의미 | 적용 |
|--------|------|------|
| `.header-stat.is-active-indicator` | activeSessions > 0 | `::before` 6px green dot (box-shadow glow) + `.header-stat-value { color: var(--green) }` |
| `.header-stat.is-error` | errorRate > 0 | `.header-stat-value { color: var(--red) }` |
| `.header-stat.is-critical` | errorRate > 1% | background: linear-gradient(to right, var(--red-bg-subtle), transparent); border-radius: var(--radius-sm) |

#### 토큰 정책

- **신규 토큰 0** — 기존 design-tokens.css 토큰만 사용
  - 색상: `--accent`, `--text`, `--text-dim`, `--green`, `--red`, `--red-bg-subtle`, `--border`
  - 간격: `--space-1`, `--space-2`, `--space-3`
  - 타이포: `--font-micro`, `--font-meta`, `--font-body`, `--weight-strong`
  - 모서리: `--radius-sm`

#### data 속성 호환

- `data-stat-tooltip` 속성을 7개 chip 모두 보존 → `stat-tooltip.js` 무수정
- DOM ID 보존: `statActive` / `stat-error-rate` / `statAvgDuration` / `stat-p95` / `statSessions` / `statRequests` / `statTokens`
- `api.js`의 `closest('.stat-card')` 셀렉터만 `closest('.header-stat')`으로 교체 (총 2곳)

### 이유
1. **디자인 시스템 SSoT 보존**: 신규 토큰 0으로 design-tokens.css 정합성 유지.
2. **시맨틱 명확성**: 헤더 chip은 별도 카드 면적이 아닌 인라인 정보 단위 → `.header-stat*` prefix가 의도 분명히 전달.
3. **호환성 우선**: data 속성 + DOM ID 보존으로 JS 변경 최소화 (셀렉터 2곳만).
4. **반응형 대응**: `.header-stats { overflow: hidden }` + `@media`로 우선순위 노출 처리. 1024px 이하에서 Volume 그룹 단축, 768px 이하에서 Volume 그룹 숨김.

### 영향 / Consequences
- ✅ 디자인 토큰 변경 0 → 다른 컴포넌트 영향 없음
- ✅ stat-tooltip.js 변경 0
- ✅ api.js 셀렉터 2곳만 교체
- ⚠️ 좁은 폭 반응형 우선순위 정책 별도 명시 필요 (Volume 그룹 우선 단축/숨김)

---

---

## ADR-004: header-stats를 view-section-header로 이전

### 상태
**결정됨** (2026-04-26) — Partially Supersedes 본 문서 ADR-001 (위치 결정 부분만)

### 배경
- ADR-001로 summary-strip을 헤더에 통합한 결과를 사용자가 검토.
- 헤더는 글로벌 네비/필터 영역(로고 / LIVE / 날짜 필터 / 갱신 시각)으로 유지하는 것이 정보 위계상 더 적합하다고 판단.
- 통계 chip은 현재 보고 있는 view 컨텍스트에 종속된 정보 — view-section-header에 배치해야 view 전환과의 관계가 자연스럽게 시각화됨.
- detail 모드 진입 시 세션 메타가 `.chart-detail-meta`로 표시되므로 전역 통계는 의미를 잃음 → 모드별 가시성 자동 처리가 view 영역 배치로 자연 해결됨.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | header에서 `chartSection .view-section-header`로 이전 | view 컨텍스트 종속, detail 모드 자동 숨김 (`.chart-mode-detail` 패턴 활용), 헤더는 글로벌 네비로 정리 | view-section-header 폭 부족 시 chart-default-meta + stats 정렬 조정 필요 |
| B | content-switcher 위 별도 stats 영역 신규 | 위치 자유 | Phase 1과 동일한 띠 분리 문제 재발 |
| C | header 유지 (Phase 1 그대로) | 변경 없음 | 사용자 의도 미반영 |

### 결정
**옵션 A 채택** — `.header-stats` DOM을 `.header`에서 `#chartSection .view-section-header` 내부로 이전.

- 헤더는 다시 `[.header-left(로고+LIVE) | .header-right(날짜필터+갱신)]` 단순 구조로 복귀
- stats는 `chart-default-meta`(요청 추이 라벨/부제) 다음에 위치, `.chart-actions`(접기 버튼)는 우측 유지
- detail 모드(`#chartSection.chart-mode-detail`) 진입 시 `.header-stats` 자동 숨김 — 기존 `.chart-default-meta` 숨김과 동일 패턴
- **클래스명 `.header-stat*` SSoT 유지** — api.js / stat-tooltip.js / 상태 클래스 호환성 무손실
- ADR-003에서 정의한 디자인 토큰 / 상태 클래스 SSoT는 그대로 적용
- CSS 정의는 header.css에서 default-view.css(또는 신규 view-stats 영역)로 이동

### 이유
1. **정보 위계 정합성** — 통계가 view 컨텍스트에 속하므로 view 헤더에 위치하는 것이 자연스러움
2. **모드 가시성 자동 처리** — detail 모드에서 세션 메타가 우선이고 전역 통계는 의미를 잃음 → 기존 `.chart-mode-detail` 클래스 패턴 재사용
3. **헤더 단순화** — 글로벌 영역과 컨텍스트 영역 분리 → 시선 흐름 명료
4. **변경 최소화** — 클래스명 유지로 JS 무수정, CSS 정의 위치 이동만 필요

### 영향 / Consequences
- ✅ 헤더 단순화 (글로벌 네비/필터 전용)
- ✅ view-section 컨텍스트와 통계 시각 결합 — view 전환 시 통계도 함께 전환되는 위계 표현
- ✅ detail 모드 자동 숨김 (기존 패턴 재사용)
- ✅ JS / 상태 클래스 / data 속성 무수정
- ⚠️ chartSection 헤더 폭 부족 시 chart-default-meta + stats + chart-actions 한 행 정렬 조정 필요
- ⚠️ chartSection 접힘(`.chart-collapsed`) 상태에서도 헤더는 보이므로 stats는 노출 — 정보 가시성 우선 정책으로 OK

---

## ADR-005: Donut Model 모드 데이터 SSoT 캡슐화 (chart.js 단일 책임)

### 상태
**결정됨** (2026-04-26)

### 배경
- ADR-016에서 도넛 Type/Model 모드 토글을 도입했으나, 다음 버그 발견:
  - main.js에 외부 캐시 변수(`_modelUsageCache`, `_typeDataCache`)가 존재하지만 `_typeDataCache`는 어디서도 set되지 않음.
  - `api.js fetchDashboard()`가 5초 polling으로 `setTypeData(d.types)`를 무조건 호출 → Model 모드 진입 1초 뒤 type 데이터로 typeData가 덮어써져 도넛이 사라짐.
- 사용자 보고: "Model 버튼을 클릭해도 동작하지 않음".
- Java 개발자 사용자의 캡슐화 / 단일 책임 원칙에 따라, 데이터 종류와 모드 동기화는 chart 모듈 내부 책임으로 일원화해야 함.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | chart.js에 `setSourceData(kind, data)` / `hasSourceData(kind)` SSoT 추가 | 단일 책임, 모드와 데이터 동기화가 모듈 내부에서 자동, 외부 캐시 변수 0 | API 추가 |
| B | api.js에서 `if (getDonutMode() !== 'type') return` 가드 | 변경 최소 | 호출자가 모드를 알아야 함 (단일 책임 위반) |
| C | main.js에서 polling 일시 중단 + 재개 | 직관적 | 폴링 매커니즘 복잡화, 다른 dashboard 데이터(stats/projects/tools)도 영향 |

### 결정
**옵션 A 채택** — `chart.js`에 `setSourceData(kind, data)` / `hasSourceData(kind)` API를 추가하고, 두 종류 데이터(`type` / `model`)를 chart 모듈 내부에 보관.

- `setSourceData(kind, data)`: `dataByKind[kind] = data`. `kind === donutMode`일 때만 활성 typeData에 반영.
- `setDonutMode(mode)`: 활성 데이터셋(`typeData`)을 `dataByKind[mode]`로 전환.
- `setTypeData(data)`: 후방 호환 — 내부적으로 `setSourceData('type', data)` 위임. api.js / session-detail.js 무수정.
- `hasSourceData(kind)`: 외부 캐시 hit 검사 (model 모드 진입 시 fetch 필요 여부 판단).
- main.js의 `_modelUsageCache` / `_typeDataCache` 외부 캐시 변수 제거.
- main.js `initDonutModeToggle()` 단순화: `setDonutMode(mode); if (mode==='model' && !hasSourceData('model')) await fetch + setSourceData('model', data); drawDonut(); renderTypeLegend();`.

### 이유
1. **단일 책임** — 도넛 데이터/모드 동기화는 chart 모듈의 책임. 호출자(api.js, main.js)는 자신이 가진 데이터를 종류만 알리면 됨.
2. **fetchDashboard 폴링 안전** — type 데이터를 갱신해도 model 모드 활성 시에는 typeData를 덮어쓰지 않음 (chart.js 내부에서 모드 비교).
3. **후방 호환** — `setTypeData(data)` 시그니처 보존으로 기존 호출처(api.js, session-detail.js) 무수정.
4. **외부 캐시 변수 제거** — main.js의 글로벌 변수 2개 정리, 메모리/상태 추적 단순화.

### 영향 / Consequences
- ✅ Donut Model 토글 정상 동작
- ✅ chart.js 단일 책임 강화 (모드 + 데이터 동기화 SSoT)
- ✅ 외부 캐시 변수 제거 (main.js)
- ✅ session-detail.js의 `setTypeData(sessionTypeData)` 호출도 자동으로 모드 동기화 적용
- ⚠️ `setTypeData` → `setSourceData` 위임 — 호출자는 형식 그대로 사용 가능

---

## ADR-006: View-Section Stats 2단 위계 재설계 (Hero In-Title / Secondary Strip)

### 상태
**결정됨** (2026-04-26) — Partially Supersedes 본 문서 ADR-001 / ADR-003

- ADR-001: "summary-strip 제거 + 7개 stat 정보 보존" 결정 유지. "chip 평탄 1행 구성" 부분만 폐기.
- ADR-003: `.header-stat`, `.header-stat-label`, `.header-stat-value`, `.header-stat--hero` 클래스 SSoT 유지. 상태 클래스(`is-active-indicator` / `is-error` / `is-critical`) 의미 유지. DOM ID / `data-stat-tooltip` 속성 보존 결정 유지. **단, `.header-stat-group(--hero|--performance|--volume)` / `.header-stat-divider` 구조 클래스는 폐기**. Hero 변형 폰트 사이즈가 `font-body` → `font-hero(24px)`로 변경되며 라벨/값 순서가 "라벨 → 값" → **"값 → 라벨"**로 변경.
- ADR-004 (위치 결정 — view-section-header 자식): Status 유지.

### 배경

ADR-001/004 적용 후 사용자 검토:

> "header-stat-group의 컴포넌트들은 매우 중요합니다. 각각 유의미합니다. 하지만 지금 디자인적 요소로서 너무 지저분하게 보입니다. UI가 너무 어지럽고 다시 UI 설계를 해주세요."

**어지러움 원인 진단** (sequential-thinking 분석):

`view-section-header` 한 행에 약 13개 시각 토큰이 동시 존재:
- `chart-default-meta` 2 (라벨+부제) + `header-stats` 10 (7 chip + 2 divider + 1 Hero 그라디언트) + `chart-actions` 1

진단된 8가지 원인:

1. **수평 정보 토큰 폭주** — Miller's law(7±2) 임계 초과
2. **위계 평탄화** — Hero(font-body 13px) vs Secondary(font-meta 11px) 차이 2px만
3. **반복된 라벨 노이즈** — 7개 라벨이 같은 행에서 7번 반복
4. **divider 시각 노이즈** — 1px × 18px 세로선 2개가 시선을 끊음
5. **chart-default-meta와 stats 경합** — 같은 baseline에서 정적/동적 충돌
6. **Hero 그라디언트의 결속 파괴** — chip 배경 처리 불일치
7. **Volume 우측 쏠림** — 큰 숫자가 우측에 몰려 시선 균형 무너짐
8. **chart-actions 충돌** — Volume 숫자와 우측 접기 버튼 시각 경계 약함

핵심: **"7개 chip을 1행 평탄 나열한 구조 자체"가 문제**. 단순 padding/margin 조정으로는 불가 — 레이아웃 패러다임 전환 필요.

### 고려한 옵션

| 옵션 | 설명 | 정보 손실 | 위계 | 노이즈 | 채택 |
|------|------|----------|------|--------|------|
| A | 그룹별 카드/세그먼트(Pill) | 0 | 약 | 약 (카드 in 카드) | × |
| B | Hero 강조 + 나머지 접기 | 5개 숨김 | 강 | 강 | × (요구 위반) |
| C | 도넛 차트와 통합 | 0 | 약 | 약 | × |
| D | 단일 컴팩트 바 | 0 | 없음 | 강 | × (Hero 강조 불가) |
| E | KPI 보드 그리드(7카드) | 0 | 강 | 약 (카드 천국) | × |
| F | 좌측 수직 레일 | 0 | 강 | 양호 | × (구조 변경 폭) |
| **G** | **2단 위계 (Hero In-Title / Secondary Strip)** | **0** | **강 (1.85배)** | **강** | **✅ 채택** |
| H | Sparkline 통합 | 0 | 강 | 보통 | × (작업 범위 폭증) |

(plan.md Phase 3 옵션 비교 ASCII mockup 참조)

### 결정 — 옵션 G 채택

`#chartSection .view-section-header`를 **3행 구조**로 재구성:

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

#### 신규 구조 클래스 (default-view.css)

| 클래스 | 역할 | 주요 속성 |
|--------|------|-----------|
| `.vsh-row` | 한 행 컨테이너 (Title/Hero/Secondary 공통) | display: flex; align-items: center; gap: var(--space-3); min-width: 0 |
| `.vsh-row--title` | Title row | `chart-default-meta` + 우측 `chart-actions` 정렬 |
| `.vsh-row--hero` | Hero row | gap: var(--space-6); padding-top: var(--space-2) |
| `.vsh-row--secondary` | Secondary strip | gap: var(--space-4); border-top: 1px solid var(--border); padding-top: var(--space-2); margin-top: var(--space-1) |

#### 폐기되는 구조 클래스

- `.header-stat-group`
- `.header-stat-group--hero` (Hero 그라디언트 포함)
- `.header-stat-group--performance`
- `.header-stat-group--volume`
- `.header-stat-divider`

#### 유지되는 SSoT 클래스

- `.header-stat` — chip 단위 (display: inline-flex; baseline)
- `.header-stat-value` — 큰 숫자
- `.header-stat-label` — 라벨
- `.header-stat--hero` — Hero 변형. **font-hero 24px / weight-hero**로 변경 (ADR-003에서 font-body였음)
- 상태 클래스: `.is-active-indicator` (dot + green) / `.is-error` (red) / `.is-critical` (red-bg-subtle)
- DOM ID: `statActive` / `stat-error-rate` / `statAvgDuration` / `stat-p95` / `statSessions` / `statRequests` / `statTokens`
- `data-stat-tooltip` 속성

#### 라벨/값 순서 변경

- 기존: `[라벨] [값]` (예: `활성 7`, `오류율 0.5%`)
- 신규: `[값] [라벨]` (예: `7 활성`, `0.5% 오류율`)
- 큰 숫자를 먼저 보여줘 시선 흐름 명료화. Hero 행에서 특히 효과적.

#### Hero dot 처리

- `.is-active-indicator::before { 6px green dot }` 기존 정의 유지.
- Hero 행에서 padding-left를 `font-hero` 폰트에 맞춰 조정 (`var(--space-3)` 정도). 토큰 신규 추가 없이 처리.

#### detail 모드 가시성

```css
#chartSection.chart-mode-detail .vsh-row--hero,
#chartSection.chart-mode-detail .vsh-row--secondary {
  display: none;
}
```

기존 `.chart-mode-detail` 패턴 재사용. `chart-default-meta` 숨김 로직과 동일.

#### 반응형

| 폭 | 동작 |
|----|------|
| ≤ 1024px | `chart-default-meta` 부제(`#chartSubtitle`) 숨김 또는 단축 |
| ≤ 768px | Secondary strip Volume(세션/요청/토큰) chip 숨김 |
| ≤ 480px | Secondary strip 전체 숨김. Hero row만 노출 |

#### 토큰 정책

**신규 토큰 0** — 기존 design-tokens.css 토큰만 사용:
- 색상: `--accent`, `--text`, `--text-dim`, `--green`, `--red`, `--red-bg-subtle`, `--border`
- 간격: `--space-1`, `--space-2`, `--space-3`, `--space-4`, `--space-6`
- 타이포: `--font-micro`, `--font-meta`, `--font-body`, `--font-hero`, `--weight-strong`, `--weight-hero`
- 모서리: `--radius-sm`

### 이유

1. **Hero가 진짜 Hero** — font-hero(24px) vs Secondary font-body(13px) = 약 1.85배 시각 면적. 한눈에 강조 인지.
2. **어지러움 원인 직접 제거** — divider 2개·Hero 그라디언트 0. 진단 (4)·(6)·(8) 해소.
3. **시각 chunking** — 행 분리로 Hero 2 + Secondary 5 → 각 행이 7±2 적합. 진단 (1) 해소.
4. **시선 흐름 명료** — 값 → 라벨 순. 큰 숫자가 먼저 보이고 라벨은 보조. 진단 (3) 해소.
5. **JS 무수정 호환** — `.header-stat*` 시각 클래스, 상태 클래스, DOM ID, data 속성 모두 유지 → api.js / stat-tooltip.js / chart.js 무수정.
6. **detail 모드 자동 처리** — 기존 `.chart-mode-detail` 패턴 재사용.
7. **신규 토큰 0** — 디자인 시스템 SSoT 무손상.

### 영향 / Consequences

- ✅ Hero 압도성 시각화 (font-hero 24px)
- ✅ divider 0 / 그룹 그라디언트 0 (시각 노이즈 핵심 제거)
- ✅ 정보 손실 0 (7개 stat 모두 유지)
- ✅ JS 무수정 (api.js / stat-tooltip.js / chart.js)
- ✅ 상태 클래스 / DOM ID / data 속성 호환
- ⚠️ view-section-header 세로 약 40px → 88px 증가 (차트 영역 약 48px 감소) — 사용자가 "패러다임 자체를 재고" 명시했으므로 trade-off 수용
- ⚠️ ADR-001/003 부분 supersede → screen-inventory.md / design-system.md 동기화 필요
- ⚠️ HTML 구조 변경(group/divider DOM 제거 + vsh-row 추가) → index.html 일부 재작성 필요

> **사후 평가 (2026-04-26)**: 위 ADR-006의 모든 결정과 영향은 사용자 검토 후 부정적 평가를 받음. ADR-007에서 완전 supersede.

---

## ADR-007: Stats Distribution to Natural Habitat (자연스러운 거처로의 분산)

### 상태
**결정됨** (2026-04-26) — **Supersedes ADR-001(완전), ADR-004(완전), ADR-006(완전), ADR-003(부분)**

| 폐기 ADR | 대체 사유 |
|----------|----------|
| ADR-001 헤더 통합 | "통째로 한 곳에 모은다"는 발상 자체 폐기 |
| ADR-004 view-section-header 이전 | 위치 결정 자체 폐기 |
| ADR-006 2단 위계 | "통합 후 위계 강화" 발상 전체 폐기 |
| ADR-003 Header chip SSoT 부분 | `.header-stat--hero` 변형 / `.header-stat-group*` / `.header-stat-divider` 폐기. `.header-stat`, `.header-stat-value`, `.header-stat-label`, 상태 클래스, DOM ID, `data-stat-tooltip` SSoT는 유지 |

### 배경

ADR-006(2단 위계) 적용 후 사용자 부정적 피드백:

> "view-section-header 헤더 자체엔 '요청 추이'라는 타이틀만 남기고, 각 정보들을 cache-panel-overall 패널에 넣는건 어떻게 생각해? 너가 진짜 이게 정말 맞다고 생각하는거야? 너무 더 디자인이 이상해졌어."

### ADR-006 자기비판

표면 검증(Miller's law / 위계 / divider)은 통과했지만 더 큰 그림에서 다음 실수:

1. **chartSection 비대화** — view-section-header 약 40px → 약 88px. 차트 본체 자리를 헤더가 잡아먹었다.
2. **위계 역전** — Hero font-hero(24px) 두 개가 차트 헤더 안에 들어가 헤더가 차트보다 시각 무게중심이 됐다.
3. **stats를 헤더의 본질로 오해** — view-section-header의 본질은 "이 섹션이 무엇인가"(요청 추이). stats는 별개 정보.
4. **"각각 유의미"의 잘못된 해석** — 사용자 의도는 "각자 자기 자리"인데, "한 곳에 모아 위계로 정렬"로 잘못 해석.
5. **자기검열 부재** — ASCII mockup만 보고 옵션 G가 1순위라는 형식 논리에 갇혔다.

**근본 진단**: ADR-001/004/006 모두 "stats를 어디에 통째로 둘까"의 답을 찾았는데, 진짜 답은 **"통째로 두지 말고 각자의 거처로 분산"**.

### Round 1 — 진단 회의 (전문가 발언)

**A (정보 아키텍트)**: "ADR-006이 어지러운 진짜 이유는 7개 stat이 모두 한 컨테이너에 속한다는 가정. 정보 아키텍처로 분류하면 3카테고리:
- 활성 세션 = 시스템 상태(state)
- 오류율 / 평균 / P95 = 요청 품질(quality, timeline 부속)
- 세션 / 요청 / 토큰 = 볼륨(누적치)
각 카테고리는 다른 거처가 있어야 자연스럽다."

**V (시각 디자이너)**: "Hero 24px가 너무 컸다. 차트 위 헤더 안에 24px 두 개가 들어가면 차트 자체보다 헤더가 시각 무게중심이 된다. 위계 역전. 해결 방향 — 헤더를 가볍게(요청 추이 타이틀만), stats는 자기 시각 무게에 어울리는 위젯과 결합."

**U (UX 연구자)**: "사용자 의도는 '각 정보가 다른 정보의 컨텍스트가 되어야 한다'. 단독 KPI가 아니라 컨텍스트 정보. 다만 모두 cache에 몰면 거대해진다. 카테고리별 분산이 맞다."

### Round 2 — 분배 회의 (7개 매핑)

| stat | 카테고리 | 거처 결정 | 결정 근거 |
|------|---------|----------|----------|
| 활성 세션 | 시스템 상태 | 글로벌 헤더 `.badge-live` | LIVE 배지와 의미 결합. dot 모양도 의미 강화. 글로벌 정보는 글로벌 영역에. |
| 오류율 | 요청 품질 | timeline 영역 `.timeline-meta` | timeline 시계열의 직접 부속. |
| 평균 응답 | 요청 품질 | timeline 영역 `.timeline-meta` | timeline 컨텍스트 자연스러움. |
| P95 | 요청 품질 | timeline 영역 `.timeline-meta` | 평균과 같은 라인. |
| 세션 수 | 볼륨 | cache-panel `.cps-volume` | "오늘의 활동" Volume row. cache-panel을 'Today Summary'로 격상. |
| 요청 수 | 볼륨 | cache-panel `.cps-volume` | Volume row. |
| 토큰 | 볼륨 | cache-panel `.cps-volume` | cache cost 섹션과 의미 결합 (둘 다 토큰 단위). |

### Round 3 — 통합 검증 (자기검열 7가지)

1. timeline meta 어지러움? → 차트 자막 같은 위치. 자연스러운 컨텍스트.
2. cache-panel 'Today Summary' 격상으로 정체성 흐려짐? → 확장. Volume + 캐시 효율은 모두 "오늘의 활동" 묶음.
3. LIVE 배지 비대화? → `●LIVE · 7` 약 11~12자. 컴팩트.
4. cache-panel-overall에 안 넣고 분산하면 사용자 의도 위반? → 사용자가 "어떻게 생각해?"로 의견 물었고, 추가 지시에서 "cache-panel-overall이 거대해지는 것을 경계"라고 직접 언급. 분산이 사용자 의도에 더 충실.
5. view-section-header에 진짜 타이틀만? → 사용자 제시안의 본질.
6. 7개 stat 모두 정보 손실 없이? → 매핑 완료.
7. ADR-001/004/006 supersede가 큰 변경? → 반복되는 디자인 결정 실패의 종착점.

(plan.md Phase 4 Round 3 상세 참조)

### 결정

#### 1. 글로벌 헤더 LIVE 배지에 활성 세션 통합

```html
<div class="badge-live" id="liveBadge">
  <span class="live-dot"></span>
  <span class="badge-live-label">LIVE</span>
  <span class="header-stat" id="activeCard" data-stat-tooltip="active">
    <span class="header-stat-value" id="statActive">7</span>
  </span>
</div>
```

- `.header-stat` chip이 LIVE 배지 안에 들어가지만 외관은 통합된 한 단위
- `.is-active-indicator` 토글 시 `::before` dot은 `.badge-live` 컨텍스트에서 숨김 (live-dot과 충돌 방지) — 값 색상만 green으로 유지

#### 2. timeline 영역의 meta line — 오류율 + 평균 + P95

`.chart-wrap`을 column flex로 전환. `.timeline-meta` row를 canvas 위에 inline meta 한 줄로 배치.

```html
<div class="chart-wrap">
  <div class="timeline-meta" id="timelineMeta">
    <span class="header-stat" data-stat-tooltip="avg-duration">
      <span class="header-stat-value" id="statAvgDuration">--</span>
      <span class="header-stat-label">평균</span>
    </span>
    <span class="header-stat" data-stat-tooltip="p95">
      <span class="header-stat-value" id="stat-p95">--</span>
      <span class="header-stat-label">P95</span>
    </span>
    <span class="header-stat" data-stat-tooltip="err">
      <span class="header-stat-value" id="stat-error-rate">--</span>
      <span class="header-stat-label">오류율</span>
    </span>
  </div>
  <canvas id="timelineChart" height="64"></canvas>
  ...
</div>
```

- chip은 `inline-flex; baseline; gap: var(--space-1)`. font-meta 값 + font-micro 라벨.
- detail 모드(`#chartSection.chart-mode-detail .timeline-meta`) 자동 숨김.

#### 3. cache-panel-overall 'Today Summary' 격상 — Volume row

```html
<div class="cache-panel-overall" id="cachePanelOverall">
  <div class="cps-volume" role="group" aria-label="오늘의 활동 요약">
    <span class="cps-volume-label">오늘</span>
    <span class="header-stat" data-stat-tooltip="sessions">
      <span class="header-stat-value" id="statSessions">--</span>
      <span class="header-stat-label">세션</span>
    </span>
    <span class="header-stat" data-stat-tooltip="requests">
      <span class="header-stat-value" id="statRequests">--</span>
      <span class="header-stat-label">요청</span>
    </span>
    <span class="header-stat" data-stat-tooltip="tokens">
      <span class="header-stat-value" id="statTokens">--</span>
      <span class="header-stat-label">토큰</span>
    </span>
  </div>
  <div class="cps-cache">
    <div class="cache-section" data-cache-panel-tooltip="hit-rate">...</div>
    <div class="cache-section" data-cache-panel-tooltip="cost">...</div>
    <div class="cache-section" data-cache-panel-tooltip="ratio">...</div>
  </div>
</div>
```

- `.cache-panel-overall`을 column flex로 전환 (Volume 위 / cache 아래)
- `.cps-volume` Volume row: `오늘` 라벨 + 3 chip
- `.cps-cache` wrapper: 기존 3 cache-section을 감싸 horizontal layout 유지
- 기존 `.cache-section + .cache-section { border-left }` 동작은 `.cps-cache` 내부에서 그대로 작동

#### 4. view-section-header 비우기

vsh-row* 모두 제거. 단일 행 flex로 복귀(Phase 1 형태). "요청 추이 (실시간)" + 부제 + chart-actions만 보유.

#### 5. 폐기되는 클래스

- `.view-section-header--vsh`
- `.vsh-row`, `.vsh-row--title`, `.vsh-row--hero`, `.vsh-row--secondary`
- `.header-stat--hero` (Hero 변형 자체 폐기 — 분산 후 모든 chip이 같은 위계)
- `.header-stat-group*`, `.header-stat-divider` (이미 ADR-006에서 폐기)

#### 6. 유지되는 SSoT (변경 0)

- `.header-stat` chip 클래스 (모든 거처에서 동일)
- `.header-stat-value`, `.header-stat-label`
- 상태 클래스: `.is-active-indicator`, `.is-error`, `.is-critical`
- DOM ID 7종 + `activeCard`
- `data-stat-tooltip` 속성

### 이유

1. **각 stat이 자기 의미와 가까운 영역에 안착** — 정보 아키텍처 정합성
2. **시각 무게 중심이 차트로 복귀** — 차트 섹션의 본질 회복
3. **헤더 가벼움** — view-section-header가 진짜로 "이 섹션이 무엇인가"만 알림
4. **JS 무수정** — api.js / stat-tooltip.js / chart.js 모두 그대로 동작
5. **신규 토큰 0** — 디자인 시스템 SSoT 무손상
6. **사용자 의도 충실** — 사용자 제시안의 본질("타이틀만 남기고 분산") 그대로 구현

### 영향 / Consequences

- ✅ view-section-header 다이어트 (약 88px → 약 28~32px)
- ✅ 차트가 차트 섹션의 시각 중심 회복
- ✅ 각 stat이 의미적으로 자연스러운 거처에 위치
- ✅ cache-panel이 'Today Summary'로 정체성 명확
- ✅ JS 핵심 SSoT 무수정 (`closest('.header-stat')` / DOM ID / `data-stat-tooltip` / `chart.js` 모두 그대로)
- ✅ 신규 디자인 토큰 0
- ⚠️ ADR-001/004/006 모두 supersede — 디자이너 자기비판 후 재학습 결과
- ⚠️ index.html / default-view.css / header.css / cache-panel.css 모두 변경 필요
- ⚠️ chart-wrap이 column flex로 전환되어 canvas 폭 동작 검증 필요 (Playwright 통과)
- ⚠️ **LIVE 배지 chip 보존 보강**: api.js / infra.js의 `showError`/`clearError`가 `liveBadge.innerHTML = '<span class="dot"></span>OFFLINE'`로 chip(`#activeCard` / `#statActive`)을 통째로 날리던 동작 → infra.js에 `setLiveStatus(connected)` helper 추가하여 클래스 토글 + `.badge-live-label` 텍스트만 갱신. chip DOM 보존 → fetchDashboard 재호출 시 null 참조 에러 해소. JS 시그니처 `setLiveStatus(connected: boolean)` 추가, 호출처 4곳(api.js showError, infra.js showError·clearError) 모두 helper 위임. Java 캡슐화 원칙 준수 (시각 전환 단일 책임)

---

## 폐기/대체 ADR 추적

| 기존 ADR | 위치 | 상태 변경 | 사유 |
|---------|------|----------|------|
| ADR-005 (Summary Strip 3섹션) | `ui-redesign/adr.md` | Superseded by 본 문서 ADR-001 → 다시 ADR-007로 무효화 | summary-strip 자체는 ADR-001로 제거됨 (decision 유지) |
| ADR-016 (Donut/Cache/Tool 토글 + Insights 카드) 中 Insights 부분만 | `ui-redesign/adr.md` | Partially Superseded by 본 문서 ADR-002 | Insights 카드만 제거. Donut/Cache/Tool 토글은 유지 |
| ADR-019 (right-panel 자체 스크롤) | `ui-redesign/adr.md` | Status 유지 | min-height 360px 임계값 그대로 유효 |
| 본 문서 ADR-001 (헤더 통합 위치) | `header-summary-merge/adr.md` | **완전 Superseded by ADR-007** | "통째로 한 곳에 모은다" 발상 자체 폐기. 분산 정책으로 전환 |
| 본 문서 ADR-003 (Header chip SSoT) | `header-summary-merge/adr.md` | **부분 Superseded by ADR-007** | `.header-stat--hero`, `.header-stat-group*`, `.header-stat-divider` 모두 폐기. `.header-stat` 시각 클래스, 상태 클래스, DOM ID, data 속성 SSoT는 유지 |
| 본 문서 ADR-004 (view-section-header 이전) | `header-summary-merge/adr.md` | **완전 Superseded by ADR-007** | view-section-header에 stats 두는 것 자체를 폐기 |
| 본 문서 ADR-006 (2단 위계) | `header-summary-merge/adr.md` | **완전 Superseded by ADR-007** | "통합 후 위계 강화" 발상 전체 폐기. vsh-row* 전부 폐기. 사용자 부정적 피드백 후 자기비판 → 분산으로 전환 |
| 본 문서 ADR-005 (Donut Mode SSoT) | `header-summary-merge/adr.md` | **부분 보강 by ADR-008** | setSourceData/setDonutMode/hasSourceData/getDonutMode SSoT 유지. donut-mode-toggle 폐기로 호출 패턴이 toggle handler에서 setChartMode 자동 호출로 단순화. detail 모드는 type 도넛 유지(session-detail.js 호환), default 모드는 model 도넛. |
| 본 문서 ADR-007 (분배 매핑) | `header-summary-merge/adr.md` | **부분 Superseded by ADR-008** | 활성 세션 → `.badge-live` / 품질 3개 → `.timeline-meta` 결정은 유지. **세션·요청·토큰의 거처가 `.cps-volume` → `.timeline-meta` 볼륨 그룹으로 이동**. 'Today Summary' 격상 폐기 → cache-panel-overall이 cache 효율 단일 책임으로 복귀. |

---

## ADR-008: Cleanup — cache-mode/donut-mode toggle 제거 + cps-volume timeline-meta 통합 + btn-close 제거

### 상태
**결정됨** (2026-04-26) — Partially supersedes ADR-005 (단순화), ADR-007 (분배 매핑 갱신)

### 배경

ADR-007 적용 후 사용자 4종 정리 요청:

> 1. cache-mode-toggle 영역은 필요 없습니다. 관련 스크립트가 다른 기능과 의존되어 있지 않다면 제거하세요.
> 2. donut-meta에서 model만 유의미한 것 같습니다. 타입은 시각적 데이터도 필요 없으니 정리해주세요. 모델 값으로 기본적으로 노출합시다.
> 3. cps-volume 영역의 정보를 timeline-meta 영역에 통합하고 기존 정보를 재배치하세요.
> 4. view-section-header 영역에 btn-close 기능은 필요 없습니다. 제거하세요.

핵심 의도: **"필요 없는 것 모두 제거하고 시각을 더 정돈"**.

### 의존성 분석 (제거 안전성 확인)

| 영역 | 외부 의존 | 안전 여부 |
|------|----------|----------|
| cache-mode-toggle / cache-panel-matrix | initCacheModeToggle / renderCacheMatrix / fetchCacheMatrix(1곳) | ✅ 안전 |
| donut-mode-toggle | initDonutModeToggle / setDonutMode SSoT | ⚠️ chart.js mode SSoT 단순화 필요 (detail 모드는 type 도넛 유지) |
| btn-close (#btnCloseDetail) | click handler 1개 / closeDetail 함수는 Esc·로고도 사용 | ✅ UI만 제거, 함수 유지 |
| cps-volume | api.js setStatSessions/Requests/Tokens — DOM ID 보존 시 무수정 | ✅ 위치 이동만 |

### 결정

#### 1. cache-mode-toggle / cache-panel-matrix 완전 제거

- HTML: `<div class="cache-mode-toggle">` 블록, `<div class="cache-panel-matrix">` 블록
- CSS: `.cache-mode-toggle`, `.cache-mode-btn`, `.cache-panel-matrix`, `.cache-matrix-row/name/bar*/rate` 전부
- JS: `initCacheModeToggle()`, `renderCacheMatrix()`, `_cacheMatrixCache`, `fetchCacheMatrix` import — 모두 제거
- main.js의 `initCacheModeToggle()` 호출 줄 제거
- metrics-api.js의 `fetchCacheMatrix` 함수 정의도 사용처 0이 되므로 제거
- 서버 endpoint `/api/metrics/cache-matrix`는 유지 (다른 도구 재사용 가능성, ADR-002 정책 동일)

#### 2. donut MODEL 기본 + TYPE 모드 자동 결정 (detail 한정)

- HTML: `<div class="donut-mode-toggle">` 블록 제거
- CSS: `.donut-mode-toggle`, `.donut-mode-btn` 정의 제거
- JS:
  - main.js `initDonutModeToggle()` 함수 + 호출 제거
  - main.js `setChartMode(mode)`를 보강:
    - `mode === 'default'` → `setDonutMode('model')`. 첫 진입 시 `fetchModelUsage` + `setSourceData('model', data)`
    - `mode === 'detail'` → `setDonutMode('type')` (기존 session-detail.js의 `setTypeData` 호환)
  - chart.js `donutMode` 초기값 `'model'`로 변경
  - chart.js의 setSourceData/setDonutMode/hasSourceData/getDonutMode SSoT는 유지 (detail의 type 호환에 필수)

#### 3. cps-volume → timeline-meta 통합 (그룹 재배치)

```html
<div class="timeline-meta" id="timelineMeta" role="group" aria-label="요약 지표">
  <div class="timeline-meta-group" role="group" aria-label="요청 품질 (지난 30분)">
    <span class="timeline-meta-group-label">지난 30분</span>
    <div class="header-stat" data-stat-tooltip="avg-duration">
      <span class="header-stat-value" id="statAvgDuration">--</span>
      <span class="header-stat-label">평균</span>
    </div>
    ... P95, 오류율
  </div>
  <div class="timeline-meta-group" role="group" aria-label="누적 볼륨 (오늘)">
    <span class="timeline-meta-group-label">오늘</span>
    <div class="header-stat" data-stat-tooltip="sessions">
      <span class="header-stat-value" id="statSessions">--</span>
      <span class="header-stat-label">세션</span>
    </div>
    ... 요청, 토큰
  </div>
</div>
```

- CSS: `.timeline-meta { justify-content: space-between; flex-wrap: wrap }`, `.timeline-meta-group { display: flex; align-items: baseline; gap: var(--space-3) }`, `.timeline-meta-group-label { font-micro / text-dim / uppercase }`
- 두 그룹 사이 큰 gap (space-between) — divider DOM 0
- 좁은 폭에서 자동 wrap (graceful degradation: 품질 한 줄 / 볼륨 한 줄)

#### 4. cache-panel-overall 단순화

- cps-volume 제거 후 cache-panel-overall은 cps-cache wrapper만 남음
- cps-cache wrapper도 폐기하고 cache-section 3개를 cache-panel-overall 직접 자식으로 복귀
- cache-panel-overall: `display: flex` (horizontal 3 cache-section, ADR-007 이전 상태로 복귀)
- 'Today Summary' 격상 폐기 → cache 효율 단일 책임 복귀

#### 5. btn-close 제거

- HTML: `<button class="btn-close chart-detail-only" id="btnCloseDetail">` + 앞 `<span class="detail-actions-sep">` 모두 제거
- CSS: `detail-view.css`의 `.btn-close`, `.detail-actions-sep` 정의 모두 제거
- main.js: `document.getElementById('btnCloseDetail')?.addEventListener('click', closeDetail);` 줄 제거
- `closeDetail()` 함수 자체는 유지 (Esc / 로고 클릭 트리거 보존)

### ADR-007 분배 매핑 갱신

| stat | 거처 (ADR-007) | 거처 (ADR-008) |
|------|----------------|----------------|
| 활성 세션 | `.badge-live` | 변경 없음 |
| 오류율 | `.timeline-meta` | `.timeline-meta .timeline-meta-group` (지난 30분) |
| 평균 응답 | `.timeline-meta` | `.timeline-meta .timeline-meta-group` (지난 30분) |
| P95 | `.timeline-meta` | `.timeline-meta .timeline-meta-group` (지난 30분) |
| 세션 수 | `.cps-volume` | **`.timeline-meta .timeline-meta-group` (오늘)**으로 이동 |
| 요청 수 | `.cps-volume` | **`.timeline-meta .timeline-meta-group` (오늘)**으로 이동 |
| 토큰 | `.cps-volume` | **`.timeline-meta .timeline-meta-group` (오늘)**으로 이동 |

### 이유

1. **죽은 코드 정리** — cache-mode-toggle / matrix는 사용성이 낮아 제거. 약 50줄 JS / 60줄 CSS / 6줄 HTML 회수.
2. **donut 단일 책임** — 모드 토글 폐기 + setChartMode가 모드 자동 결정. 사용자 클릭 절약. detail 모드 type 도넛 의미 보존.
3. **cache-panel 정체성 회복** — Today Summary 격상은 cps-volume이 사라지면서 자연스레 cache 효율 단일 책임으로 복귀.
4. **timeline-meta 시간 컨텍스트 명확화** — "지난 30분"(timeline 윈도우) / "오늘"(누적) 라벨로 두 그룹 의미 분리.
5. **btn-close 중복 제거** — Esc / 로고 클릭으로 충분. UI 단순화.
6. **JS 호환** — DOM ID 8종 + data 속성 + closest selector 모두 보존 → api.js / stat-tooltip.js / chart.js SSoT 무수정.
7. **신규 토큰 0** 정책 유지.

### 영향 / Consequences

- ✅ cache-panel 우상단 [전체|모델별] toggle 제거
- ✅ donut 우하단 [TYPE|MODEL] toggle 제거 — model이 default 기본
- ✅ timeline-meta가 6개 stat 모두 보유 (시간 컨텍스트 라벨로 그룹 명확)
- ✅ btn-close 제거 — view-section-header 더 가벼워짐
- ✅ cache-panel-overall이 cache 효율 단일 책임 회복
- ✅ JS / DOM ID / data 속성 / chart.js SSoT 모두 호환
- ✅ 신규 디자인 토큰 0
- ⚠️ ADR-007 cps-volume 격상 폐기 (cache-panel 'Today Summary' 정체성 무효)
- ⚠️ ADR-005 setDonutMode 호출 패턴이 toggle handler에서 setChartMode로 이동 (단방향 의존성)
- ⚠️ index.html / default-view.css / cache-panel.css / detail-view.css / main.js / chart.js / metrics-api.js 모두 변경
- ⚠️ 서버 endpoint `/api/metrics/cache-matrix`는 유지하지만 클라이언트 호출 0
