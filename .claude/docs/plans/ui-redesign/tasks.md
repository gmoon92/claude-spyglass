# ui-redesign Tasks

> Feature: ui-redesign — Phase 2 디자인 재설계 구현
> 시작일: 2026-04-23
> 상태: 진행 중

각 task는 **원자적 단위** (단일 PR로 안전하게 합칠 수 있는 크기). ADR 매핑·영향 파일·재사용할 기존 함수·검증 방법을 명시.

## Phase 2A — 디자인 토큰 기반 (ADR-001/002/004)

- [x] **T1. design-tokens.css 확장 — Hierarchy / Spacing / Typography 토큰 추가** (ADR-001/002/004)
  - 파일: `packages/web/assets/css/design-tokens.css`
  - 추가: `--space-1~6`, `--font-hero/major/body/meta/micro`, `--weight-hero/strong/normal`, `--radius-lg`
  - 검증: 기존 색상 토큰 보존 + 신규 토큰 추가 (페이지 미회귀)

- [x] **T2. card.css 신규 — Card Container System** (ADR-003)
  - 파일 신규: `packages/web/assets/css/card.css`
  - 클래스: `.card`, `.card-header`, `.card-body`, `.card-title`, `.card-actions`
  - index.html에 link 추가
  - 검증: 빈 페이지 영향 없음 (적용은 후속 task)

- [x] **T3. state.css 신규 — Empty/Loading/Error SSoT** (ADR-009)
  - 파일 신규: `packages/web/assets/css/state.css`
  - 클래스: `.state-empty`, `.state-loading`, `.state-error`, `.state-error-retry`
  - index.html에 link 추가

## Phase 2B — Summary Strip 재구성 (ADR-005)

- [x] **T4. Summary Strip 3섹션 마크업 변경**
  - 파일: `packages/web/index.html`
  - 변경: `.summary-strip > .stat-group` 3그룹 (`hero` / `performance` / `volume-cost`)
  - 카드 순서: 활성 + 오류율(Hero) → 평균응답 + P95 → 세션·요청·토큰·비용·절감
  - 검증: 카드 ID는 모두 보존 (기존 fetchDashboard 로직 무회귀)

- [x] **T5. summary-strip.css 위계 적용**
  - 파일: `packages/web/assets/css/summary-strip.css`
  - Hero stat-card 24px primary, Performance/Volume secondary
  - 검증: 기존 `is-active-indicator`/`is-error`/`is-critical` 클래스 동작 유지

## Phase 2C — Card Container 적용

- [x] **T6. Chart Strip을 .card로 전환** (ADR-003)
  - 파일: `packages/web/index.html` + `packages/web/assets/css/default-view.css`
  - `#chartSection.view-section` → `.card.view-section` (또는 추가 class)
  - 검증: chart-collapsed 토글 정상 동작

- [x] **T7. Default View 피드를 .card로 전환** (ADR-003)
  - 파일: `packages/web/index.html` + `packages/web/assets/css/default-view.css`
  - `#defaultView .view-section.fill` → `.card`
  - 검증: scroll-lock 배너, 더 보기 버튼 정상 동작

- [x] **T8. Detail View Header + Context Chart + Tab Bar를 .card로** (ADR-003)
  - 파일: `packages/web/index.html` + `packages/web/assets/css/detail-view.css`
  - `#detailView` 자체 또는 내부 영역들을 카드 그룹으로
  - 검증: detail-collapsed 토글 / Context Chart 접기 / 탭 전환 모두 동작

## Phase 2D — Type Filter Grouping (ADR-006)

- [x] **T9. Type Filter 7버튼 2그룹 마크업 + CSS**
  - 파일: `packages/web/index.html` (W5/W8 두 곳), `packages/web/assets/css/default-view.css`
  - `#typeFilterBtns`/`#detailTypeFilterBtns` 안에 `.filter-group` 2개
  - 그룹 1: All / prompt / system
  - 그룹 2: tool_call / Agent / Skill / MCP
  - 그룹 사이 border-left 시각 분리
  - 검증: 기존 click 핸들러 (data-filter, data-detail-filter) 모두 동작

## Phase 2E — Tools Matrix View (ADR-007)

- [x] **T10. tool-stats.js 매트릭스 렌더로 재작성**
  - 파일: `packages/web/assets/js/tool-stats.js`, `packages/web/assets/css/tool-stats.css`
  - 3섹션 → 1행 1도구, 6컬럼 (Tool/Avg/Calls/Tokens/%/Err)
  - 정렬 토글 버튼 3종 (`avg/calls/tokens`)
  - `toolIconHtml(tool_name)` SSoT 재사용 (renderers.js에서 import)
  - escHtml 자체 정의 제거 → formatters.escHtml 사용
  - 검증: clearToolStats / loadToolStats 호출 흐름 유지

