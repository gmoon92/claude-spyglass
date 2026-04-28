# Web Dashboard 컴포넌트 리팩터링 작업 목록

> 기반 문서: plan.md, adr.md
> 작성일: 2026-04-28 | 검토 반영: 2026-04-28 (기술 리드 + 품질 엔지니어)
> 총 태스크: 22개

---

## 의존성 그래프

```
T-01 → T-02 → T-03
                ↓
T-04 → T-05 → T-06
 ↓              ↓
T-07 → T-08 (Phase 1 완료)
                ↓            ↘
              T-09 ⚠️       T-10 (병렬 가능)
              T-09a          T-10a
                ↘            ↙
                T-11 (Phase 2 완료)
                    ↓
                T-12 → T-13 (Phase 3 완료)
                            ↓
                        T-14 ⚠️ → [스모크] → T-15a → T-15 → T-15b
                                                              ↓
                                                T-16 ⚠️ → T-17 → T-18 → T-19
```

---

## 태스크 목록

| ID | 태스크 | 예상 시간 | 선행 태스크 | 커밋 타입 |
|----|--------|----------|------------|----------|
| T-01 | `detectAnomalies` 단위 테스트 | 1h | - | test |
| T-02 | `makeRequestRow` 골든 스냅샷 테스트 | 1h | T-01 | test |
| T-03 | 순수 함수 단위 테스트 (api 파라미터, formatters) | 1h | T-02 | test |
| T-04 | `request-types.js` SSoT 생성 + 3개 파일 참조 교체 | 1h | T-03 | refactor |
| T-05 | `filter-bar.js` 컴포넌트 추출 | 2h | T-04 | refactor |
| T-06 | `search-box.js` 컴포넌트 추출 | 1.5h | T-05 | refactor |
| T-07 | `api.js` showError 중복 제거 + `toolIconHtml` 참조 통일 | 0.5h | T-03 | refactor |
| T-08 | Phase 1 회귀 검증 (6개 시나리오) | 1h | T-06, T-07 | test |
| T-09 | `sse.js` 분리 (콜백 주입 방식) ⚠️ | 1.5h | T-08 | refactor |
| T-09a | `sse.js` 단위 테스트 (MockEventSource) | 1h | T-09 | test |
| T-10 | `state.js` 생성 (라우팅 상태 getter/setter) | 1h | T-08 | refactor |
| T-10a | `state.js` 단위 테스트 | 0.5h | T-10 | test |
| T-11 | Phase 2 회귀 검증 | 0.5h | T-09a, T-10a | test |
| T-12 | `DefaultView` 추출 | 2.5h | T-11 | refactor |
| T-13 | Phase 3 회귀 검증 | 0.5h | T-12 | test |
| T-14 | `DetailView` 기반 추출 (selectSession + AbortController) ⚠️ | 2h | T-13 | refactor |
| T-15a | `events.js` 이벤트 상수 SSoT 생성 | 0.5h | T-14 | refactor |
| T-15 | `applyDetailFilter` fan-out → `detail:filterChanged` CustomEvent | 2h | T-15a | refactor |
| T-15b | CustomEvent 발행-구독 단위 테스트 | 1h | T-15 | test |
| T-16 | `renderers.js` 정리 (DOM 삽입 제거) ⚠️ | 1h | T-15b | refactor |
| T-17 | `index.html` 다이어트 | 1h | T-16 | refactor |
| T-18 | 전체 회귀 검증 | 1h | T-17 | test |
| T-19 | 문서 정리 (adr.md, tasks.md 상태 갱신) | 0.5h | T-18 | docs |

---

## Phase 0 — 선행 테스트 확보

## T-01: `detectAnomalies` 단위 테스트

**선행 조건**: 없음

### 구현 범위
- `packages/web/assets/js/__tests__/anomaly.test.ts`: 신규
  - spike: 2배 정확히/초과/미달 경계
  - loop: 동일 tool 연속 정확히 3회 충족/미달
  - slow: P95 2배 경계
  - 정상: 빈 배열, 단일 요청

