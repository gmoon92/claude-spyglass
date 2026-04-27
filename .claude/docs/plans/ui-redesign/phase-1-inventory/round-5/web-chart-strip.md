# web-chart-strip — Chart Strip (W4)

> Right Panel 상단 차트 띠. 타임라인 + 도넛(타입별 비율 + 범례) + Cache Intelligence Panel.
> `chartSection` 단위로 접기/펼치기. 5라운드 누적 인벤토리.

---

## R1 — 1차 작성

### 컨테이너 (`#chartSection.view-section`)

- 헤더: panel-label "요청 추이 (실시간)" + chartSubtitle "최근 30분"
- 토글 버튼: `#btnToggleChart.btn-toggle` (chevron-down SVG, 12x12)
- 클릭 → `toggleChartCollapse()` → `.chart-collapsed` 클래스 토글 + localStorage 저장
- 펼침/접힘 애니메이션: grid-template-rows 0.25s 전환
- localStorage: `spyglass:chart-collapsed`
- 페이지 로드 시 `restoreChartCollapsedState()` 복원

### 차트 내부 (`.charts-inner`, 3분할)

#### Timeline Chart (Canvas, height=100)

- DOM: `#timelineChart` (canvas, parent `.chart-wrap`)
- 30분 버킷 (1분 단위)
- `recordRequest()` SSE 수신 시 카운트
- `advanceBuckets()` 1분 마다 자동 시프트
- `drawTimeline()` 렌더링:
  - DPR 처리
  - 격자선 (3개 horizontal, border 색)
  - X축 라벨 3개 (시작/중간/끝, 한국어 시간 포맷)
  - Y축 라벨 (max 값 1/2)
  - Area fill (gradient, accent → transparent)
  - Line stroke (accent, 1.5px)
  - 마지막 포인트 dot (3px, accent fill)
  - 마지막 카운트 텍스트 표시 (>0일 때)
- ResizeObserver로 부모 크기 변경 시 redraw

#### Donut Chart (Canvas 90x90)

- DOM: `#typeChart` (canvas, parent `.donut-wrap`)
- 데이터: `typeData` — prompt/tool_call/system 비율
- `drawDonut()`:
  - DPR 처리
  - 빈 상태: border 색 원형 (no slice)
  - 슬라이스: TYPE_COLORS 기준 (CSS 변수 동기화)
  - 중앙 텍스트: total (>=1000이면 k 포맷, 12px) + "total" (8px)
- TYPE_COLORS는 `initTypeColors()`로 CSS 변수에서 읽어옴

#### Type Legend (`#typeLegend.type-legend`)

- 도넛 옆 (donut-section)
- legend-item 반복: `legend-dot` (배경색) + `legend-name` + `legend-val` + `legend-pct`
- 빈 상태: "데이터 없음"

#### Type Total (`#typeTotal`)

- 도넛 하단 텍스트: `${total}건` (한국어 콤마)

### Cache Intelligence Panel (`#cachePanel.cache-panel`)

세 섹션:

#### Hit Rate (`data-cache-panel-tooltip="hit-rate"`)
- 라벨 "Hit Rate"
- 막대 (`.cache-bar-wrap > .cache-bar-fill`) — width 동적
- 색상: `>=70%` `is-high`, `>=30%` `is-mid`, 그 외 `is-low`
- 퍼센트 텍스트 (`#cacheHitPct`)

#### Cost Comparison (`data-cache-panel-tooltip="cost"`)
- without cache (`#cacheCostWithout`): `$X.XX`
- actual cost (`#cacheCostActual`, `.is-actual`): `$X.XX`
- saved (`#cacheCostSaved`, `.is-saved`): `$X.XX (rate%)`

#### Creation / Read Ratio (`data-cache-panel-tooltip="ratio"`)
- 라벨 "Creation / Read"
- 더블 바 (cache-ratio-creation + cache-ratio-read), 각 width %
- 라벨 텍스트 (`#cacheRatioLabel`): readPct >= 70% → "stable", 그 외 → "building"

#### Tooltip
- `cache-panel-tooltip.js` — hover 시 3개 섹션별 상세 툴팁

---

## R2 — 검토

