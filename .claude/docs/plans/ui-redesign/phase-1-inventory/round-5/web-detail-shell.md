# web-detail-shell — Detail Header + Context Growth Chart + Tab Bar/Controls (W6 + W7 + W8)

> 세션 상세 뷰 진입 시 항상 보이는 셸. 헤더/메타/접기/닫기, Context Growth 차트, 4개 탭 + 검색·필터 컨트롤 바.
> 5라운드 누적 인벤토리.

---

## R1 — 1차 작성

### W6 Detail Header (`#detailView .detail-header`)

#### Meta (`.detail-meta`, flex 단일행, no wrap)
- `.detail-session-id` (`#detailSessionId`) — 세션 ID 8자 + `…`, accent color, flex-shrink:0, title 속성으로 전체 ID
- `.detail-project` (`#detailProject`) — 프로젝트명, text-muted, flex-shrink:1 (공간 부족 시 ellipsis)
- `.detail-tokens` (`#detailTokens`) — `총 X토큰`, accent, flex-shrink:0
- `.detail-ended-at` (`#detailEndedAt`) — `종료: ${fmtDate}`, text-muted, flex-shrink:0 (값 없으면 빈 문자열)
- `.detail-agg-badges` (`#detailBadges`) — flex-shrink:0, 숨김 시 `.detail-agg-badges--hidden`
  - `최고 비용 Turn: T${idx} (token)`
  - `최다 호출 Tool: ${name} (count회)`
  - 각 배지 title 속성 부연 설명

#### Actions (`.detail-actions`, 우상단)
- `#btnToggleDetail.btn-toggle` — chevron-down SVG 28x28, hover accent + bg, 접힌 상태 180도 회전, aria-label "접기"/"펼치기"
- `.detail-actions-sep` — 1x14px, border, 시각 분리
- `#btnCloseDetail.btn-close` — ✕ SVG 28x28, hover red + red-dim bg, `closeDetail()` 호출

#### Header 클릭 펼치기
- 접힌 상태에서 헤더 (`.detail-actions` 제외) 클릭 → `toggleDetailCollapse()` 호출
- 접힌 상태 클래스: `.detail-collapsed` on `#detailView`

### W7 Context Growth Chart (`.context-chart-section`)

- 래퍼 구조: `.context-chart-section > .context-chart-inner > {header, canvas, empty, footer}`
- 헤더 (`.context-chart-header`):
  - 라벨 "Accumulated Tokens"
  - `#ctxUsageIndicator` — `누적 X.XK tokens`
- 캔버스 `#contextGrowthChart`
- 빈 상태 `#contextChartEmpty.context-chart-empty` — "누적 토큰 데이터 없음"
- 푸터 `.context-chart-footer` — `Turn N · 최대 X.XK tokens · 참고 스케일: 200K (모델별 상이)`
- data-ctx-tooltip="context-growth" — hover 툴팁 트리거

#### 접기/펼치기 애니메이션 (W6과 연계)
- `.context-chart-section--collapsed` → grid-template-rows: 0fr (0.3s ease-in-out)
- 접힘 트리거: `.detail-collapsed` 적용 시 chartSection도 `.context-chart-section--collapsed` 동시 토글
- 즉, 토글 버튼은 W7만 접고 W6/W8은 항상 표시 (ADR-002)

#### 차트 렌더 (`renderContextChart(turns)`)
- 유효 데이터 판별: `t.prompt && (context_tokens>0 || tokens_input>0)`
- 정렬: `turn_index` 오름차순
- 값: `context_tokens || tokens_input || 0`
- maxVal: max + REFERENCE_SCALE_TOKENS*0.1 (최소 스케일)
- 격자선 4분할, area fill, line stroke, 데이터 포인트 dot
- DPR 처리

### W8 Tab Bar & Controls

#### View Tab Bar (`.view-tab-bar #detailTabBar`)
- 4개 버튼:
  - `#tabFlat` data-tab="flat" "플랫" (기본 active)
  - `#tabTurn` data-tab="turn" "턴 뷰"
  - `#tabGantt` data-tab="gantt" "간트"
  - `#tabTools` data-tab="tools" "도구"
- 클릭 시 `setDetailView(tab)` — display 토글 + active 클래스