### 커밋 메시지
```
test(web): detectAnomalies 경계값 단위 테스트 추가
```

### 검증 명령어
```bash
bun test packages/web/assets/js/__tests__/anomaly.test.ts
```

### 완료 기준
- [ ] spike/loop/slow 경계값 케이스 통과
- [ ] 빈 배열 → 빈 Map 반환 확인

---

## T-02: `makeRequestRow` 골든 스냅샷 테스트

**선행 조건**: T-01 완료

### 구현 범위
- `packages/web/assets/js/__tests__/renderers.test.ts`: 신규
  - `makeRequestRow(r, { showSession: true/false })` × prompt/tool_call/system
  - `makeTargetCell(r)` — tool_name 있는/없는
  - `makeSessionRow(s, true/false)`

### 커밋 메시지
```
test(web): makeRequestRow 골든 스냅샷 테스트 추가
```

### 완료 기준
- [ ] 스냅샷 파일 생성 완료
- [ ] 갱신 조건 명시: 의도적 UI 변경 시 `bun test --update-snapshots` + 커밋 메시지에 "snapshot update" 표기 필수

---

## T-03: 순수 함수 단위 테스트 (api 파라미터, formatters)

**선행 조건**: T-02 완료

### 구현 범위
- `packages/web/assets/js/__tests__/api.test.ts`: dateRange 경계값, filter 파라미터 조합
- `packages/web/assets/js/__tests__/formatters.test.ts`: 토큰/시간 포맷 경계값

### 커밋 메시지
```
test(web): api 파라미터 조합, formatters 단위 테스트 추가
```

### 완료 기준
- [ ] 전체 테스트 통과
- [ ] Phase 0 기준선 확보 완료

---

## Phase 1 — 공통 컴포넌트 추출

## T-04: `request-types.js` SSoT 생성 + 3개 파일 참조 교체

**선행 조건**: T-03 완료

### 구현 범위
- `packages/web/assets/js/request-types.js`: **신규**
  ```js
  export const SUB_TYPES = ['agent', 'skill', 'mcp'];
  export function isSubType(type) { ... }
  export function getRequestCategory(r) { ... }
  ```
- **교체 대상 3개 파일** (기술 리드 검토 반영):
  1. `main.js`: `SUB_TYPES` 인라인 배열 → import
  2. `session-detail.js`: `applyDetailFilter` 내 countMap 하드코딩 키 → import
  3. `renderers.js`: `subTypeOf` 함수 내부 인라인 배열 → import

### 커밋 메시지
```
refactor(web): SUB_TYPES 상수를 request-types.js SSoT로 통합
```

### 검증 명령어
```bash
bun test
grep -rn "\[.agent.\|.skill.\|.mcp.\]" packages/web/assets/js/*.js | grep -v request-types
# 결과가 0줄이어야 함
```

### 완료 기준
- [ ] `request-types.js` 이외 파일에 `['agent', 'skill', 'mcp']` 인라인 배열 없음
- [ ] 기존 테스트 전체 통과

---

## T-05: `filter-bar.js` 컴포넌트 추출

**선행 조건**: T-04 완료

### 구현 범위
- `packages/web/assets/js/components/filter-bar.js`: **신규**
  ```js
  export function createFilterBar(containerEl, { attribute, onFilter }) {
    return { setActive(val), reset(), getActive() }
  }
  ```
- `packages/web/index.html`: 필터 버튼 HTML → 빈 컨테이너로 교체 (~40줄 감소)
- `packages/web/assets/js/main.js`:
  - `feedFilterBar` / `detailFilterBar` 인스턴스 생성
  - `activeTypeFilterButtons()` 함수 삭제 → `currentFilterBar.setActive(idx)`로 대체

### 커밋 메시지
```
refactor(web): 필터 버튼 중복을 filter-bar.js 컴포넌트로 추출
```

### 완료 기준
- [ ] `activeTypeFilterButtons()` 함수 삭제 확인
- [ ] defaultView/detailView 필터 버튼 각 7개 정상 동작
- [ ] 숫자키 1–7이 현재 활성 뷰에 올바르게 적용됨
- [ ] index.html 필터 버튼 HTML 중복 제거 (~40줄)