1. **Chart Section 접기 단위**: 차트 + 도넛 + 캐시 패널 셋 다 같이 접힘 — 사용자가 한 영역만 보고 싶을 때 분리 불가.
2. **Timeline X축 라벨 3개만**: 시작/중간/끝. 30분 동안 더 세분화된 라벨 부재.
3. **Y축 라벨**: max값의 0/0.5/1 위치에 텍스트. 0 라벨은 출력 안 함 (조건 `t > 0`).
4. **Donut 빈 상태 시 텍스트 없음**: "data-empty" 같은 시각 단서 부재 — 빈 원만.
5. **Type Legend 정렬**: prompt/tool_call/system 순서가 데이터 정렬에 의존 (`d.count` 내림차순 정렬). 일관 색 매핑 의도와 충돌 가능.
6. **Cache Hit Rate 색상 임계값**: 30/70 두 단계만, 더 세분화 가능.
7. **Cost rate display**: `(rate%)` — saved % 표기. saved 0일 때 `(0%)` 표시.
8. **`buildQuery` 날짜 범위와 차트**: 날짜 필터 변경 시 fetchDashboard 호출 → typeData 갱신 → drawDonut/renderTypeLegend. 그러나 Timeline은 항상 "최근 30분"으로 SSE 기반 → chartSubtitle 텍스트만 변경, 데이터는 변경 안 됨. **불일치 가능 (chartSubtitle은 "전체 기간"이지만 Timeline은 30분 데이터)**.
9. **typeTotal 한글 "건"**: "{total}건" 한국어 — 다국어 일관성.
10. **chart-collapsed 상태 시 헤더 동작**: 접힘 시 헤더만 보이고 charts-inner는 grid 0fr. 헤더 클릭으로 펼치기는 미구현 (토글 버튼만).
11. **ResizeObserver 폴백**: window resize 이벤트로 폴백.
12. **Donut size 90x90 고정**: 반응형 부재.
13. **Cache panel 빈 상태**: data 없으면 `--`/0% 유지 (renderCachePanel은 data null일 때 early return).

---

## R3 — R2 반영 + 추가

### 보강

- **Chart Section 접기 단위 단일**: chartSection 전체 한 덩어리. cachePanel만 별도 접기 미구현.
- **Timeline 데이터 출처**:
  - 누적: 클라이언트 `timelineBuckets` 배열 (in-memory, 새로고침 시 초기화)
  - 수신: SSE new_request → `recordRequest()` 카운트
  - 시간 동기화: 1분 단위 `advanceBuckets()` (자동 호출 + setInterval 60s)
- **Donut 데이터 출처**: `fetchDashboard` 응답 `d.types` (서버에서 type별 count 집계). 정렬: `b.count - a.count` 내림차순.
- **Type Legend 색상**: TYPE_COLORS 매핑(`prompt`=accent, `tool_call`=green, `system`=orange). `initTypeColors()`에서 CSS 변수 → 변수 부재 시 하드코딩 fallback.
- **Cache Hit Rate 색상**:
  - `is-high` (>=70%): green
  - `is-mid` (>=30%): orange
  - `is-low` (<30%): red
- **Cost saved 표시**: `$X.XX (rate%)` — 절감액 + 절감률 동시 표시.
- **chartSubtitle 텍스트 vs 데이터 불일치**:
  - 날짜 필터 클릭 시 chartSubtitle 변경 ("전체 기간"/"오늘"/"이번 주")
  - Timeline은 항상 30분 (in-memory)
  - **서버 fetchTimeline API 부재** — chartSubtitle은 도넛에만 의미. 디자인 측면 혼란.
- **typeTotal 텍스트**: `${total.toLocaleString('ko-KR')}건`. 단위 한국어.

### 추가 인터랙션

- **차트 토글 영속화**: localStorage `spyglass:chart-collapsed` JSON.
- **Donut hover**: 현재 미구현 (slice별 툴팁 없음).
- **Timeline hover**: 현재 미구현 (특정 분 카운트 툴팁 없음).
- **Cache Panel 3개 섹션별 hover 툴팁**: `cache-panel-tooltip.js`가 별도 모듈로 처리.

---

## R4 — 검토 (미세·키보드·에러·상태 전이)

1. **차트 토글 키보드 접근성**: `<button class="btn-toggle">` Tab/Enter 가능. aria-expanded 부재.
2. **Timeline 키보드 줌·이동 부재**: 인터랙션 없음.
3. **Donut 슬라이스 클릭 동작 없음**: 타입별 필터링 트리거 후보지만 미구현.
4. **Legend 항목 클릭 동작 없음**: 토글로 슬라이스 hide 하는 일반적 인터랙션 부재.
5. **Cache Panel 섹션 접기 부재**: 세 섹션 모두 항상 표시.
6. **Cache Hit Rate 0% 표시 처리**: `pct = 0` → bar-fill width:0%, "0%" 텍스트, `is-low` 클래스.
7. **fetchCacheStats 실패**: silent (renderCachePanel data null이면 early return). 사용자가 "—" 영구 노출.
8. **typeData 빈 배열 처리**: `<div class="legend-item">` 없이 "데이터 없음" 텍스트.
9. **Donut total 텍스트 폰트 크기 분기**: total>=1000이면 12px, 미만 15px. 1000 경계에서 시각 점프.
10. **Timeline 마지막 포인트 dot 색**: 항상 accent. 새 요청 도착 강조 애니메이션 부재.
11. **Donut color sync**: CSS 변수 변경 시 `initTypeColors()` 재호출 안 함 → 다이나믹 테마 변경 시 색 stale.
12. **chart-collapsed 시 ResizeObserver**: 접힘 시 `clientWidth=0` 가능 → drawTimeline early return (`if (w <= 0) return`).
13. **canvas 픽셀 처리 일관성**: timeline은 width=parent-32, donut은 90 고정, contextChart는 rect 기반. 일관 정책 부재.
14. **에러 fetchDashboard 시 typeData**: 마지막 성공값 유지 — stale 가능. 빈 데이터로 리셋 정책 없음.
15. **Cache Panel 인디케이터 stale 표시 부재**: 데이터 갱신 시각 표기 없음.

