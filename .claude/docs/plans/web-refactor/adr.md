# Web Dashboard 컴포넌트 리팩터링 Architecture Decision Records

> 작성일: 2026-04-28
> 참여 전문가: 소프트웨어 아키텍트, 프론트엔드 엔지니어, QA 엔지니어

---

## ADR-001: 컴포넌트 API 패턴 — 팩토리 함수 채택

### 상태
**결정됨** (2026-04-28)

### 배경

재사용 컴포넌트(filter-bar, search-box, tab-bar 등)를 구현할 때 클래스, 팩토리 함수, 객체 리터럴 중 어떤 패턴을 선택할 것인가.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| 클래스 | `new FilterBar(el, cfg)` | instanceof, private fields | 빌드 없는 환경 생성자 타이밍 버그, 전체 코드베이스 스타일 불일치 |
| 팩토리 함수 | `createFilterBar(el, cfg) → { ... }` | 클로저 캡슐화, 현재 스타일 일관성, 테스트 용이 | instanceof 불가 |
| 객체 리터럴 | `{ render, getValue }` | 단순 | 상태 캡슐화 불가 |

### 결정

**팩토리 함수 패턴** 채택. View 레이어(`DefaultView`, `DetailView`)도 동일 패턴 적용.

```
createFilterBar(containerEl, { attribute, onFilter }) → { setActive(val), reset() }
createSearchBox(containerEl, { onSearch }) → { getValue(), clear() }
```

### 이유

1. 현재 코드베이스 전체가 함수형으로 작성되어 있어 스타일 일관성 유지 (Frontend 관점)
2. 클로저로 private 상태 캡슐화 가능 (`current`, `_subscribers` 등)
3. 빌드 없는 환경에서 클래스 생성자는 DOMContentLoaded 전 실행 시 실패 위험 (Architect 관점)
4. 반환 객체가 `{ getValue, setActive, reset }` 인터페이스로 명확하여 테스트 시 mock 쉬움 (QA 관점)

### 대안 채택 시 영향

- 클래스 선택 시: private fields(`#field`)의 Safari 14 이하 미지원, 코드베이스 전면 스타일 충돌

---

## ADR-002: HTML 마운트 전략 — 정적 HTML 골격 유지 + 점진적 강화

### 상태
**결정됨** (2026-04-28)

### 배경

현재 `index.html`에 인라인된 뷰 HTML을 어떻게 모듈화할 것인가.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A: 현행 유지 | index.html에 전체 인라인 | 변경 없음 | 중복 HTML 유지 |
| B: fetch() HTML | 별도 .html 파일 로드 | 파일 분리 | 네트워크 왕복, FOUC, innerHTML 신뢰 문제 |
| C: JS 템플릿 리터럴 | JS 파일이 HTML 생성 | 컴포넌트 독립 | FOUC, initColResize 타이밍 충돌, 대규모 재작성 |
| D: 자리표시자 + innerHTML ✅ | HTML 골격은 유지, 반복 패턴만 JS 교체 | 점진적, FOUC 없음 | 부분 적용 복잡도 |

### 결정

**옵션 D**: `index.html`에 레이아웃 골격과 컨테이너 자리표시자 유지. 필터 버튼처럼 완전 중복된 반복 패턴만 `createFilterBar`가 `innerHTML`로 교체. 뷰 진입점 `<div>`는 정적 HTML에 남김.

### 이유

1. `initColResize(document.querySelector('#feedBody table'))` 등 정적 DOM에 의존하는 초기화 코드가 다수 존재 (Frontend 관점)
2. 빌드 없는 환경에서 fetch() 추가 왕복은 로컬 서버 환경에서도 레이아웃 시프트 유발 (Architect 관점)
3. 정적 골격 유지 시 각 Phase가 독립 완결 — 회귀 위험 최소화 (QA 관점)
4. index.html 498줄 중 필터 버튼 중복 제거만으로 ~80줄 감소 목표 달성 가능

### 전문가 이견

**Architect 관점**: JS 완전 렌더로 가면 컴포넌트 독립성이 높아지나 현재 규모에서 오버엔지니어링
**QA 관점**: FOUC 없는 정적 HTML 방식이 단계별 검증에 유리
**해소**: 현재 규모(498줄)에서 점진적 강화 방식이 리스크·비용 최적

