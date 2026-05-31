# TDD 패널: 기존 web 테스트의 React+Zustand 1:1 계승 절차

> 역할: TDD 방법론 전문가 (Kent Beck 증강 코딩 — 테스트 우선·Tidy First·작은 단계)
> 대상: `claude-spyglass` `packages/web` (Vanilla → React 18 + Vite + TS strict, 대안 C 풀 마이그레이션)
> 근거 기준점: claude-spyglass HEAD `9b939d5`, 작업지시서 교정판 v2(`react-migration-master-prompt.md`)
> 방법론 출처: `${CLAUDE_PROJECT_DIR}/.claude/skills/kent-beck-methodology/kent-beck-methodology.md`
>
> 이 문서는 "어떤 테스트를 어떻게 계승/전환하고, 각 페이즈 task에 Red→Green→Refactor 사이클을 어떻게 박을지"의 절차서다.
> 모든 수치·동작 주장은 파일:라인 근거를 붙였고, 소스 로직 자체는 복붙하지 않고 경로만 참조한다.

---

## 0. 안전망 실측 인벤토리 (전환 대상 12개 테스트)

`bun test` 단일 러너(`package.json` `"test": "bun test"`)가 회귀 보루다. Playwright E2E 없음.
web 테스트는 11개(`packages/web/assets/js/__tests__/`) + 1개(`packages/web/parseToolDetail.test.ts`) = **12 파일**.
전체 모노레포 테스트 파일은 103개(`find packages -name "*.test.ts" | wc -l` = 103).

| # | 테스트 파일 | it/test 케이스 | 대상 소스(파일:라인) | 성격 | React+Zustand 계승 분류 |
|---|------------|:---:|----------------------|------|------------------------|
| 1 | `__tests__/state.test.ts` | 14 | `state.js` (전체 82줄) | 모듈 변수 SSoT getter/setter | **Zustand 스토어 테스트로 재작성** (A형) |
| 2 | `__tests__/sse.test.ts` | 8 | `sse.js:29` `connectSSE` | EventSource 재연결·콜백 | **`useSSE` 훅 테스트로 재작성** (B형) |
| 3 | `__tests__/left-panel.test.ts` | 2 | `left-panel.js` top-level | 비-DOM import 안전성(T08 버그 A) | **컴포넌트 마운트 가드로 대체** (C형) |
| 4 | `__tests__/renderers.test.ts` | 20(전부 `toMatchSnapshot`) | `render/rows.js:52,107` · `render/cells.js:74` | HTML 출력 골든마스터 | **출력 회귀 골든마스터로 그대로 활용** (D형) |
| 5 | `__tests__/api.test.ts` | 10 | `api.js` `setActiveRange`/`getDateRange`/`buildQuery` | 순수 쿼리 빌더 | **순수 함수 그대로 계승** (E형) |
| 6 | `__tests__/formatters.test.ts` | 53 | `formatters.js` | 순수 포맷터 | 순수 함수 그대로 계승 (E형) |
| 7 | `__tests__/get-date-range.test.ts` | 20 | date-range 계산 | 순수 함수 | 순수 함수 그대로 계승 (E형) |
| 8 | `__tests__/date-range-storage.test.ts` | 12 | `util/date-range-storage.js` `save/loadDateRange` | localStorage 영속화(ADR-004) | **Zustand persist 미들웨어 테스트로 흡수** (A형) |
| 9 | `__tests__/context-window.test.ts` | 6 | `context-window.js` `formatContextWindowLabel` | 순수 유틸 + 상수 | 순수 함수 그대로 계승 (E형) |
| 10 | `__tests__/anomaly.test.ts` | 14 | `anomaly.js` `getAnomalyFlagsForRow` | 순수 매핑 헬퍼(ADR-003) | 순수 함수 그대로 계승 (E형) |
| 11 | `__tests__/events.test.ts` | 6 | `events.js` 상수 + CustomEvent pub-sub | DOM 이벤트 버스 | **스토어 구독/액션으로 흡수** (A형) |
| 12 | `parseToolDetail.test.ts` | 10 | (테스트 내 인라인 함수, `index.html` 추출본) | 순수 파서 | **소스 추출 후 순수 함수 계승** (E형, 선행 Tidy 필요) |

합계 케이스: 14+8+2+20+10+53+20+12+6+14+6+10 = **175 it/test 케이스**.