#### Detail Controls Bar (`.detail-controls-bar`)
- `bg: var(--surface-alt)`, `border-bottom: 1px solid var(--border)`, `justify-content: flex-end`
- 내부 `.feed-controls`:
  - 검색창 (`#detailSearchInput` placeholder "tool / message", `#detailSearchClear`)
  - 타입 필터 7개 (`#detailTypeFilterBtns.detail-type-filter-btns`):
    - All/prompt/Agent/Skill/MCP/tool_call/system (data-detail-filter)
    - `border-left: 1px solid var(--border)`, `padding-left: 12px` (검색과 시각 분리)

#### 카운트 동적 라벨
- `applyDetailFilter()` 시 각 필터 버튼 텍스트가 `Label (count)`로 갱신:
  - All (전체)
  - prompt (count)
  - tool_call (count)
  - system (count)
  - Agent (count)
  - Skill (count)
  - MCP (count)

### Detail Loading
- `#detailLoading.detail-loading` — "로딩 중…" 텍스트, fetchSessionDetail 동안 표시

---

## R2 — 검토

1. **Detail Header `flex-wrap` 정책**: 1줄 고정, ellipsis는 project만 (flex-shrink:1). detail-tokens/ended-at/badges는 항상 표시. 좁은 폭에서 헤더가 잘리거나 actions와 충돌 가능.
2. **detail-agg-badges 숨김 조건**: `sessionTotalTokens > 0`이고 `bTurns.length > 0`이면 표시. 그 외 hidden 클래스 적용.
3. **detail-agg-badges 데이터 출처**: turn 데이터 기반 (renderTurnView/renderTurnCards 양쪽에서 갱신 — 중복 코드).
4. **closeDetail() 함수 정의 위치 누락**: index.html의 `#btnCloseDetail`은 onclick 인라인 없음. main.js에서 이벤트 위임 필요. **그러나 main.js에 closeDetail 호출/리스너가 보이지 않음** — 잠재 누락.
5. **Context Chart 빈 상태 레이어**: canvas는 `.context-chart-hidden` 추가, empty 상태는 `.context-chart-empty--visible` 추가 — 두 클래스 토글 방식.
6. **Context Chart 푸터 텍스트 정밀도**: `Turn ${last.turn_index} · 최대 ${fmtK(maxVal)} · 참고 스케일: 200K (모델별 상이)`. 모델별 한도 명시는 없음.
7. **Tab Bar 4탭 vs 5탭**: 현재 4개 (flat/turn/gantt/tools). screen-inventory.md(327라인)는 4탭 표기 일치.
8. **Detail Controls Bar 위치**: 탭바 아래 같은 영역, 시각적으로 한 묶음.
9. **카운트 라벨 텍스트 변경 방식**: 내부 텍스트 직접 교체. 한국어/영문 혼재 (All/prompt/tool_call/system/Agent/Skill/MCP).
10. **검색 input width**: feed-search CSS 의존.
11. **detailSearch와 typeFilter 조합**: 둘 다 적용 (AND).
12. **Loading 중 다른 뷰**: detailFlatView/detailTurnView display:none, detailLoading만 표시. 응답 후 detailLoading hide + setDetailView(uiState.detailTab).
13. **헤더 actions 클릭 시 헤더 클릭 분기 race**: 헤더 클릭 핸들러는 `e.target.closest('#btnToggleDetail')` 가드만. close 버튼/구분선 클릭 시 분기 누락 — closeDetail 핸들러 부재로 close 버튼이 동작하지 않을 수 있음.

---

## R3 — R2 반영 + 추가

### 보강

- **closeDetail 함수**: main.js에 정의되지 않음 (확인 결과). screen-inventory.md(228라인)는 "closeDetail() 호출"이라 표기하지만 실제 코드에는 미정의 — **잠재 죽은 코드/누락**. 닫기 버튼은 화면에 있지만 동작하지 않을 수 있음. **feedback.md에 기록 필요**.
- **detail-agg-badges 갱신 중복**: `renderTurnView()` (레거시)와 `renderTurnCards()` (현행) 양쪽에서 갱신. renderTurnView는 `turnListBody`가 없으면 early return — 사실상 renderTurnCards만 갱신.
- **Context Chart 클리어**: 세션 전환 시 `clearContextChart()` 호출 → 빈 상태 강제.
- **Tab Bar `setDetailView`**:
  - detailFlatView/detailTurnView/detailGanttView/detailToolsView display 토글
  - active 클래스 토글
  - tab='gantt' 시 `renderGantt()` 호출
  - tab='tools' 시 `loadToolStats(_currentSessionId)` 호출