---

## T-06: `search-box.js` 컴포넌트 추출

**선행 조건**: T-05 완료

### 구현 범위
- `packages/web/assets/js/components/search-box.js`: **신규**
  ```js
  export function createSearchBox(containerEl, { onSearch }) {
    return { getValue(), clear(), focus() }
  }
  ```
- `packages/web/index.html`: 검색 박스 HTML 중복 제거 (~20줄 감소)
- `packages/web/assets/js/main.js`: `activeSearchInput()` 삭제
- `packages/web/assets/js/session-detail.js`: `initDetailSearch()` → `createSearchBox` 사용

### 커밋 메시지
```
refactor(web): 검색 박스 중복을 search-box.js 컴포넌트로 추출
```

### 완료 기준
- [ ] `activeSearchInput()` 함수 삭제 확인
- [ ] feed/detail 검색 서로 독립적으로 동작
- [ ] ESC 클리어 동작 유지

---

## T-07: `api.js` showError 중복 + `toolIconHtml` 참조 통일

**선행 조건**: T-03 완료 (기술 리드 검토 반영 — T-06 과 무관)

### 구현 범위
- `packages/web/assets/js/api.js`: 로컬 `showError` → `infra.js` import 교체
- `packages/web/assets/js/left-panel.js`: 로컬 `toolIconHtml` → `renderers.js` import 교체
  - `eventType` 파라미터 갭 해소: 호출부에 `undefined` 명시 또는 기본값 처리

### 커밋 메시지
```
refactor(web): api.js showError 중복 제거, left-panel toolIconHtml 참조 통일
```

### 검증 명령어
```bash
grep -n "function showError\|function toolIconHtml" packages/web/assets/js/api.js packages/web/assets/js/left-panel.js
# 결과가 0줄이어야 함
```

### 완료 기준
- [ ] `api.js`에 로컬 `showError` 없음
- [ ] `left-panel.js`에 로컬 `toolIconHtml` 없음

---

## T-08: Phase 1 회귀 검증

**선행 조건**: T-06, T-07 완료

### 검증 시나리오 (6개)
1. defaultView 필터 버튼 → 숫자키 1–7 각각 동작
2. detailView 필터 버튼 → 숫자키 1–7 각각 동작
3. 뷰 전환 후 즉시 숫자키 → 올바른 뷰 필터 적용
4. 검색 입력 → 피드 필터링 → ESC 클리어
5. detail 검색 입력 → 세션 데이터 필터링 → ESC 클리어
6. SSE 수신 중 필터 변경 → 실시간 데이터에 필터 적용 유지

### 커밋 메시지
```
test(web): Phase 1 회귀 검증 통과
```

### 완료 기준
- [ ] 6개 시나리오 모두 통과
- [ ] `bun test` 전체 통과

---

## Phase 2 — SSE 분리 + 상태 통합

## T-09: `sse.js` 분리 (콜백 주입 방식) ⚠️ 고위험

**선행 조건**: T-08 완료
**롤백 기준점**: T-08 커밋

### 구현 범위
- `packages/web/assets/js/sse.js`: **신규**
  ```js
  // 공개 API
  export function connectSSE({ onNewRequest, onSessionUpdate, onOpen, onError })
  // 내부: EventSource 생성, 5초 재연결, retryTimer 관리
  ```
- `packages/web/assets/js/main.js`:
  - `connectSSE()` 함수 삭제
  - `import { connectSSE } from './sse.js'`
  - 비즈니스 로직 콜백으로 전달 (`onNewRequest: prependRequest` 등)

### 커밋 메시지
```
refactor(web): SSE 연결 로직을 sse.js로 분리 (콜백 주입 방식)
```

### 롤백 방법
```bash
git revert HEAD  # T-08 상태로 복귀
```