## Phase 2F — Turn Card Hierarchy 강화 (ADR-008)

- [x] **T11. turn-view.css — 그룹 행 background/border 강화**
  - 파일: `packages/web/assets/css/turn-view.css`
  - `.turn-row-group` background `var(--surface-alt)` + accent border
  - `.turn-row-group-children` 옅은 강조 background

- [x] **T12. session-detail.js — chip-arrow SVG 교체**
  - 파일: `packages/web/assets/js/session-detail.js` (renderTurnCards 내부)
  - `<span class="chip-arrow">-&gt;</span>` → SVG path
  - 검증: chip flow 시각 흐름 명확

- [x] **T13. turn-view.css — complexity 배지 색 토큰화**
  - 파일: `packages/web/assets/css/turn-view.css`
  - `.turn-complexity.high/.mid` → red-bg-light/yellow-bg-light 토큰

- [x] **T14. turn-view.css — 카드 footer 위계 강화**
  - 파일: `packages/web/assets/css/turn-view.css`
  - 토큰 % (Hero 18px accent) + IN/OUT (meta 11px text-dim) + ⏱ (body 13px)

## Phase 2G — State SSoT 적용 (ADR-009)

- [x] **T15. 빈 상태 메시지 통일**
  - 파일: `renderers.js`, `session-detail.js`, `tool-stats.js`, `left-panel.js`
  - "데이터 없음" / "요청 데이터 없음" / "턴 데이터 없음" / "tool_call 데이터 없음" → `데이터가 없습니다`
  - state.css 클래스 적용

- [x] **T16. 로딩 상태 통일**
  - 파일: `session-detail.js`, `tool-stats.js`
  - "로딩 중…" 텍스트 → state-loading skeleton

## Phase 2H — Diagnostic Bug Fixes (ADR-010)

- [x] **T17. closeDetail 핸들러 등록 (W6 A-1)**
  - 파일: `packages/web/assets/js/main.js`
  - `closeDetail()` 함수 정의: setSelectedSession(null) + uiState.rightView='default' + renderRightPanel()
  - `#btnCloseDetail` click 리스너 등록 (initEventDelegation 안)
  - **index.html에 #btnCloseDetail 마크업 추가 필요** (현재 없음 — screen-inventory만 표기)
  - 검증: detail 뷰 진입 후 닫기 버튼 클릭 시 default 뷰 복귀

- [x] **T18. TUI maxTokens 200K (T2 C-1)**
  - 파일: `packages/tui/src/components/LiveTab.tsx`
  - `MAX_TOKENS = 200_000` 상수 추출
  - 검증: 진행률 계산 변경

- [x] **T19. TUI AlertBanner 노출 (T1 A-2)**
  - 파일: `packages/tui/src/app.tsx`
  - useAlerts hook 호출 + Header 위 또는 TabBar 아래 `<AlertBanner />` 배치
  - normal level 시 conditional rendering
  - 검증: 알림 발생 시 화면에 노출

## Phase 2I — Anomaly 일관화 (ADR-011)

- [x] **T20. anomaly.js 헬퍼 함수 추가**
  - 파일: `packages/web/assets/js/anomaly.js`
  - `applyAnomalyBadgesToRow(rowEl, flags)` 추가
  - 모든 뷰에서 재사용

- [x] **T21. W9 Detail Flat View에 anomaly 적용**
  - 파일: `packages/web/assets/js/session-detail.js` (renderDetailRequests)
  - anomalyMap 인자 받아 makeRequestRow에 전달
  - 검증: spike/loop/slow 배지가 detail flat에서도 표시

- [x] **T22. SSE prependRequest 시 anomaly 즉시 반영**
  - 파일: `packages/web/assets/js/main.js`
  - prependRequest 후 detectAnomalies 재호출 + 배지 적용
  - 검증: SSE 새 요청에 즉시 spike/loop/slow 배지

## Phase 2J — Keyboard Shortcuts (ADR-012, 1차)

- [x] **T23. ESC 핸들러 우선순위 처리**
  - 파일: `packages/web/assets/js/main.js`
  - 우선순위: 모달 → 확장 패널 → 검색 클리어 → detail 닫기

- [x] **T24. / 키 검색 포커스**
  - 파일: `packages/web/assets/js/main.js`
  - 현재 active 뷰의 검색 input에 focus

- [x] **T25. ? 키 도움말 모달**
  - 파일: `packages/web/index.html` + `packages/web/assets/css/keyboard-help.css` + main.js
  - 모달 dialog 신규 (단축키 목록)