- **Detail Controls Bar 적용 범위**: 4개 탭 모두 동일 컨트롤 사용. 그러나 검색/필터가 모든 탭에 똑같이 작동하지 않음:
  - flat 뷰: 검색 + 필터 모두 작동
  - turn 뷰: 필터 카운트만 갱신, 카드 자체 필터링은 turnFiltered로
  - gantt 뷰: 필터 작동 (renderGantt 호출 시 적용)
  - tools 뷰: 필터/검색 미반영 (loadToolStats는 sessionId만 사용)
- **카운트 라벨 갱신 시점**: `applyDetailFilter()` 호출 시. 클릭 시점이 아니라 데이터 변경 시.
- **Detail Loading 표시 시점**: selectSession 함수에서 직접 `display='block'` 처리. loadSessionDetail 시작 시 이미 표시되어 있음. 응답 후 hide.

### 추가 인터랙션

- **세션 ID 클릭 동작**: 현재 부재 (단순 텍스트). title 속성으로 전체 ID 노출.
- **프로젝트명 클릭 동작**: 현재 부재. 사이드 패널 프로젝트 점프 후보.
- **detail-agg-badges 클릭 동작**: 부재. T번호 클릭 → 해당 턴 점프 후보.

---

## R4 — 검토 (미세·키보드·에러·상태 전이)

1. **Detail Header 키보드**:
   - 토글 버튼 `<button>` Tab/Enter ✅
   - 닫기 버튼 `<button>` Tab/Enter ✅ (단 핸들러 부재)
   - 헤더 자체는 클릭 가능하지만 tabindex 없음
2. **`aria-expanded` 부재**: 토글 버튼이 접힘/펼침 상태를 ARIA로 표현 안 함.
3. **ARIA `role="tablist"`/`role="tab"`/`role="tabpanel"` 부재**: 탭바와 콘텐츠가 시맨틱 연결 안 됨.
4. **Tab 키보드 화살표 ↑↓/←→ 부재**: 탭 간 이동 키보드 미지원.
5. **세션 ID/프로젝트명 클릭 동작 없음**: 사용자가 현재 어디 있는지 알 수만 있고 점프 불가.
6. **detail-agg-badges 클릭 동작 없음**: T번호 정보만 제공.
7. **Loading 텍스트만 표시**: 스피너/skeleton 없음 — 시각 단서 약함.
8. **closeDetail 핸들러 누락 (R3에서 발견)**: feedback.md 후보.
9. **toggleDetailCollapse 시 애니메이션**:
   - `.detail-collapsed` 클래스 → `.context-chart-section--collapsed` 동시 토글 (chartSection grid-template-rows 0fr)
   - 0.3s ease-in-out
   - 토글 SVG 회전 — CSS transform이 일관 적용되는지 확인 필요