### 완료 기준
- [ ] `main.js`에 `EventSource` 직접 참조 없음
- [ ] 공개 API: `connectSSE({ onNewRequest, onSessionUpdate, onOpen, onError })`
- [ ] SSE 재연결 동작 유지
- [ ] `onOpen` 콜백에서 `fetchDashboard`, `fetchRequests`, `fetchAllSessions` 호출 확인

---

## T-09a: `sse.js` 단위 테스트

**선행 조건**: T-09 완료

### 구현 범위
- `packages/web/assets/js/__tests__/sse.test.ts`: **신규** (MockEventSource 기반)
  - 연결 성공 → `onOpen` 호출 확인
  - `new_request` 메시지 → `onNewRequest` 콜백 호출 확인
  - 연결 오류 → `onError` 호출 + 5초 후 재연결 시도 확인
  - 재연결 후 `onOpen` 재호출 확인

### 커밋 메시지
```
test(web): sse.js 연결/재연결/에러 콜백 단위 테스트 추가
```

### 완료 기준
- [ ] MockEventSource로 네트워크 없이 테스트 통과
- [ ] 재연결 타이밍 테스트 포함

---

## T-10: `state.js` 생성 (라우팅 상태 getter/setter)

**선행 조건**: T-08 완료 (T-09와 병렬 가능 — 기술 리드 검토 반영)

### 구현 범위
- `packages/web/assets/js/state.js`: **신규**
  - 이전 대상 상태 키: `rightView`, `detailTab`, `selectedProject`, `selectedSession`
  - getter/setter 형태로만 외부 노출 (직접 객체 export 금지)
- `packages/web/assets/js/main.js`: `uiState.rightView` 등 → `setRightView()` 등으로 교체
- `packages/web/assets/js/session-detail.js`: `uiState` 직접 참조 → getter 사용

### 커밋 메시지
```
refactor(web): 라우팅 상태를 state.js getter/setter로 통합
```

### 검증 명령어
```bash
grep -n "uiState\." packages/web/assets/js/main.js packages/web/assets/js/session-detail.js
# 결과가 0줄이어야 함
```

### 완료 기준
- [ ] `main.js`에 `uiState` 객체 리터럴 없음
- [ ] 이전된 상태 키 4개: `rightView`, `detailTab`, `selectedProject`, `selectedSession`
- [ ] 뷰 전환 동작 유지

---

## T-10a: `state.js` 단위 테스트

**선행 조건**: T-10 완료

### 구현 범위
- `packages/web/assets/js/__tests__/state.test.ts`: **신규**
  - getter 초기값 확인
  - setter 호출 후 getter 반환값 변경 확인
  - 키 미정의 시 기본값 반환 확인

### 커밋 메시지
```
test(web): state.js getter/setter 단위 테스트 추가
```

### 완료 기준
- [ ] 4개 상태 키 모두 테스트 통과

---

## T-11: Phase 2 회귀 검증

**선행 조건**: T-09a, T-10a 완료

### 추가 검증 시나리오
- SSE 연결 중 세션 선택 → detailView + defaultView 양쪽 갱신
- 빠른 세션 전환 (100ms 간격) → 마지막 세션 데이터만 표시
- 페이지 새로고침 후 SSE 자동 연결 확인

### 커밋 메시지
```
test(web): Phase 2 회귀 검증 통과
```

### 완료 기준
- [ ] T-08 6개 시나리오 + 추가 3개 모두 통과
- [ ] `bun test` 전체 통과

---

## Phase 3 — DefaultView 추출

## T-12: `DefaultView` 추출

**선행 조건**: T-11 완료

### 구현 범위
- `packages/web/assets/js/views/default-view.js`: **신규**
  - `fetchRequests(loadMore)` 이동
  - `prependRequest(r)` 이동 (in-place 업데이트 + 스크롤락 로직 포함)
  - `applyFeedSearch()` 이동
  - `reapplyFeedAnomalies()` 이동
  - `initKeyboardShortcuts()` 일부 (피드 관련 단축키)
  - `setChartMode()` 이동 (차트 모드 전환 로직)