계승 분류 5형(이 문서 전체의 기준 용어):
- **A형(스토어)**: 모듈 변수/이벤트버스/localStorage → Zustand 스토어 액션·셀렉터·persist. (state·events·date-range-storage)
- **B형(훅)**: 부수효과 모듈 → React custom hook + `@testing-library/react` `renderHook`. (sse)
- **C형(마운트 가드)**: 비-DOM import 안전성 → 컴포넌트 마운트/언마운트 회귀로 의미 보존. (left-panel)
- **D형(골든마스터)**: HTML 출력 스냅샷 → React 렌더 출력 동일성 회귀. (renderers)
- **E형(순수 계승)**: 부수효과 없는 순수 함수 → `.ts`로 옮기고 테스트 거의 그대로. (formatters·get-date-range·api·context-window·anomaly·parseToolDetail)

E형 6개(95 케이스)는 React와 무관한 순수 로직이므로 **페이즈 1 인프라 정비 직후 일괄 이식**한다. 가장 안전하고, Vite+Vitest 러너가 정상 작동하는지 검증하는 첫 게이트로 쓴다.

---

## 1. 러너 전환: bun test → Vitest (Tidy First, 구조 변경 단독 커밋)

대안 C는 Vite 빌드를 도입하므로 테스트 러너도 Vite 생태계인 **Vitest**로 통일한다(별도 bun test 잔존 시 두 러너가 갈라져 회귀 보루가 분열됨).

전환은 Kent Beck "구조적 변경과 행동적 변경의 원자적 분리"(방법론 Part 3 원칙 1)를 따른다.

**Tidy 커밋 (행동 무변경):**
1. `bun:test` import를 Vitest 호환 시그니처로 치환. `describe/it/expect/beforeEach/beforeAll/afterAll`은 동일 API라 import 출처만 교체. `mock`/`jest.useFakeTimers`(sse.test.ts:1,45)는 `vi.fn()`·`vi.useFakeTimers()`로 1:1 매핑.
2. 스냅샷 포맷: Bun snapshot(`renderers.test.ts.snap` 헤더 `// Bun Snapshot v1`)은 Vitest inline/file 스냅샷과 직렬화 규칙이 다르다 → **러너 전환 시 스냅샷은 "동결(freeze) 후 재생성"이 아니라 "동일 입력으로 한 번 재생성하고 diff 0 확인"** (§4 상세).
3. `package.json` `"test"` 스크립트를 `vitest run`으로 교체, `vitest.config.ts` 추가(jsdom 환경).

각 단계는 테스트 전량 통과를 게이트로 두고 별도 커밋. 이 단계에서는 React 코드를 한 줄도 작성하지 않는다(작업지시서 절대 제약).

> 게이트: 러너만 바꾼 시점에 175 케이스 전부 통과 + 스냅샷 diff 0. 통과 안 하면 즉시 revert (방법론 Part 2 원칙 1 "테스트 실패 = 즉각 롤백").

---

## 2. state.test.ts → Zustand 스토어 테스트 1:1 계승 절차 (A형)

### 2-1. 원본 계약 분석

`state.js`는 모듈 수준 `let` 변수 + getter/setter 쌍이 SSoT다(`state.js:14-26` 변수 선언, `:39-82` accessor). 영속화는 `sessionStorage`(`state.js:11-12,30-35,44,57`). `state.test.ts`가 검증하는 계약:
- 초기값: `rightView='default'`, `detailTab='requests'`, `selectedProject=null`, `selectedSession=null` (`state.test.ts:18,37,52,69`).
  - ⚠️ **불일치 발견**: 소스 현재 기본값은 `_detailTab='log'`(`state.js:23`)·`_rightView='default'`(`state.js:25`)인데, 테스트는 `beforeEach`에서 `setDetailTab('requests')`로 강제 초기화 후 검증(`state.test.ts:10-15`). 즉 테스트는 "초기값"이 아니라 "setter로 세팅한 값"을 본다. → Zustand 이식 시 **스토어의 진짜 초기값은 소스(`state.js:14-26`)를 SSoT로 삼고**, 테스트의 `beforeEach` 초기화 패턴(스토어 리셋)을 그대로 계승한다.
- setter→getter 왕복 (`state.test.ts:22-31,39-47` 등).
- **상태 독립성**: 한 상태 변경이 다른 상태에 영향 없음 (`state.test.ts:84-95`).

