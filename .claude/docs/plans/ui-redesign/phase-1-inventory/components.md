# Step 1.1 — 큰 덩어리 컴포넌트 분류

> Phase 1 인벤토리의 출발점. 화면 전체를 디자이너가 "한 덩어리"로 다룰 수 있는 굵직한 단위로 분류한다.
> 작성일: 2026-04-23

## 분류 원칙

- **시각적 경계**가 명확한 영역
- **시선 흐름·역할**이 한 덩어리로 묶이는 영역
- **상태 전이**가 한 덩어리 안에서 닫히는 영역
- 너무 세분화하지 않는다. CSS 파일/JS 모듈 단위로 쪼개지 않고, **화면에서 보이는 묶음** 단위로 묶는다.
- 보이지 않지만 모든 화면에 영향을 주는 **cross-cutting 레이어**는 별도 분류.

---

## Web 대시보드 (12개 화면 컴포넌트 + 1개 cross-cutting)

| 코드 | 컴포넌트 | DOM/파일 진입점 | 한 줄 설명 |
|------|---------|---------------|------|
| **W1** | Global Shell | `<header.header>`, `<div.error-banner>`, `<footer.footer>` / `header.css` | 항상 보이는 외곽 프레임 — 로고·LIVE 배지·날짜 필터·갱신 시각·에러 배너·푸터 |
| **W2** | Summary Strip (Command Center) | `<div.summary-strip>` / `summary-strip.css`, `api.fetchDashboard` | 상단 9개 stat-card + 구분선 — 활성/평균/P95/오류/세션/요청/토큰/비용/절감 |
| **W3** | Left Panel | `<aside.left-panel>` / `left-panel.css`, `left-panel.js`, `panel-resize.js` | 프로젝트·세션·툴 통계 3섹션 + 토글 + 너비 리사이즈 + 섹션별 접기 |
| **W4** | Chart Strip | `#chartSection` / `default-view.css`, `chart.js`, `cache-panel.js` | 타임라인 + 도넛 + Cache Intelligence Panel — Right Panel 상단 차트 띠 |
| **W5** | Default View (Recent Feed) | `#defaultView` / `default-view.css`, `table.css`, `renderers.js`, `api.fetchRequests`, `infra.js` | 최근 요청 테이블 + 검색 + 7개 타입 필터 + scroll-lock + 더 보기 |
| **W6** | Detail Header & Meta | `.detail-header` / `detail-view.css` | 세션 ID·프로젝트·총 토큰·종료시각·집계 배지 + 접기/닫기 토글 |
| **W7** | Detail Context Growth Chart | `.context-chart-section` / `context-chart.css`, `context-chart.js` | 세션 누적 토큰 라인 차트 (탭 위에 배치, 접힘/펼침 애니메이션) |
| **W8** | Detail Tab Bar & Controls | `.view-tab-bar`, `.detail-controls-bar` / `detail-view.css` | 4개 탭(플랫/턴/간트/도구) + 검색창 + 7개 타입 필터 |
| **W9** | Detail Flat View | `#detailFlatView` / `table.css` | 단일 세션 플랫 요청 테이블 + 타입별 소계 |
| **W10** | Detail Turn View | `#detailTurnView` > `#turnUnifiedBody` / `turn-view.css`, `session-detail.js` | accordion 카드 + chip 흐름 + 펼침 세부 행 + 연속 도구 그룹화 |
| **W11** | Detail Gantt View | `#detailGanttView` / `turn-gantt.css`, `turn-gantt.js` | 턴별 타임라인 캔버스 + 페이지네이션 + 범례 + hover 툴팁 |
| **W12** | Detail Tools View | `#detailToolsView` / `tool-stats.css`, `tool-stats.js` | 응답시간/호출/토큰 3섹션 막대 그래프 |
| **W13** | Cross-cutting Layer | `cache-tooltip.js`, `stat-tooltip.js`, `cache-panel-tooltip.js`, `anomaly.js`, SSE in `main.js`, `panel-resize.js`, `col-resize.js`, localStorage | 툴팁 시스템 + 이상 감지(spike/loop/slow) + 실시간(SSE/scroll-lock/prependRequest) + 영속화/리사이즈 + 키보드 접근성 + 프롬프트 확장 패널 |

## TUI (5개 화면 컴포넌트 + 1개 cross-cutting)