- [x] **T26. 1~7 타입 필터 단축키**
  - 파일: `packages/web/assets/js/main.js`
  - 현재 active 뷰의 typeFilterBtns 순서 클릭 트리거

- [x] **T27. Cmd/Ctrl+F 검색 포커스 가로채기**
  - 파일: `packages/web/assets/js/main.js`
  - keydown 가로채서 / 키와 동일 동작

## Phase 2K — TUI Information Architecture (ADR-013)

- [x] **T28. TUI Sidebar selectedId 전달**
  - 파일: `packages/tui/src/app.tsx`
  - selectedSessionId state 추가, Sidebar에 prop 전달
  - HistoryTab onSessionSelect callback 연동

- [x] **T29. TUI 빈 상태 한국어 통일**
  - 파일: `packages/tui/src/components/{LiveTab,HistoryTab,AnalysisTab,SettingsTab}.tsx`
  - "No sessions found." → "데이터가 없습니다" 등
  - "Loading..." 유지 (영문이 무방하다고 판단)

- [x] **T30. TUI Top Requests Enter 점프**
  - 파일: `packages/tui/src/components/AnalysisTab.tsx` + `app.tsx`
  - Top Requests 섹션에서 Enter 시 onSessionSelect callback 호출
  - app.tsx에서 setActiveTab('history') + 세션 선택

## Phase 2L — Persistence Prefix 통일 (ADR-014)

- [x] **T31. localStorage prefix 마이그레이션**
  - 파일: `packages/web/assets/js/main.js`
  - `migrateKey()` 헬퍼 추가 + init 시 호출
  - `left-panel-hidden` → `spyglass:left-panel-hidden`
  - `left-panel-state` → `spyglass:left-panel-state`

## Phase 2M — 문서 갱신

- [x] **T32. screen-inventory.md 갱신**
  - 파일: `.claude/skills/ui-designer/references/web/screen-inventory.md`
  - 14개 ADR 변경 사항 반영
  - 변경 이력 row 추가

- [x] **T33. design-system.md 갱신**
  - 파일: `.claude/skills/ui-designer/references/web/design-system.md`
  - Spacing / Typography / Card / State 토큰 추가

## 완료 기준

- [ ] 모든 task 체크 (33개)
- [ ] 기존 472개 인벤토리 항목 무회귀
- [ ] 디자이너 피드백 4종 직접 답하는 시각 변화 확인
- [ ] screen-inventory.md / design-system.md 현행화
- [ ] dev server 실행 가능 (사용자 테스트 위임)

---

## Phase 3 — 신규 백엔드 API 8종 활용 + 가격 정책 + chartSection 통합 + 로고

### Phase 3A — 가격 정책 옵션 2 (ADR-015)

- [x] **T34. Cache Panel 토큰 단위 전환**
  - 파일: `packages/web/assets/js/cache-panel.js`, `packages/web/index.html`
  - "$X.XX" → 토큰 라벨/값으로 변경 ("no cache" / "actual" / "saved")

- [x] **T35. Summary Strip 비용/절감 카드 제거**
  - 파일: `packages/web/index.html`
  - `#stat-cost` `#stat-cache-savings` 카드 마크업 제거
  - "Volume·Cost" → "Volume" 그룹 라벨 변경

- [x] **T36. api.js fetchDashboard에서 USD 처리 제거**
  - 파일: `packages/web/assets/js/api.js`
  - `costUsd / cacheSavingsUsd` stat 카드 갱신 코드 제거

- [x] **T37. 툴팁에서 $ 언급 제거**
  - 파일: `packages/web/assets/js/stat-tooltip.js`, `packages/web/assets/js/cache-panel-tooltip.js`
  - 툴팁 텍스트 토큰 기반으로 수정

### Phase 3B — chartSection 모드 전환 + detail-header 통합 (ADR-017)

- [x] **T38. metrics-api.js 신규 — fetch 래퍼**
  - 파일: `packages/web/assets/js/metrics-api.js` (신규)
  - 8종 endpoint 호출 함수 + 공통 query string 헬퍼

- [x] **T39. chartSection 헤더에 detail meta 영역 추가**
  - 파일: `packages/web/index.html`
  - chartSection의 `.view-section-header`에 `<div class="chart-detail-meta" hidden>` 추가
  - 내용: detailSessionId, detailProject, detailTokens, detailEndedAt, detailBadges, detail-actions(toggle/close)

- [x] **T40. contextGrowthChart canvas를 chartSection charts-inner로 이동**
  - 파일: `packages/web/index.html`
  - 기존 `.context-chart-section` 제거, canvas를 chart-wrap 형태로 이동
  - timelineChart canvas와 sibling, display 토글