### 2-2. Red→Green→Refactor 사이클 (페이즈 1에 박는다)

```
[Red]   test: rightView 셀렉터 초기값/setRightView 액션 (스토어 미구현 → import 실패로 RED)
[Green] feat: zustand create()로 routing slice + setRightView 액션 최소 구현
[Refactor] tidy: detailTab/selectedProject/selectedSession 슬라이스로 동일 패턴 추출
[Red]   test: 상태 독립성 — selectedProject 변경 시 selectedSession 유지
[Green] feat: 슬라이스 분리로 독립성 보장 (이미 통과하면 Fake It 확인 후 다음)
```

계승 매핑(테스트 본문은 의미 보존, 호출부만 교체):
- `getRightView()/setRightView(v)` → `useStore.getState().rightView` / `useStore.getState().setRightView(v)`.
- `beforeEach` 초기화(`state.test.ts:10-15`) → `useStore.setState(initialState, true)` (replace=true로 완전 리셋). 모듈 변수 공유 문제(`state.test.ts:9` 주석)는 Zustand에서 store 인스턴스 리셋으로 동일하게 해결.
- 14개 케이스 전부 액션/셀렉터 호출로 1:1 치환 — **케이스 추가/삭제 금지**(같은 계약을 같은 수로 보존해야 회귀 비교가 성립).

### 2-3. events.test.ts·date-range-storage.test.ts 흡수

- **events.test.ts(6)**: `events.js`는 CustomEvent 기반 pub-sub(`events.test.ts:21-59`). React에서는 스토어 구독(`subscribe`)·액션으로 대체. 계약 보존: "발행 시 구독자 1회 호출"(`events.test.ts:22`) → "액션 디스패치 시 구독 콜백 1회 호출", "removeEventListener 후 미호출"(`events.test.ts:53`) → "unsubscribe 후 미호출". 상수 검증(`events.test.ts:13-18` `DETAIL_FILTER_CHANGED='detail:filterChanged'`)은 더 이상 의미 없으면 삭제하되 **삭제 사유를 커밋 메시지에 명시**(방법론 Part 3 원칙 2 "dead test 즉시 삭제").
- **date-range-storage.test.ts(12)**: `save/loadDateRange`(`date-range-storage.test.ts:11`)의 localStorage 스키마(`cs.dateRange`, `v:1`, preset만 영속·custom 휘발 — ADR-004) 계약을 **Zustand `persist` 미들웨어 partialize/migrate 테스트로 흡수**. 핵심 회귀 케이스 보존: v:2 미지원 버전→null(`:58`), JSON 파싱 실패→null(`:63`), type=custom 저장값 무시(`:68`). `MemStorage` 목(`:14-22`)은 persist의 `storage` 옵션 주입으로 동일 재현.

---

## 3. sse.test.ts → useSSE 훅 테스트 계승 절차 (B형)

### 3-1. 원본 계약 분석

`sse.js:29` `connectSSE(callbacks)`의 검증 계약(`sse.test.ts`):
- `/events` URL로 EventSource 생성 (`sse.test.ts:59`, 소스 `sse.js:37`).
- `onopen`→`onOpen` 1회 (`:64`, 소스 `sse.js:51-54`).
- `new_request`→`onNewRequest`에 **원본 MessageEvent 전달** (`:69-75`, 소스 `sse.js:39`).
- `onerror`→`onError` + source close (`:77-81`, 소스 `sse.js:56-59`).
- **5초 후 자동 재연결** (`:83-90`, 소스 `sse.js:15-17,59` `setTimeout(...,5000)`).
- 재호출 시 기존 source close + 이전 재연결 타이머 취소 (`:100-115`, 소스 `sse.js:33-34`).

### 3-2. Red→Green→Refactor 사이클 (페이즈 4에 박는다)

작업지시서 페이즈 4에서 `useSSE` 훅으로 이행(`main.js` 폐기·React Router 바인딩). TDD 순서:

```
[Red]   test: useSSE 마운트 시 EventSource('/events') 생성 (renderHook → 훅 미구현 RED)
[Green] feat: useSSE에서 useEffect로 connectSSE 코어 호출 (sse.js 로직 재사용 가능하면 래핑)
[Red]   test: 언마운트 시 source.close + 재연결 타이머 clearTimeout (현 sse.js는 명시적 close API 없음 → 신규 계약)
[Green] feat: useEffect cleanup에서 close+clearTimeout 보장
[Red]   test: onerror 후 5초 경과 → 재연결 (fake timer)
[Green] feat: 재연결 타이머 useRef로 보존
[Refactor] tidy: 콜백 주입을 스토어 액션 바인딩으로 정리
```

계승 매핑:
- `MockEventSource`(`sse.test.ts:7-32`)·`globalThis.EventSource` 주입(`:35`)은 jsdom 환경에서 그대로 재사용. `_last` 정적 추적(`:9,17`)으로 "새 인스턴스 생성" 검증 유지.
- `jest.useFakeTimers()`/`advanceTimersByTime(5000)`(`:45,86`) → `vi.useFakeTimers()`/`vi.advanceTimersByTime(5000)`.
- 콜백 주입 테스트(`connectSSE({onNewRequest,...})`, `:50`)는 `renderHook(() => useSSE({onNewRequest,...}))`로 치환.
- **신규 계약 추가(언마운트 cleanup)**: 현 `connectSSE`는 외부에서 닫는 명시 API가 없다(재호출로만 닫힘, `sse.js:33`). 훅은 언마운트 시 누수 방지 cleanup이 필수 → 이 케이스는 "버그를 테스트로 고착화"(방법론 Part 1 원칙 4)에 준해 **신규 Red 테스트 1개 추가**하고 Gap Report에 "원본에 없던 계약" 명시.

---

## 4. renderers.test.ts.snap → 출력 동일성 골든마스터 활용법 (D형, 회귀 핵심)

### 4-1. 골든마스터의 결정론 조건 (반드시 보존)

`renderers.test.ts`는 20개 케이스 전부 `toMatchSnapshot()`(`grep -c` = 20)이고 `.snap` 엔트리도 20개로 1:1. 출력 결정론은 **두 가지 모킹**에 의존:
- `window.I18n.t`를 고정 매핑으로 스텁 (`renderers.test.ts:12-37`) — i18n 키→한국어 문자열 고정.
- `Date.now`를 `2026-05-04T10:00:00Z`로 고정 (`:8,37`), fixture timestamp(`2026-04-28T10:00:00Z`)와 **정확히 6일 차** → `fmtRelative`의 "6일 전" 안정화(`.snap:5` `"... · 6일 전"`).

이 두 조건이 깨지면 스냅샷이 비결정적으로 흔들린다. React 전환 후에도 **동일 I18n 스텁·동일 Date.now 고정을 유지**해야 "동일 입력→동일 출력" 비교가 성립한다.

### 4-2. "동일 입력 → 동일 출력" 회귀 절차 (Strangler Fig)

대상 함수 출처(`grep` 확인): `makeRequestRow`(`render/rows.js:52`), `makeSessionRow`(`render/rows.js:107`), `makeTargetCell`(`render/cells.js:74`) — `renderers.js`(`renderers.js:10-16` 배럴)로 재노출.

골든마스터는 **HTML 문자열**(`.snap:4-15` `<tr>...</tr>`)을 고정한다. React 컴포넌트는 JSX를 렌더하므로 출력 비교 절차:

```
1. [동결] React 전환 전, 현재 .snap을 변경 금지 파일로 동결(git에 이미 추적됨).
2. [전환] make*Row 함수 → <RequestRow/> <SessionRow/> <TargetCell/> 컴포넌트로 변환.
3. [비교 어댑터] 컴포넌트를 renderToStaticMarkup(또는 @testing-library container.innerHTML)으로
   HTML 문자열화 → 기존 .snap과 toMatchSnapshot 비교.
4. [diff 0 게이트] 공백·속성 순서까지 동일해야 통과. 차이 발생 시 의도 여부 판정:
   - 비의도 차이(회귀) → 즉시 수정, 스냅샷 갱신 금지.
   - 의도 차이(예: data-* 속성 추가) → 스냅샷 갱신 + 커밋 메시지에 갱신 사유 명시(작업지시서 2-1).
```