---

## ADR-003: 상태 관리 전략 — 두 계층 분리

### 상태
**결정됨** (2026-04-28)

### 배경

분산된 상태(`uiState`/`_detailFilter`/`_scrollLockNewCount`)를 어디에서 관리할 것인가.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A: 단일 state.js | 모든 상태 중앙화 | 예측 가능성 | 순환 의존 위험, 스타 토폴로지 |
| B: 두 계층 분리 ✅ | 라우팅 상태 / 뷰 로컬 상태 | 순환 의존 없음, 점진적 적용 | 완전한 통합 아님 |
| C: 현행 유지 | 각 모듈이 자기 상태 소유 | 변경 없음 | 추적 불가 |

### 결정

**두 계층 분리**:

- **라우팅 상태** (`state.js`): `rightView`, `detailTab`, `selectedProject`, `selectedSession` — getter/setter로만 외부 노출
- **뷰 로컬 상태**: 해당 View 모듈이 계속 소유 (`_detailFilter`, `_detailAllRequests`, `_currentSessionId`)
- **인프라 상태**: `infra.js`가 계속 소유 (`_scrollLockNewCount`, LIVE 배지 등)

### 이유

1. 라우팅 상태는 여러 모듈이 읽어야 하므로 공유 필요. 뷰 로컬 상태는 해당 뷰 외부에서 읽을 이유 없음 (Architect 관점)
2. 단일 state.js는 `api.js → state.js ← session-detail.js` 구조에서 순환 의존 발생 위험 (Frontend 관점)
3. getter/setter 형태 노출 시 상태 변경 추적 지점 단일화 → 디버깅·테스트 용이 (QA 관점)

### 추가 결정: `sessionAbortController`

`selectSession`의 AbortController는 `DetailView` 내부로 이동. 외부에서 직접 접근 금지. 세션 전환 시 `detailView.loadSession(id)`가 내부적으로 이전 요청 취소 처리.

---

## ADR-004: 이벤트 처리 전략 — 위임 유지 + CustomEvent 보조

### 상태
**결정됨** (2026-04-28)

### 배경

컴포넌트 분리 후 이벤트를 컴포넌트가 자체 등록할 것인가, main.js 이벤트 위임을 유지할 것인가.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A: 컴포넌트 자체 등록 | 각 컴포넌트 init()에서 addEventListener | 컴포넌트 독립 | 이중 등록 위험, teardown 복잡 |
| B: 이벤트 위임 유지 ✅ | main.js가 위임 핸들러 소유, 컴포넌트는 순수 렌더 | 현재 구조 연속, 중복 없음 | main.js에 라우팅 로직 잔류 |
| C: CustomEvent 전면 | 모든 통신을 CustomEvent | 완전 분리 | 무음 실패, 이름 오타 미탐지 |

### 결정

**이벤트 위임 `main.js` 유지 + CustomEvent 보조적 사용**.

- 클릭/키보드: 기존 이벤트 위임 유지
- `applyDetailFilter`의 fan-out(gantt·turn·chart 렌더)만 `detail:filterChanged` CustomEvent로 분해
- SSE 분리: `connectSSE({ onNewRequest, onSessionEnd, onOpen, onError })` 콜백 주입 방식

### 이유

1. 컴포넌트 자체 addEventListener는 빌드 없는 환경에서 이중 등록 시 콘솔 에러 없이 동작 이상만 발생 (QA 관점)
2. CustomEvent 전면 사용 시 `gantt:turnClick` 누락 등 무음 실패 위험 (QA 관점)
3. `applyDetailFilter`의 7개 부수 효과를 CustomEvent로만 분해하면 각 탭이 독립적으로 테스트 가능 (Architect 관점)
4. SSE 콜백 주입 방식은 `sse.js`를 순수 연결 관리자로 단위 테스트 가능 (Frontend 관점)

---

## ADR-005: `renderRequests` 통합 전략 — 부분 통합

### 상태
**결정됨** (2026-04-28)

### 배경

`renderers.js:renderRequests`와 `session-detail.js:renderDetailRequests`가 `makeRequestRow`를 공통으로 쓰면서도 세부 동작이 다름. 통합 여부.