- `packages/web/assets/js/main.js`: 위 함수들 → import로 교체

### 커밋 메시지
```
refactor(web): DefaultView 로직을 views/default-view.js로 분리
```

### 완료 기준
- [ ] `main.js` 300줄 이하 (DefaultView 추출 후 목표)
- [ ] 피드 실시간 수신 + in-place 업데이트 동작 확인
- [ ] `feed:updated` 이벤트 발행 위치 단일화 확인

---

## T-13: Phase 3 회귀 검증

**선행 조건**: T-12 완료

### 커밋 메시지
```
test(web): Phase 3 회귀 검증 통과
```

### 완료 기준
- [ ] T-08 6개 시나리오 재확인
- [ ] `bun test` 전체 통과

---

## Phase 4 — DetailView 추출 (최고 위험)

## T-14: `DetailView` 기반 추출 ⚠️ 고위험

**선행 조건**: T-13 완료
**롤백 기준점**: T-13 커밋

### 구현 범위
- `packages/web/assets/js/views/detail-view.js`: **신규**
  ```js
  export function createDetailView() {
    let _abortController = null;
    async function loadSession(id) {
      _abortController?.abort();
      _abortController = new AbortController();
      _expandedTurnIds.clear();
      // 기존 selectSession + loadSessionDetail 통합
    }
    return { loadSession, close, setTab }
  }
  ```
- `packages/web/assets/js/main.js`: `selectSession` → `detailView.loadSession(id)` 호출로 교체
- `packages/web/assets/js/session-detail.js`: `loadSessionDetail` → `detail-view.js`로 이동

### 커밋 메시지
```
refactor(web): DetailView 추출 — selectSession + AbortController 캡슐화
```

### 롤백 방법
```bash
git revert HEAD  # T-13 커밋 기준 복귀
```

### 완료 기준
- [ ] 빠른 세션 연속 클릭 → 마지막 세션 데이터만 표시
- [ ] SSE 스트림 도중 다른 세션 클릭 → 이전 요청 정확히 abort 됨 (품질 검토 반영)
- [ ] 네트워크 오류 후 세션 재클릭 → AbortController 정상 재생성
- [ ] `_expandedTurnIds.clear()` 가 `loadSession()` 내부에서 호출됨
- [ ] `detail-collapsed` 클래스 토글 DetailView 내부화

---

## T-15a: `events.js` 이벤트 상수 SSoT 생성

**선행 조건**: T-14 완료 (품질 엔지니어 검토 반영 — T-15에서 분리)

### 구현 범위
- `packages/web/assets/js/events.js`: **신규**
  ```js
  export const EVENTS = {
    DETAIL_FILTER_CHANGED: 'detail:filterChanged',
    DETAIL_TAB_CHANGED:    'detail:tabChanged',
    FEED_UPDATED:          'feed:updated',
  };
  ```

### 커밋 메시지
```
refactor(web): CustomEvent 이름 상수를 events.js SSoT로 추출
```

### 완료 기준
- [ ] `events.js` 생성, 모든 이벤트 이름 상수화

---

## T-15: `applyDetailFilter` fan-out → `detail:filterChanged` CustomEvent

**선행 조건**: T-15a 완료

### 구현 범위
- `packages/web/assets/js/views/detail-view.js`:
  - `applyDetailFilter()` 직접 렌더 호출 → `CustomEvent('detail:filterChanged')` 발행으로 교체
- `packages/web/assets/js/turn-gantt.js`: 이벤트 구독 추가
- `packages/web/assets/js/session-detail.js`: flat/turn 렌더 구독 추가
- `packages/web/assets/js/tool-stats.js`: tools 탭 구독 추가
- `packages/web/assets/js/context-chart.js`: context chart 구독 추가

### 커밋 메시지
```
refactor(web): applyDetailFilter fan-out을 detail:filterChanged CustomEvent로 분해
```

### 완료 기준
- [ ] `applyDetailFilter` 내부에 직접 렌더 호출 없음
- [ ] 필터 변경 시 flat/turn/gantt/tools 탭 모두 갱신
- [ ] `setDetailView('gantt')` 탭 전환 시 이중 렌더 없음
- [ ] 이벤트 이름은 `events.js` 상수에서만 참조

