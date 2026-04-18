# Web UI/UX Architecture Decision Records

> 작성일: 2026-04-18  
> 참여 전문가: 소프트웨어 아키텍트, 프론트엔드 엔지니어

---

## ADR-001: 고정 높이 2패널 레이아웃 (CSS Grid)

### 상태
**결정됨** (2026-04-18)

### 배경
현재 레이아웃은 수직 flex 스택으로 페이지가 무한히 길어지고, 세션 상세 진입 시 scrollIntoView로 이동하는 UX가 이질적이다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A. CSS Grid | `grid-template-rows: auto auto 1fr auto` | 선언적, 에러 배너 행 추가 시 자동 조정 | 구조 변경 범위 큼 |
| B. Flexbox 중첩 | 기존 방식 확장 | 변경 최소 | calc() 동기화 부담, 높이 버그 위험 |
| C. Position Fixed | 패널을 fixed로 고정 | 빠른 구현 | 스크롤 충돌, 반응형 어려움 |

### 결정

CSS Grid로 전체 레이아웃 뼈대를 재설계한다.

```css
body {
  display: grid;
  grid-template-rows: auto auto 1fr auto; /* header, summary-strip, main, footer */
  height: 100vh;
  overflow: hidden;
  padding: 0;
}
.main-layout {
  display: grid;
  grid-template-columns: var(--left-panel-width, 280px) 1fr;
  overflow: hidden;
}
```

### 이유

1. Grid `1fr` 행이 헤더/Summary Strip 크기 변화를 자동 흡수 — 에러 배너 등장 시에도 메인 패널 높이가 유지됨 (아키텍트 관점)
2. 좌우 패널을 `overflow: hidden`으로 감싸면 내부 스크롤 구현이 명확해짐 (프론트엔드 관점)
3. `--left-panel-width` CSS 변수로 미디어 쿼리 재정의가 단순함

### 대안 채택 시 영향

- Flexbox 유지 시: `calc(100vh - Npx)` 헤더 높이 동기화 코드가 JS에 생기고 에러 배너 표시 시 레이아웃이 깨짐

---

## ADR-002: 명시적 UIState 객체 + renderRightPanel() 단일 진입점

### 상태
**결정됨** (2026-04-18)

### 배경

현재 `selectedProject`, `selectedSession` 두 변수로 암묵적으로 UI 상태를 관리하며 `renderDetailRequests`, `closeDetail`, `setDetailView` 등이 각자 DOM을 직접 조작한다. 2패널 구조에서 이 방식은 상태 불일치 버그를 만들기 쉽다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A. 명시적 상태 객체 | `uiState = { rightView, detailTab, ... }` | 예측 가능, 디버깅 용이 | 기존 코드 리팩토링 필요 |
| B. 현재 방식 유지 | 함수마다 DOM 직접 조작 | 변경 최소 | 2패널 전환 시 버그 위험 |
| C. Proxy reactive | `Proxy` 기반 자동 렌더 | 자동 갱신 | 바닐라 JS에서 복잡도 과도 |

### 결정

단순 객체 + `renderRightPanel()` 명시적 호출 패턴을 도입한다. Proxy는 사용하지 않는다.

```js
const uiState = {
  rightView: 'default',  // 'default' | 'detail'
  detailTab: 'flat',     // 'flat' | 'turn'
};
// 변경 시: uiState.rightView = 'detail'; renderRightPanel();
```

### 이유

1. 세션 전환 시 탭 상태 초기화가 명시적으로 가능 (프론트엔드: 이전 세션 턴 뷰 잔재 버그 방지)
2. 슬라이드 인 중 중복 클릭 방지(`isTransitioning` 플래그) 관리가 단순해짐

---

## ADR-003: 새로고침 버튼 제거, manualRefresh() 함수 유지

### 상태
**결정됨** (2026-04-18)

### 배경

SSE `new_request` 이벤트 → 300ms 디바운스 → `fetchDashboard() + fetchRequests() + fetchAllSessions()` 자동 실행이 이미 구현되어 있다. 헤더의 새로고침 버튼은 중복이다.

### 결정

- 헤더에서 `#btnRefresh` 버튼 HTML 제거
- `manualRefresh()` 함수는 **유지** — 에러 배너 "다시 시도" 버튼이 참조함
- `btn-refresh` CSS 클래스 제거

### 이유

1. SSE가 연결된 상태에서 수동 새로고침은 불필요한 API 중복 호출임
2. 단, SSE 오류 상태의 에러 배너는 manualRefresh()를 호출하므로 함수 자체는 필요

---

## ADR-004: Canvas ResizeObserver 도입