- [x] **T41. main.js — chartSection 모드 전환 로직**
  - 파일: `packages/web/assets/js/main.js`
  - `setChartMode('default' | 'detail', session)` 함수 신규
  - selectSession / closeDetail에서 호출
  - timelineChart / contextGrowthChart display 토글 + 헤더 swap

- [x] **T42. session-detail.js — donut/cache panel 세션 데이터 갱신**
  - 파일: `packages/web/assets/js/session-detail.js`, `chart.js`, `cache-panel.js`
  - applyDetailFilter() 안에서 _detailAllRequests로 세션 type/cache stats 계산
  - drawDonut / renderTypeLegend / renderCachePanel 세션 데이터로 호출

- [x] **T43. detail-view.css 정리**
  - 파일: `packages/web/assets/css/detail-view.css`, `context-chart.css`
  - `.detail-header` 스타일 제거 또는 chartSection 헤더 스타일로 이전
  - `.context-chart-section` 정리 (이제 chart-inner 슬롯)

### Phase 3C — 시각 지표 8종 활용 (ADR-016)

- [x] **T44. donut 모드 토글 (전역 type / 모델 사용량)**
  - 파일: `packages/web/index.html`, `chart.js`, `default-view.css`
  - 도넛 옆 segment 토글 (Type / Model)
  - drawDonut + renderTypeLegend가 모델 데이터 처리 가능하도록 일반화

- [x] **T45. cache-panel 모드 토글 (전체 / 모델별 매트릭스)**
  - 파일: `packages/web/index.html`, `cache-panel.js`, `cache-panel.css`
  - panel 우상단 mini 토글
  - 모델별 모드 시 cache-matrix 응답 기반 행 렌더 (stacked bar + hit_rate)

- [x] **T46. left-panel #panelTools 도구/카테고리 토글**
  - 파일: `packages/web/index.html`, `left-panel.js`
  - 헤더 "도구별 / 카테고리별" 토글 추가
  - 카테고리 모드 시 6 카테고리 가로 막대

- [x] **T47. insights.css 신규 — Insights 카드 + insight-tile**
  - 파일: `packages/web/assets/css/insights.css` (신규)
  - 카드 그리드 + tile 클래스

- [x] **T48. insights.js 신규 — 5종 sub-tile 렌더링**
  - 파일: `packages/web/assets/js/insights.js` (신규)
  - context-usage / activity-heatmap / turn-distribution / agent-depth / anomalies-timeseries fetch + 렌더

- [x] **T49. index.html에 Insights 카드 마크업 + main.js init**
  - 파일: `packages/web/index.html`, `packages/web/assets/js/main.js`
  - `#insightsCard` (chartSection 아래, content-switcher 위)
  - 헤더: 라벨 "Insights" + range 토글 + 접기 토글
  - main.js init에서 initInsights() + 모드별 hide 처리

### Phase 3D — 로고 홈 복귀 (ADR-018)

- [x] **T50. 로고 클릭 핸들러 + 키보드 접근성**
  - 파일: `packages/web/index.html`, `packages/web/assets/js/main.js`, `packages/web/assets/css/header.css`
  - role="button" tabindex="0" + cursor:pointer
  - 클릭/Enter/Space 시 closeDetail + setSelectedProject(null) + setSelectedSession(null) + autoActivateProject + scroll top

### Phase 3E — 문서 갱신

- [x] **T51. screen-inventory.md 갱신**
- [x] **T52. design-system.md 갱신**

---

## 재사용 함수 매핑 (CLAUDE.md 명시 함수 + 인벤토리에서 발견된 SSoT)

| 함수 | 위치 | 재사용처 |
|------|------|---------|
| `toolIconHtml(toolName, eventType)` | `renderers.js` | T10 (tool-stats matrix), T12 |
| `makeTargetCell(r)` | `renderers.js` | (변경 없음) |
| `makeRequestRow(r, opts)` | `renderers.js` | T21 (anomalyMap 추가 인자) |
| `prependRequest(r)` | `main.js` | T22 (anomaly 즉시 적용) |
| `targetInnerHtml(r)` | `renderers.js` | (변경 없음) |
| `compressContinuousTools(toolCalls)` | `session-detail.js` | (변경 없음) |
| `buildTurnDetailRows(turn)` | `session-detail.js` | T11~T14 |
| `detectAnomalies(requests, p95)` | `anomaly.js` | T20 (헬퍼 분리) |
| `escHtml(s)` | `formatters.js` | T10 (자체 정의 제거) |
| `fmtToken/fmtDate/fmtTime/fmtTimestamp/formatDuration/fmtRelative` | `formatters.js` | (재사용) |
| `_promptCache` (Map LRU 500) | `renderers.js` | (변경 없음) |
| `togglePromptExpand(rid, container, cols)` | `renderers.js` | T23 (ESC 우선순위 통합) |