| 코드 | 컴포넌트 | 파일 | 한 줄 설명 |
|------|---------|-----|------|
| **T1** | Shell (Layout + TabBar + AlertBanner) | `Layout.tsx`, `TabBar.tsx`, `AlertBanner.tsx` | 헤더(SSE 상태·세션 수)·사이드바(세션 10개)·메인·푸터(F1~F4 단축키) + 4개 탭 + 알림 배너 |
| **T2** | Live Tab | `LiveTab.tsx` + `useSSE.ts` | 실시간 토큰 카운터 + 프로그레스 바 + 활성 세션·세션 타이머 + 요약 통계 3개 + 최근 요청 8개 |
| **T3** | History Tab | `HistoryTab.tsx` | 세션 목록 + 검색 필터 + 분할/토글 모드(120 cols 기준) + 세션 상세 요청 15개 + 타입별 소계 |
| **T4** | Analysis Tab | `AnalysisTab.tsx` + `useAnalysis.ts` | 4개 섹션 탭(Overview/Top/By Type/By Tool) + 각 섹션 데이터 |
| **T5** | Settings Tab | `SettingsTab.tsx` + `useConfig.ts` | 4개 필드 편집(warning/critical/apiUrl/pollInterval) + 저장 피드백 |
| **T6** | Cross-cutting Layer | `useKeyboard.ts`, `useStats.ts`, `useSessionList.ts`, `useSSE.ts`, `useAlerts.ts`, `useAlertHistory.ts`, `formatters/*` | 키보드 핸들러(F1~F4/1~4/q/Q/방향키/Enter/ESC/`/`) + SSE/통계/세션 훅 + 토큰/시간/타입 포매터 |

---

## 분류 결정 근거

### Web에서 묶기·쪼개기 결정

- **W1(Global Shell)에 Summary Strip을 합치지 않은 이유**: Summary Strip은 9개 stat-card를 가진 별도의 정보 밀도가 큰 영역이라 디자인 재검토 시 독립적으로 다뤄질 가능성이 높다.
- **W4(Chart Strip)을 Default View에서 분리한 이유**: 차트는 Default View와 Detail View에 모두 노출되지 않고 항상 Right Panel 상단에 고정. `chart-collapsed` 상태도 별도. Cache Intelligence Panel과 도넛/타임라인이 같은 시각 띠를 형성한다.
- **W6+W7+W8을 분리한 이유**: 세 영역 모두 Detail View 진입 시 항상 보이는 셸이지만, **접기/펼치기 단위**가 다르다(W7만 접힘, W6/W8은 항상 표시). Phase 2 재설계 시 각각 다른 의사결정이 필요할 가능성이 큼.
- **W9/W10/W11/W12를 분리한 이유**: 4개 탭이 동일 detail-content 슬롯을 공유하지만, 정보 표현 방식(테이블/카드/캔버스/막대그래프)이 완전히 달라 디자인 의사결정이 독립적이다.
- **W13(Cross-cutting)을 한 덩어리로 묶은 이유**: 모두 "보이지 않지만 화면 전반에 영향을 주는" 레이어다. 인벤토리 단계에서는 누락 방지를 위해 한 문서에서 한꺼번에 다룬다. Phase 2에서 재설계 시 필요하면 다시 쪼갠다.

### TUI에서 묶기·쪼개기 결정

- **T1(Shell)에 TabBar/AlertBanner를 합친 이유**: 셋 다 항상 보이는 외곽이고, 단독으로는 화면을 구성하지 않는다. 디자이너가 "TUI 셸"이라는 한 덩어리로 본다.
- **T2~T5는 탭 단위로 분리**: 사용자가 한 번에 한 탭만 보기 때문에 디자인 의사결정이 탭 단위로 닫힌다.
- **T6(Cross-cutting)을 따로 둔 이유**: 키보드 단축키 정책, SSE 상태, 포매터는 모든 탭에 영향을 주지만 화면이 아니다.

---

## 컴포넌트별 5라운드 인벤토리 매핑

다음 단계(Step 1.2)에서 작성할 `round-5/<file>.md` 매핑:

| 라운드 5 문서 | 포함 컴포넌트 |
|---------------|--------------|
| `web-shell.md` | W1 + W2 |
| `web-left-panel.md` | W3 |
| `web-chart-strip.md` | W4 |
| `web-default-view.md` | W5 |
| `web-detail-shell.md` | W6 + W7 + W8 |
| `web-detail-flat.md` | W9 |
| `web-detail-turn.md` | W10 |
| `web-detail-gantt.md` | W11 |
| `web-detail-tools.md` | W12 |
| `web-cross-cutting.md` | W13 |
| `tui-shell.md` | T1 + T6 |
| `tui-live.md` | T2 |
| `tui-history.md` | T3 |
| `tui-analysis.md` | T4 |
| `tui-settings.md` | T5 |

총 15개 문서.

---

## 다음 단계

각 컴포넌트 그룹마다 5라운드 누적 인벤토리를 작성한다 (Step 1.2). 진행은 병렬·누적이며, 각 문서는 R1~R5 섹션을 명시한다.
