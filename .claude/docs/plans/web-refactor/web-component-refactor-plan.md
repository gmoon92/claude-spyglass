# Web Dashboard 컴포넌트 리팩터링 계획

## 작업 목표

바닐라 JS + ES Module 환경(빌드 도구 없음)에서 웹 대시보드의 중복 코드와 God Object 구조를 제거하여:
1. 기능 추가 시 누락 버그 근절
2. AI 컨텍스트 비용 절감 (파일별 책임 단순화)
3. 단일 책임 원칙 적용

## 기술 환경

- **런타임**: Bun HTTP 서버가 `packages/web/`을 정적 서빙
- **모듈 시스템**: ES Module (import/export) — 이미 사용 중
- **빌드**: 없음 — TypeScript 컴파일, 번들링 없이 브라우저가 직접 로드
- **제약**: React/Vue 없음, import 경로는 상대경로 또는 루트 상대경로

## 현재 파일 구조 및 규모

```
packages/web/
  index.html              498줄  — 모든 뷰 HTML 인라인
  assets/js/
    main.js               756줄  — God Object (뷰전환+SSE+이벤트+키보드+상태)
    session-detail.js     570줄  — 세션 상세 4탭 (flat/turn/gantt/tools)
    renderers.js          372줄  — row/icon/badge HTML 생성
    turn-gantt.js         553줄  — 간트 차트
    left-panel.js         145줄  — 좌측 패널 (프로젝트/세션/툴통계)
    api.js                170줄  — HTTP API 호출
    chart.js              254줄  — 타임라인/도넛 차트
    infra.js               53줄  — 에러배너, LIVE배지, 스크롤락 (상태 일부)
    formatters.js          61줄  — 숫자/날짜 포맷
    [기타 소형 파일 10개]
```

## 화면(뷰) 목록

| 뷰 ID | 설명 | 코드 위치 |
|-------|------|-----------|
| `defaultView` | 전역 요청 피드 (로그1) | main.js |
| `detailView > detailFlatView` | 세션별 플랫 로그 (로그2) | session-detail.js |
| `detailView > detailTurnView` | 턴 기반 뷰 (로그3) | session-detail.js |
| `detailView > detailGanttView` | 간트 차트 | turn-gantt.js |
| `detailView > detailToolsView` | 도구 통계 | tool-stats.js |

## 확인된 중복 코드 목록

### 1. 필터 버튼 (가장 심각 — 누락 버그 직접 원인)
- `index.html:295-307` `typeFilterBtns` — 7개 버튼 (`data-filter` 속성)
- `index.html:357-369` `detailTypeFilterBtns` — 동일한 7개 버튼 (`data-detail-filter` 속성)
- JS: `main.js`의 typeFilter 핸들러 vs `session-detail.js`의 detailFilter 핸들러 — 같은 로직

### 2. 검색 박스
- `index.html:290-294` `feedSearchInput` + `feedSearchClear`
- `index.html:351-356` `detailSearchInput` + `detailSearchClear`
- JS: `main.js` 인라인 vs `session-detail.js:516 initDetailSearch()` — 같은 패턴

### 3. 요청 목록 렌더러
- `renderers.js:359 renderRequests(list, anomalyMap)` → `requestsBody` (showSession: true)
- `session-detail.js:27 renderDetailRequests(list, anomalyMap)` → `detailRequestsBody` (showSession: false)
- 차이: DOM ID와 showSession 플래그뿐 — 사실상 동일 함수

### 4. 패널 섹션 HTML 구조
- `index.html:79-100` 프로젝트 패널 (`panel-section > panel-header > panel-body`)
- `index.html:106-119` 세션 패널 — 동일 구조
- `index.html:121-145` 툴 통계 패널 — 동일 구조

### 5. 상태 관리 분산
- `main.js` 상단: `uiState` 객체 (rightView, detailTab, dateRange 등)
- `session-detail.js` 모듈 변수: `_detailFilter`, `_detailAllRequests`, `_currentSessionId` 등
- `infra.js`: `_scrollLockNewCount`
- 통합 없이 각자 관리 → 상태 추적 어려움

### 6. `activeTypeFilterButtons()` / `activeSearchInput()` 분기 함수
- `main.js:538-541`: 현재 활성 뷰에 따라 두 필터 중 하나를 선택
- 이 함수의 존재 자체가 "원래 하나여야 했다"는 설계 결함의 증거

## 목표 구조

```
assets/js/
  components/             ← 재사용 UI 단위 (팩토리 함수 패턴)
    filter-bar.js         createFilterBar(containerId, config) → { getValue, setValue, render }
    search-box.js         createSearchBox(containerId, config) → { getValue, clear, focus }
    tab-bar.js            createTabBar(containerId, tabs, config) → { setActive }
    request-table.js      createRequestTable(bodyId, config) → { render, append, clear }

  views/                  ← 화면 단위 (뷰별 HTML 마운트 + 로직)
    default-view.js       DefaultView: fetchRequests, prependRequest, 전역 피드
    detail-view.js        DetailView: selectSession, 4탭 관리 (session-detail.js 흡수)

  state.js                전역 UI 상태 통합 (uiState + 분산된 모듈 변수)
  sse.js                  connectSSE (main.js에서 분리)
  main.js                 진입점 + 초기화 오케스트레이션 (목표 200줄 이하)

  [기존 유지]
    renderers.js          row/cell HTML 생성 (변경 없음)
    chart.js, turn-gantt.js, formatters.js, api.js 등
```

## index.html 다이어트 목표

현재 498줄 중 뷰 HTML이 약 300줄. 목표:
- 뷰 HTML은 각 view JS 파일의 템플릿 함수로 이동 (JS로 마운트)
- index.html은 레이아웃 쉘 + script 로드만 (~150줄 목표)

## 제약 및 우선순위

- 기존 기능 회귀 없이 점진적 리팩터링
- CSS는 현행 유지 (css 파일은 이미 잘 분리돼 있음)
- 빌드 도구 도입 없이 ES Module만으로 해결
- CLAUDE.md의 렌더링 함수 재사용 원칙 준수 (`makeTargetCell`, `makeRequestRow` 등)

## 전문가에게 요청하는 설계 결정 사항

1. **컴포넌트 API 설계**: 팩토리 함수 vs 클래스 vs 객체 리터럴 — 바닐라 JS에서 최적 패턴
2. **HTML 마운트 전략**: JS 템플릿 리터럴 vs fetch() HTML 파일 vs 자리표시자+innerHTML
3. **상태 통합 방안**: 분산된 모듈 상태를 어떻게 단일 상태로 통합할 것인가
4. **단계별 실행 계획**: 회귀 위험 최소화하면서 어느 순서로 분리할 것인가
5. **`renderRequests` 통합**: bodyId + config를 파라미터로 받는 단일 함수로 통합 시 API 설계