10. **Detail Search ESC 클리어 부재**: detail-search-input에 ESC 핸들러 없음.
11. **Detail Search 검색 대상**: action-name/prompt-preview/target-role-badge 텍스트 (#detailRequestsBody 한정).
   - turn 뷰/gantt 뷰/tools 뷰는 검색어 미적용.
12. **Tab 전환 시 스크롤 위치 보존**: 각 detail-content는 별도 스크롤. 탭 전환 시 스크롤 위치 유지 안 됨 (display 토글로 hide된 영역의 scrollTop은 유지).
13. **빈 데이터 상태**: 각 뷰별 다른 빈 메시지 — flat "데이터 없음", turn "턴 데이터 없음", gantt "로딩 중…" (영구 표시될 위험), tools "tool_call 데이터 없음".
14. **Detail Header 우측 actions 영역과 좌측 meta의 충돌**: 좁은 폭에서 actions 영역이 meta와 겹칠 가능성. flex-shrink 정책으로 detail-project만 축소 — 다른 요소 너무 길면 actions 가려짐.
15. **Context Chart 푸터 정보**: 사용자가 200K 참고 스케일을 보고 본인 모델 한도와 비교해야 함 — 모델별 한도 명시 부재.
16. **Tab 전환 후 검색어 유지**: detailSearchInput의 값이 탭 전환에도 유지됨. 그러나 turn/gantt/tools 뷰는 검색 미적용 → 사용자에게 혼란.

---

## R5 — R4 반영 + 최종 추가

### 추가된 미세·접근성·상태 전이

- **closeDetail 핸들러 누락 잠재 버그**:
  - 닫기 버튼 클릭 시 동작 안 함
  - 사용자가 detail 뷰에서 default 뷰로 돌아가는 유일한 경로는 좌측 패널에서 다른 세션 선택
  - **feedback.md에 기록**: 백엔드 변경 아닌 UI 버그지만, Phase 2 디자인 시 사용자 흐름 영향 큼
- **Tab/Tabpanel ARIA 전면 부재**
- **Tab 키보드 ←→ 이동 부재**
- **세션 ID/프로젝트명/agg-badge 클릭 부재**
- **Detail Search ESC 클리어 부재**
- **Tab 전환 시 검색/필터 적용 범위 비일관**:
  - flat: 검색 + 필터 ✅
  - turn: 필터만 ✅, 검색 ❌
  - gantt: 필터만 ✅, 검색 ❌
  - tools: 검색/필터 모두 ❌
- **Loading skeleton 부재**: "로딩 중…" 단순 텍스트
- **Detail Header 좁은 폭 처리**: flex-wrap 없음 → actions 가려질 수 있음
- **Tab 전환 시 스크롤 위치 미보존 (display 토글이 보존하긴 함, 다만 탭 데이터 변경 시 흐름)**
- **빈 데이터 상태 텍스트 비일관 (flat/turn/gantt/tools 다름)**
- **gantt "로딩 중…" 텍스트가 hint에 있지만 실제 빈 상태 처리 부재 — 빈 세션에서 로딩 텍스트 영구 노출 가능**
- **Context Chart 모델 한도 명시 부재**: 200K 참고 스케일이지만 사용자 모델별 한도 비교 어려움
- **Context Chart Indicator 색상 동적 조정 부재**: usage가 위험 수준에 도달해도 색 변경 없음
- **detail-actions 구분선 시각**: `var(--border)` 1px x 14px — 미세하나 시각 분리 효과
- **btnCloseDetail hover red**: 닫기 버튼 hover 시 빨간색 — 위험 액션 색 코딩 유지

### 키보드 단축키 (현재 부재)

| 의도 | 현재 |
|------|------|
| Tab ←→ 전환 | 없음 |
| ESC로 detail 닫기 | 없음 |
| ESC로 검색 클리어 | 없음 |
| 단축키로 탭 전환 (1~4) | 없음 |
| Cmd/Ctrl+F 검색 포커스 | 없음 |

---

## 최종 기능 개수 (W6 + W7 + W8)

### W6 Detail Header
- meta 5개 (sess-id/project/tokens/ended-at/agg-badges)
- agg-badges 2종 (최고 비용 Turn / 최다 호출 Tool)
- actions 3개 (toggle/sep/close)
- 헤더 클릭 펼치기 1개

### W7 Context Chart
- 헤더 (라벨 + indicator) 2개
- canvas 1개
- 빈 상태 1개
- 푸터 1개
- 접기 애니메이션 1개
- 렌더 alg 1개 (격자/area/line/dot 4부분)
- 클리어 1개
- hover 툴팁 1개

### W8 Tab Bar & Controls
- 4개 탭 4개
- 검색 (input/icon/clear) 3개
- 7개 타입 필터 7개
- 카운트 라벨 동적 갱신 1개
- 시각 분리 (탭바/컨트롤바 2개)
- Loading 표시 1개

총 **약 35개 기능**.

## 발견된 누락·모호 (Phase 2 입력)

1. `closeDetail()` 핸들러 누락 — 닫기 버튼이 동작하지 않을 가능성 (feedback.md 후보)
2. ARIA `role="tablist"`/`tab`/`tabpanel`/`aria-expanded` 전면 부재
3. Tab 키보드 ←→ 이동 부재
4. 검색/필터가 탭별로 적용 범위 비일관 (flat만 검색, 다른 탭은 필터만 또는 둘 다 ❌)
5. 세션 ID/프로젝트명/agg-badge 클릭 동작 없음 (점프 후보)
6. Loading 시 skeleton 부재
7. 좁은 폭에서 Detail Header actions 가려질 가능성
8. Context Chart 모델별 한도 명시 부재 (참고 스케일 200K 고정)
9. Context Chart Indicator 색상 동적 조정 부재 (warning/critical 미시각화)
10. 빈 데이터 텍스트 탭별 비일관 ("데이터 없음"/"턴 데이터 없음"/"tool_call 데이터 없음"/"로딩 중…" 영구 노출 위험)
11. ESC 핸들러 부재 (검색/detail 전체)
12. 탭 단축키 (1~4) 부재