> ⚠️ JSX는 `class`→`className`, 속성 따옴표/공백·자기닫힘 태그(`<circle .../>` `.snap:7`) 직렬화가 Vanilla 문자열과 미세하게 다를 수 있다. 따라서 **1차 비교는 "정규화(normalize) 후 비교"**를 권장: 양쪽 HTML을 동일 파서로 파싱→정규화 직렬화 후 비교하는 헬퍼를 두면, 의미 없는 공백 차이로 인한 위양성 회귀를 차단하면서 구조·텍스트·data 속성(`data-request-id`, `data-session-id` 등 — 작업지시서 2-1 셀렉터 계약) 동일성은 엄격히 검증한다. 단, **data-* / id / class 토큰 집합은 정규화 대상에서 제외**(이들은 셀렉터 계약이므로 1:1 보존 검증).

### 4-3. 골든마스터를 bisect 회귀 추적의 기준점으로

골든마스터 diff가 깨진 커밋을 `git bisect`로 추적(사용자 안정성 제약). 각 컴포넌트 전환을 **작은 단일 커밋**으로 쪼개면(예: "feat: RequestRow prompt 케이스만 전환"), bisect가 회귀 도입 커밋을 정확히 한 변환 단위로 좁힌다. 큰 일괄 전환 커밋은 bisect 해상도를 떨어뜨리므로 금지.

---

## 5. left-panel.test.ts → 컴포넌트 마운트 가드 (C형)

원본 2케이스(`left-panel.test.ts`)는 "비-DOM 환경에서 모듈 import가 throw하지 않는다"(T08 버그 A, `:12-20`)와 "document 존재 시 `session-anomalies-loaded` 리스너 등록"(`:22-36`)을 검증한다. 이는 top-level `document.addEventListener`(`:4-5` 주석)의 부수효과 가드다.

React 전환 후 이 부수효과는 컴포넌트 `useEffect`로 이동하므로 계약을 **마운트/언마운트 회귀로 재정의**:
```
[Red]   test: <LeftPanel/> 마운트 시 session-anomalies-loaded 구독 등록 (testing-library)
[Green] feat: useEffect(() => { window.addEventListener(...); return () => removeEventListener }, [])
[Red]   test: 언마운트 시 리스너 해제 (누수 가드 — 원본엔 없던 신규 계약, Gap Report 기록)
[Green] feat: cleanup 반환
```
원본의 "import가 throw 안 함"(`:13`)은 React 모듈 평가가 jsdom 환경에서 부수효과를 top-level에 두지 않으면 자동 충족 → **이 케이스는 "컴포넌트는 마운트 전 부수효과 0" 테스트로 의미 승계**, 원본 케이스는 사유 명시 후 삭제.

---

## 6. parseToolDetail.test.ts → 선행 Tidy 후 순수 계승 (E형, 특수)

이 테스트(10케이스)는 검증 대상 함수가 **테스트 파일 안에 인라인 복제**돼 있다(`parseToolDetail.test.ts:9-24`). 주석상 `index.html`에서 추출한 것(`:3`)이라 SSoT가 분리돼 있다.

Tidy First 절차(행동 무변경 선행 커밋):
```
[Tidy]  refactor: parseToolDetail를 src/lib/parse-tool-detail.ts로 추출, index.html/테스트가 동일 모듈 import
[Test]  기존 10케이스가 추출 모듈을 import하도록만 교체 → 동작 동일, 전량 통과
[Build] 이후 React 컴포넌트가 이 순수 모듈을 소비
```
순수 함수라 React와 무관 — 추출 후 테스트는 거의 무변경. 단 "인라인 복제 제거"는 dead/중복 코드 삭제(방법론 Part 3 원칙 2)이므로 단독 커밋.

---

## 7. 페이즈별 Red→Green→Refactor task 삽입 매트릭스

작업지시서 5개 페이즈(`react-migration-master-prompt.md:55-77`)에 TDD 사이클을 박는 위치:

| 페이즈 | 작업지시서 골자 | 선행 Red 테스트(이 페이즈에서 먼저 실패시킬 것) | Green/Refactor | 게이트 |
|--------|----------------|-----------------------------------------------|----------------|--------|
| **0 (선행, §1·§6)** | 러너/인프라 Tidy | (없음 — 기존 175 케이스가 그대로 Red 방지선) | Vitest 전환, parseToolDetail 추출 | 175 케이스 통과 + 스냅샷 diff 0 |
| **1 (스토어)** | Zustand 스토어(§2) | state(14)·events(6)·date-range-storage(12) 계약 테스트 RED | 스토어 슬라이스·persist 구현 | A형 32 케이스 + E형 95 케이스 통과 |
| **2 (원자 컴포넌트)** | design-system 30개·settings 분해 | 각 원자 컴포넌트 렌더 스냅샷 RED(신규) | 컴포넌트 구현, settings 폼 핸들링 테스트 신규 | 신규 컴포넌트 테스트 통과, 기존 회귀 0 |
| **3 (중위험+API역전)** | chart·left-panel·api.js 역전 | left-panel 마운트 가드(§5) RED, **renderers 골든마스터(§4) diff 게이트** | 컴포넌트화·API raw 반환화 | renderers 20 골든마스터 diff 0 |
| **4 (모놀리식+라우팅)** | meta-docs·main.js·useSSE | sse→useSSE(§3) RED, useSSE cleanup RED(신규) | useSSE 훅·React Router | sse 8 케이스 + cleanup 신규 통과 |
| **5 (strict+최적화)** | .tsx 전환·strict:true | (회귀 테스트는 게이트로만) | memo/useMemo, 가상스크롤 | 전 페이즈 테스트 통과 + typecheck 0 |

원칙(방법론 Part 2 원칙 3 "LLM 작업은 명시적 분해"): 각 셀의 작업을 다시 컴포넌트/슬라이스 단위 **Step**으로 쪼개고, Step마다 "실패 테스트 1개 → 최소 구현 → 통과 → 별도 커밋"을 강제한다.

---

## 8. git worktree + bisect + 회귀 0 운영 규칙 (사용자 안정성 제약 반영)

- **격리**: 각 페이즈/트랙은 별도 worktree에서 작업(작업지시서 병렬 서브에이전트와 정합). 트랙 간 테스트 보루는 동일(같은 175+신규 케이스)이라 머지 전 각 worktree에서 전량 통과가 머지 게이트.
- **작은 커밋**: 구조 변경(Tidy)과 행동 변경(feat)을 **절대 같은 커밋에 섞지 않음**(방법론 3대 금지 1). 커밋 메시지 prefix로 `test:`/`feat:`/`refactor:` 구분 → bisect 시 회귀 유형 즉시 식별.
- **bisect 회귀 추적**: 골든마스터(§4) 또는 계약 테스트가 깨진 시점 발견 시 `git bisect run <테스트 명령>`으로 도입 커밋 자동 탐색. 커밋이 작을수록 bisect가 단일 변환 단위로 수렴(§4-3).
- **회귀 0 정의**: "175개 기존 케이스 중 의도적 삭제(사유 명시 커밋)를 제외한 전부 통과 + renderers 20 골든마스터 diff 0 + 신규 컴포넌트/훅 테스트 통과 + web typecheck 0(R5 baseline 유지)". 하나라도 깨지면 머지 금지·즉시 revert(방법론 Part 2 원칙 1).
- **신규 계약 추적**: 원본에 없던 계약(useSSE/LeftPanel 언마운트 cleanup 등)은 Gap Report(`.migration-gap-report.md`, 작업지시서 3절)에 "원본 미보장 → React 도입 필요"로 기록해 휴먼 검증 포인트로 남긴다.

---

## 9. 핵심 근거 파일 색인 (file:line)

- 테스트 12파일: `packages/web/assets/js/__tests__/*.test.ts` (11) + `packages/web/parseToolDetail.test.ts` (1)
- 골든마스터: `packages/web/assets/js/__tests__/__snapshots__/renderers.test.ts.snap` (20 엔트리, `// Bun Snapshot v1` 헤더)
- 스토어 SSoT: `state.js:14-26`(변수), `:30-35`(sessionStorage 복원), `:39-82`(accessor)
- SSE 코어: `sse.js:15-17`(재연결 타이머), `:29-64`(connectSSE), `:33-34`(재호출 close+clear), `:37`(/events), `:51-59`(onopen/onerror)
- 렌더 함수: `render/rows.js:52`(makeRequestRow)·`:107`(makeSessionRow), `render/cells.js:74`(makeTargetCell), `renderers.js:10-16`(배럴)
- 러너/타입 설정: `package.json` `"test":"bun test"`/`"typecheck":"tsc --noEmit"`, `packages/web/tsconfig.json`(`strict:false`+`checkJs:true`)
- 기준 커밋: claude-spyglass HEAD `9b939d5`