---

## T-15b: CustomEvent 발행-구독 단위 테스트

**선행 조건**: T-15 완료

### 구현 범위
- `packages/web/assets/js/__tests__/events.test.ts`: **신규**
  - `detail:filterChanged` 발행 → 각 구독자 콜백 호출 확인
  - 이중 발행 시 중복 렌더 없음 확인
  - 리스너 removeEventListener 누락 경고 검증

### 커밋 메시지
```
test(web): CustomEvent 발행-구독 단위 테스트 추가
```

### 완료 기준
- [ ] 발행-구독 경로 테스트 통과
- [ ] 이중 발행 방지 확인

---

## Phase 5 — 정리

## T-16: `renderers.js` 정리 (DOM 삽입 제거) ⚠️ 고위험

**선행 조건**: T-15b 완료
**롤백 기준점**: T-15b 커밋

### 구현 범위
- `packages/web/assets/js/renderers.js`: `renderRequests()`, `appendRequests()` 삭제
  - 호출부는 T-12(DefaultView), T-14(DetailView)에서 이미 이전 완료
  - `api.js` ↔ `renderers.js` 커플링 완전 해소
- `packages/web/assets/js/api.js`: `renderRequests`/`appendRequests` import 제거

### 커밋 메시지
```
refactor(web): renderers.js DOM 삽입 제거 — HTML 생성 전용 모듈로 정리
```

### 롤백 방법
```bash
git revert HEAD
```

### 완료 기준
- [ ] `renderers.js`에 `document.getElementById` 호출 없음
- [ ] `api.js`에 `renderRequests` import 없음
- [ ] 골든 스냅샷 테스트(T-02) 전체 통과
- [ ] 피드 요청 목록 정상 렌더링 확인

---

## T-17: `index.html` 다이어트

**선행 조건**: T-16 완료

### 구현 범위
- 필터 버튼 중복 블록 제거 (T-05에서 자리표시자로 교체됨)
- 검색 박스 중복 블록 제거 (T-06에서 교체됨)
- 인라인 스크립트(`<script>` 태그) 0개 유지
- 레이아웃 골격 + script 로드만 유지

### 커밋 메시지
```
refactor(web): index.html 다이어트 — 레이아웃 골격만 유지
```

### 검증 명령어
```bash
wc -l packages/web/index.html
grep -c "<script>" packages/web/index.html  # 최소화 확인
```

### 완료 기준
- [ ] `index.html` 200줄 이하 (품질 검토 반영 — 정량 기준 명시)
- [ ] 인라인 `<script>` 블록 0개
- [ ] 페이지 로드 후 모든 뷰 정상 렌더

---

## T-18: 전체 회귀 검증

**선행 조건**: T-17 완료

### 검증 목록
- [ ] `bun test` 전체 통과
- [ ] T-08의 6개 핵심 시나리오 재확인
- [ ] `main.js` 300줄 이하 (품질 검토 반영 — 현실적 목표 조정)
- [ ] `index.html` 200줄 이하
- [ ] 순환 의존 없음: `main.js → components → state.js` 단방향
- [ ] `activeTypeFilterButtons()`, `activeSearchInput()` 함수 삭제 확인
- [ ] `SUB_TYPES` 인라인 배열 `request-types.js` 외 없음

### 커밋 메시지
```
test(web): 전체 회귀 검증 완료
```

---

## T-19: 문서 정리

**선행 조건**: T-18 완료 (품질 검토 반영 — T-18에서 분리)

### 구현 범위
- `adr.md`: 각 ADR 상태 "완료" 갱신
- `tasks.md`: 전체 체크리스트 완료 표시

### 커밋 메시지
```
docs(web): 컴포넌트 리팩터링 완료 — ADR/tasks 문서 갱신
```

### 완료 기준
- [ ] adr.md 모든 ADR 상태 "결정됨 → 구현 완료" 반영