### 상태
**결정됨** (2026-04-18)

### 배경

현재 `window.addEventListener('resize', drawTimeline)`은 CSS 패널 전환(flex-1, grid 1fr 변화)을 감지하지 못한다. 2패널 구조에서 우측 패널 너비가 CSS transition으로 변하는 경우 차트가 잘못된 크기로 렌더링된다.

### 결정

```js
const timelineWrap = document.querySelector('.timeline-wrap');
if ('ResizeObserver' in window) {
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(_rafId);
    _rafId = requestAnimationFrame(() => drawTimeline());
  });
  ro.observe(timelineWrap);
} else {
  window.addEventListener('resize', drawTimeline);
}
```

rAF로 래핑하여 리사이즈 중 연속 호출을 1프레임으로 병합한다.

### 이유

1. CSS transition으로 인한 패널 너비 변화를 캐치할 수 없는 현재 방식의 구조적 결함 해결
2. rAF 래핑으로 ResizeObserver의 연속 콜백 성능 문제 해결

---

## ADR-005: 우측 패널 뷰 전환 — position absolute + opacity/transform

### 상태
**결정됨** (2026-04-18)

### 배경

우측 패널에서 "기본 뷰(타임라인+피드)" ↔ "세션 상세" 전환을 부드럽게 구현해야 한다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A. absolute overlay + opacity/transform | 두 뷰를 DOM에 유지, CSS transition | GPU 합성, 레이아웃 재계산 없음 | 비활성 뷰 pointer-events 관리 필요 |
| B. display none/block | 단순 토글 | 구현 단순 | CSS transition 불가 |
| C. max-height 트릭 | 0 → auto 트릭 | transition 가능 | 타이밍 어색, 성능 저하 |

### 결정

```css
.right-view {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  opacity: 0;
  transform: translateX(6px);
  transition: opacity 0.18s ease, transform 0.18s ease;
  pointer-events: none;
}
.right-view.active {
  opacity: 1;
  transform: translateX(0);
  pointer-events: auto;
}
```

### 이유

1. GPU 합성 레이어 사용으로 레이아웃 재계산 없음 (아키텍트: transform 기반 슬라이드)
2. 두 뷰를 DOM에 유지하므로 슬라이드 애니메이션 중 데이터 로딩 병행 가능

### 전문가 이견

**아키텍트**: 슬라이드 인 중 다른 세션 클릭 → `isTransitioning` 플래그로 중복 클릭 차단 필요
**프론트엔드**: `pointer-events: none`을 비활성 뷰에 빠뜨리면 클릭 이벤트 통과 위험
**해소**: 두 조건 모두 구현. `transitionend` 이벤트 후 플래그 해제.

---

## ADR-006: SSE 재연결 시 데이터 재로드

### 상태
**결정됨** (2026-04-18)

### 배경

현재 `sseSource.onopen`에서 `clearError()`만 호출하고 데이터 재로드가 없다. SSE 단절 구간의 변경사항이 UI에 반영되지 않는 잠재 버그다. 두 전문가 모두 독립적으로 식별한 문제.

### 결정

```js
sseSource.onopen = () => {
  clearError();
  clearTimeout(retryTimer);
  // 재연결 성공 시 단절 구간 데이터 복구
  fetchDashboard();
  fetchRequests();
  fetchAllSessions();
};
```

---

## ADR-007: Tool Stats 섹션 — Left Panel 내 조건부 표시

### 상태
**결정됨** (2026-04-18)

### 배경

Tool Stats 테이블이 전체 너비로 항상 펼쳐져 있어 고정 높이 레이아웃에서 공간을 차지한다. 2패널 구조에서 위치를 명확히 해야 한다.

### 결정

- Tool Stats 섹션을 Left Panel 하단으로 이동
- 데이터가 없으면 `display: none` 처리
- 별도 접기/펼치기(토글) 없이 단순 조건부 렌더

### 이유

Right Panel은 타임라인 차트 + 세션 상세를 위한 공간이므로 Tool Stats를 넣기 부적합. Left Panel의 프로젝트/세션 목록 아래 자연스럽게 연결됨.

---

## 구현 우선순위 정리

| 우선순위 | 항목 |
|---------|------|
| P0 (필수) | 레이아웃 재구성 (ADR-001), 패널 상태 (ADR-002), 새로고침 제거 (ADR-003) |
| P1 (중요) | Canvas ResizeObserver (ADR-004), 뷰 전환 애니메이션 (ADR-005), SSE 재연결 (ADR-006) |
| P2 (개선) | Tool Stats 이동 (ADR-007), 디자인 개선, _promptCache 제한 |