### 결정

**완전 통합하지 않음**. 대신 책임 경계 재정의:

- `renderers.js`: HTML 생성 함수만 (`makeRequestRow`, `makeTargetCell` 등) — DOM 직접 조작 제거
- `renderRequests` (DOM 삽입): `DefaultView` 내부로 이동
- `renderDetailRequests` (DOM 삽입 + 스크롤 복원 + subtotal): `DetailView` 내부로 이동
- 두 함수 모두 `promptCache`를 외부에서 주입받도록 시그니처 변경

### 이유

1. `renderDetailRequests`는 스크롤 복원, 프롬프트 확장 복원, subtotalRow 추가 — `renderRequests`와 행동이 실질적으로 다름 (Frontend 관점)
2. 완전 통합 시 config 항목 8개 이상 → 가독성 역전 (Frontend 관점)
3. `makeRequestRow`(HTML 생성)와 DOM 삽입 분리 자체가 진짜 단일 책임 원칙 적용 (Architect 관점)

---

## ADR-006: `SUB_TYPES` 상수 — SSoT 모듈화

### 상태
**결정됨** (2026-04-28)

### 배경

`agent/skill/mcp` 분류 로직이 `main.js`, `session-detail.js`, `api.js` 등 여러 곳에 분산.

### 결정

`request-types.js` 신규 파일 생성 (또는 `formatters.js`에 통합):

```js
export const SUB_TYPES = ['agent', 'skill', 'mcp'];
export function isSubType(type) { return SUB_TYPES.includes(type); }
export function getRequestCategory(r) { ... }
```

모든 모듈이 이 파일에서 import.

### 이유

현재 한 곳에만 새 sub-type 추가 시 다른 곳에서 누락되는 버그 직접 원인 (QA 관점)

---

## ADR-007: 리팩터링 단계 순서

### 상태
**결정됨** (2026-04-28)

### 결정

회귀 위험 최소화를 위한 실행 순서:

| 단계 | 작업 | 핵심 이유 |
|------|------|-----------|
| Phase 0 | 선행 테스트 확보 (골든 스냅샷 + 순수 함수 단위 테스트) | 회귀 기준선 수립 |
| Phase 1 | `request-types.js` + `filter-bar.js` + `search-box.js` | 가장 독립적, 누락 버그 직접 해결 |
| Phase 2 | `sse.js` 분리 (콜백 주입 방식) | main.js 슬림화 기반 |
| Phase 3 | `state.js` (라우팅 상태 getter/setter) | 모든 View 모듈의 공통 의존성 |
| Phase 4 | `DefaultView` 추출 (`prependRequest`, `fetchRequests`, `applyFeedSearch`) | SSE 분리 후 가능 |
| Phase 5 | `DetailView` 추출 (`selectSession`, `loadSessionDetail`, `applyDetailFilter` 분해) | 가장 고위험 — 마지막 |

### 이유

- Phase 5는 `sessionAbortController`, `_expandedTurnIds`, `applyDetailFilter` fan-out 분해를 모두 포함하는 최고 위험 작업 → 다른 모든 Phase 완료 후 집중 실행 (세 전문가 공통 의견)
- 각 Phase 완료 후 Playwright 회귀 시나리오 6개 실행 필수

---

## 주요 구현 주의사항 (전문가 공통)

1. **`initColResize` 타이밍**: 테이블이 정적 HTML에 존재하는 한 현재 호출 위치 유지. 마운트 전략 변경 시 함께 이동
2. **`_promptCache` 소유권**: 세션 전환 시 clear 책임을 `DetailView.loadSession()`에 명시
3. **`detail-collapsed` 클래스**: `selectSession` → 제거, `closeDetail` → 추가 쌍 로직을 `DetailView` 내부화
4. **`api.js`의 `showError` 로컬 복사본**: 리팩터링 시 `infra.js` import로 교체 필수
5. **`toolIconHtml` 지역 사본** (left-panel.js): `renderers.js` export로 통일
6. **`feed:updated` CustomEvent**: 발행 위치를 `DefaultView` 또는 `sse.js` 핸들러로 단일화