---

## R5 — R4 반영 + 최종 추가

### 추가된 미세·접근성·상태 전이

- **차트 토글 ARIA**: `aria-expanded` 미부여, `aria-controls` 미부여.
- **Donut slice/Legend 인터랙션 부재**: Phase 2 시 클릭 = 타입 필터 적용 후보.
- **Cache Panel 영속화 부재**: 접기 상태 저장 미구현.
- **chartSubtitle / Timeline 데이터 disconnect**:
  - "전체 기간" subtitle인데 차트는 30분 — 사용자에게 혼란
  - 디자인 재설계 시 subtitle을 "최근 30분 (실시간)" 고정으로 두거나, 차트 데이터를 날짜 범위 적용으로 변경 (백엔드 변경 필요 → feedback.md 후보)
- **TYPE_COLORS 동기화 시점**: init 한 번만. 다크/라이트 전환 시 미동기. 그러나 현재 다크 only.
- **Timeline 시각 단서 약함**:
  - 30분 동안 활동 분포가 균등하면 line이 평탄 — 패턴 인식 어려움
  - 색상 단일 (accent) → tool_call/prompt 별 분리 표시 안 함 (도넛에서만 분리)
- **Cache Panel 데이터 의미 명확화**:
  - "without cache" = 캐시 없을 때 가정 비용
  - "actual cost" = 실제 캐시 적용 비용
  - "saved" = 절감액 + 절감률
  - 사용자가 위 정의를 모르면 직관적이지 않음. 툴팁이 보충하지만 hover 의존.
- **Cache Ratio 라벨 의미 모호**:
  - "stable" (read >= 70%): 안정적인 캐시 활용
  - "building" (read < 70%): 캐시 형성 중
  - 영문 + 한국어 혼재
- **차트 hover/click 일관성**:
  - Cache Panel: hover 툴팁 ✅
  - Donut: hover/click 부재
  - Timeline: hover/click 부재
  - 컴포넌트 간 인터랙션 일관성 부족
- **canvas DPR 처리**:
  - Timeline: 명시적 dpr scale ✅
  - Donut: 명시적 dpr scale ✅
  - Context Chart: rect 기반 dpr scale ✅
  - 일관됨.

### 추가 인터랙션 후보 (현재 부재)

- Donut slice 클릭으로 타입 필터링
- Legend 항목 클릭으로 hide/show
- Timeline hover 툴팁 (분당 카운트)
- Timeline 시간 단위 변경 (30분/1시간/1일)
- Cache Panel 섹션 접기

---

## 최종 기능 개수 (W4)

- Chart Section 컨테이너: 4개 (헤더/subtitle/토글/접기 영속화)
- Timeline: 7개 (30분 버킷/SSE 카운트/자동 시프트/그라데이션/X축/Y축/마지막 dot)
- Donut: 5개 (슬라이스/색 동기화/total 텍스트/단위 분기/빈 상태)
- Type Legend: 4개 (반복 항목 4종 필드)
- Type Total: 1개
- Cache Panel Hit Rate: 4개 (라벨/바/색/텍스트)
- Cache Panel Cost: 3개 (without/actual/saved)
- Cache Panel Ratio: 4개 (라벨/더블바/라벨 텍스트/임계값)
- Cache Panel Tooltip: 3개 섹션 hover

총 **약 35개 기능**.

## 발견된 누락·모호 (Phase 2 입력)

1. chartSubtitle 텍스트 vs Timeline 데이터 disconnect (날짜 필터 의미 불일치)
2. Donut/Timeline 인터랙션 부재 (slice 클릭/hover 툴팁/legend 토글)
3. Cache Panel 섹션 접기 부재
4. ARIA(`aria-expanded`/`aria-controls`) 부족
5. Timeline 시간 단위 변경 미지원
6. Cache Panel 데이터 정의가 hover 툴팁에만 의존 — 시각적 보조 약함
7. Timeline 색상 단일 (타입별 분리 부재)
8. canvas hover 툴팁 일관성 (Cache만 있음)
9. typeTotal/Cache Ratio 한국어/영문 혼재
10. Chart Section 전체가 한 덩어리 — 부분 접기 부재
