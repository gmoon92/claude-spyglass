# 의존성/추출 안전성 판정 (dependency-safety)

**역할**: dependency-safety 패널 — React 컴포넌트화 시 "어떤 순서로 추출해야 회귀 0으로 안전한지" 판정
**대상**: `claude-spyglass` `packages/web/assets/js/` (105 .js, 루트 44)
**검증 HEAD**: `2126e11` (read-only 분석, 코드 미수정)
**원칙**: 모든 결론에 `파일:라인` 근거. 추측 금지. 디렉토리 grep 착시 배제 — 실제 모듈(파일) 그래프 확인.

---

## 0. 한 줄 결론 (먼저)

> **state.js(0 import) → leaf util(formatters/dom/events) → sse.js(0 import, callback 주입) → design-system 30 leaf → render/* 직접경로 교정 → settings-view(폼 분해) → left-panel/session-detail/chart → api.js 데이터역전 → meta-docs-view 분해 → main.js 라우터** 순으로 bottom-up 추출하면 매 단계가 DAG를 유지한다. 회귀 위험 최대 결합점은 단 2개 — **(1) api.js가 fetch 직후 호출하는 9개 render 사이드이펙트, (2) main.js가 31개 모듈을 묶는 진입 허브** — 이며, 둘 다 worktree 격리 + 스냅샷 골든마스터(`renderers.test.ts.snap`)로 끊을 수 있다.

---

## 1. 의존성 그래프 (실측, 파일:라인)

### 1.1 허브 3종의 import 방향 (무엇을 import 하는가)

| 허브 | import 수 | 분류 | 근거 |
|------|----------|------|------|
| `main.js` | **31** | 외부 0 / 내부 31 (전부 같은 패키지) | `main.js:2-59`, 멀티라인 specifier `main.js:7,14,26,30,55` |
| `api.js` | **10** | 내부 10 | `api.js:56-71` |
| `meta-docs-view.js` | **16** | 내부 16 | `meta-docs-view.js:23-43` |

main.js import 전수(파일:라인): chart.js`:2`, infra.js`:3`, left-panel.js`:7`, state.js`:14`, app-rail.js`:15`, meta-docs-view.js`:19`, settings-view.js`:20`, session-detail.js`:26`, api.js`:30`, formatters.js`:31`, components/date-range-dropdown.js`:32`, util/date-range-storage.js`:33`, renderers.js`:34`, llm-input-view.js`:35`, col-resize.js`:36`, panel-resize.js`:37`, left-panel-vertical-resize.js`:38`, context-chart.js`:39`, components/filter-bar.js`:40`, tool-colors.js`:41`, session-detail/system-reminder-popover.js`:44`, cache-tooltip.js`:45`, stat-tooltip.js`:46`, cache-panel-tooltip.js`:47`, obs-tooltip.js`:48`, sse.js`:49`, views/default-view.js`:55`, views/detail-view.js`:56`, obs-panel.js`:57`, version-check.js`:58`, dom.js`:59`.

### 1.2 누가 허브를 import 하는가 (소비처 전수)

**main.js 소비처**: **0건**. `grep "from './main.js'"` → NONE. main.js는 진입점(DAG의 sink). 폐기 시 역참조 깨짐 위험 없음 — 안전.

**api.js 소비처 (8건, 단 코드 import는 6 + 테스트 2)**:
- `meta-docs-flow.js:36` `getDateRange`
- `tool-stats.js:28` `getDateRange`
- `main.js:30` (다수)
- `meta-docs-view.js:26` `getDateRange`
- `util/date-range-storage.js:15` `setActiveRange`
- `components/date-range-dropdown.js:17` `setActiveRange, getActiveRange`
- (테스트) `__tests__/get-date-range.test.ts:15`, `__tests__/api.test.ts:2`

**핵심**: main.js를 제외한 5개 소비처가 import 하는 것은 전부 **순수 데이터/range 유틸**(`getDateRange:213`, `setActiveRange:133`, `getActiveRange:144`, `buildQuery:230`)뿐이다. render 사이드이펙트를 품은 fetcher(`fetchDashboard:240`, `fetchRequests:304`, `fetchSessionsByProject:364`)는 **main.js 외 아무도 import하지 않는다**. → api.js는 사실상 "순수 range 유틸 + main 전용 fetcher" 두 덩어리. 이 절단선이 데이터역전의 핵심.

**state.js 소비처 (코드 16건, file:line)**: app-rail.js`:22`, left-panel.js`:7`, main.js`:14`, tool-stats.js`:29`, llm-input-view.js`:35`, meta-docs-view.js`:27`, session-detail/index.js`:27,33`, views/default/keyboard.js`:8`, session-detail/turn-views.js`:48,57,62`, session-detail/flat-view.js`:39`, views/default/feed-interactions.js`:12`, views/_shared/view-toggle.js`:6`, views/detail-view.js`:9`. **import은 0건**(`state.js` 내 import 0; export는 getter/setter 함수, `state.js:39-82`).

---

## 2. 역참조 분류 (4종 판정)

대상이 형제/코어를 역참조하는 패턴을 4종으로 분류한다(참조: stabilization-cycle reference-classification).

### 2.1 배럴 노이즈 — `renderers.js`
- `renderers.js`(16줄)는 **re-export 한 줄 shim**. 671줄 단일 파일을 `render/{badges,model,cells,extract,expand,rows,skeleton}.js` 6파일로 분해 후 구 import 경로 호환용. 근거: `renderers.js:1-16` (`export * from './render/*.js'` 7줄).
- main.js`:34`, api.js`:64`, left-panel.js`:6`, views/default/feed-live.js`:7`, detail-view.js`:15-16` 등이 무거운 배럴(`renderers.js`) 또는 leaf(`render/*`) 경유로 혼재.
- **처리**: React 이식 시 심볼 정의처(`render/*`)로 **경로 교정**하면 배럴 의존 소멸. `renderers.test.ts.snap`이 `makeRequestRow/makeTargetCell/makeSessionRow` 출력을 고정하므로 경로만 바꿔도 출력 동일성 검증 가능(`renderers.test.ts:2,88-149`).
- **동반 처리**: 없음(경로 교정뿐, 이동 불필요).

### 2.2 순수 leaf util — `state.js`, `sse.js`, `formatters.js`, `dom.js`, `events.js`, `design-system/*`
- `state.js`: import 0(`state.js` 내부 import 없음), export는 순수 getter/setter. 소비처 16곳이 함께 의존하나 **그 자신은 아무것도 역참조 안 함**. → 표준런타임만 쓰는 순수 leaf.
- `sse.js`: import 0(`sse.js` 내 import NONE). `connectSSE(callbacks)`로 **콜백 주입**(`sse.js:29`), `new EventSource('/events')`(`sse.js:37`) + `addEventListener`(`:39,43,48`). 소비처는 main.js`:49`와 테스트뿐. → 완벽한 leaf, useSSE 훅 후보.
- `design-system/` **30 .js** 전부 leaf: design-system/formatters/dom/i18n/render-icons 외 import **0건**(`grep ... | grep -v ... → 빈 결과`).
- **처리**: 공유 위치(React 컴포넌트/훅/스토어)로 **선이동**. 가장 먼저 추출.

### 2.3 공유 도메인 코어 — `left-panel.js`, `chart.js`
- `left-panel.js`(195줄): import = formatters`:5` + renderers`:6` + state`:7` 3개뿐(상위 api/main 역참조 **없음**). 소비처는 main.js`:7`, api.js`:59`, meta-docs-view.js`:38`, detail-view.js`:3`로 **여럿이 함께 소비**. → 공유 코어. api.js가 render 함수(`renderProjects`, `renderBrowserSessions`)를 직접 호출하는 사이드이펙트 표적.
- `chart.js`(462줄): import 2(i18n-utils, model classifier — 분석 doc 일치). 소비처 main.js`:2`, api.js`:57`. canvas 내부 렌더 독립.
- **처리**: bottom-up — 코어(left-panel/chart)를 props/store 구독형으로 먼저 안정화한 뒤, api.js 역전 진행. 코어 먼저.

### 2.4 진짜 순환 — **0건**
- 모듈 레벨 양방향 결합 없음. 아래 §3에서 착시 검증.

---

## 3. 순환 착시 검증 (디렉토리 vs 실제 파일 쌍)

분석 doc 부록B는 "순환 0"이라 주장 — 실제 파일 쌍으로 재확인했다.

| 의심 결합 | 실제 방향 | 판정 | 근거 |
|----------|----------|------|------|
| api.js ↔ left-panel.js | api.js → left-panel.js (단방향) | DAG | left-panel.js import = formatters/renderers/state뿐, api.js 미import (`left-panel.js:5-7`) |
| api.js ↔ meta-docs(view/flow/tool-stats) | meta-docs* → api.js (단방향, getDateRange만) | DAG | api.js 내 meta-docs/tool-stats import NONE (`grep → NONE`) |
| views/detail-view ↔ default-view | detail-view → default-view (단방향) | DAG | `detail-view.js:14`가 default-view import; default-view.js는 `default/*` re-export(`default-view.js:5-12`)로 detail-view 역참조 없음 |
| session-detail/ ↔ 상위 | session-detail → state/dom만 | DAG | session-detail/는 api/left-panel/main **미import** (`grep → NONE`) |

**결론**: ESM 모듈 단위 초기화 기준 전부 DAG. 디렉토리 양방향처럼 보이는 `views/`도 서로 다른 파일이라 착시. 순환 끊기 작업 **불필요**.

---

## 4. 안전한 추출 순서 (state.js부터)

의존성 역순(leaf → 허브). 각 단계 종료 시 `bun test` 전량 통과를 게이트로 둔다.

```
S0  인프라    : Vite/TS/JSX 설정 + bunfig (코드 추출 0, 빌드 파이프라인만)
S1  state.js  : Zustand 스토어 1:1 이식 (import 0 → 충돌 0). 소비처 16곳은 어댑터로 동시 공존
S2  leaf util : formatters.js / dom.js / events.js / i18n-utils.js — 순수 함수, 그대로 ts 이식
S3  sse.js    : connectSSE(callbacks) → useSSE 훅. 콜백 주입형이라 main과 분리 안전
S4  design-system 30 : 전부 leaf → 무상태 JSX 원자 컴포넌트
S5  render/*  : renderers.js 배럴 우회, render/* 직접 import로 경로 교정 (스냅샷 게이트)
─── 여기까지 회귀 위험 ≈ 0 (전부 leaf/배럴) ───
S6  settings-view.js : 결합도 low(import 2: dom,formatters) but 1,590줄 → 폼 단위 분해 선행
S7  chart.js  : useRef canvas 캡슐화 (medium, timing/resize)
S8  left-panel.js / session-detail/ : 공유 코어. props/store 구독형으로 (스냅샷+left-panel.test 게이트)
S9  api.js    : ★데이터 역전★ — fetch*가 render 호출하는 사이드이펙트 제거
S10 meta-docs-view.js : 1,370줄 분해 (flow/table/search/sidebar)
S11 main.js   : 폐기 → React Router. 마지막. 아무도 import 안 하므로 깨질 역참조 0
```

병렬 가능: S1 완료 후 S4(design-system)·S6(settings)·S7(chart)는 서로 독립이라 worktree 병렬.

---

## 5. 단계별 회귀 위험 최대 결합점 + worktree 격리법

### 위험 #1 (최대) — api.js 데이터 역전 [S9]
**결합점**: `fetchDashboard/fetchRequests/fetchSessionsByProject`가 fetch 직후 render 함수를 **동기 호출**하는 9개 사이드이펙트.
- `api.js:276` `renderProjects(d.projects)`, `:277` `setTypeData`, `:287` `setSourceData('model')`, `:291` `drawDonut()`, `:292` `renderTypeLegend()`
- `api.js:348` `setAllSessions`, `:349` `renderBrowserSessions()`, `:359` `renderCachePanel`, `:369-370` `setAllSessions`+`renderBrowserSessions()`, `:405` `renderToolCategoriesCard`

**왜 위험한가**: fetch와 DOM 변이가 한 함수에 묶여, render를 떼면 화면이 비고, 안 떼면 React state와 이중 렌더 충돌.

**worktree 격리법**:
1. 별도 worktree에서 api.js를 **순수 데이터 반환**(`return json.data`)으로만 바꾸고, render 호출은 React 구독 컴포넌트로 이관.
2. **소비처 안전**: render-coupled fetcher는 main.js만 import하므로(§1.2), 격리 worktree에서 main 진입만 React로 교체하면 다른 5개 소비처(range 유틸 사용)는 무영향.
3. `__tests__/api.test.ts`(`buildQuery/getDateRange/setActiveRange`) + `get-date-range.test.ts`로 데이터 계약 회귀 검증, `renderers.test.ts.snap`으로 render 출력 동일성 검증.
4. git bisect 추적: render 이관을 9개 사이트별 작은 커밋으로 쪼개 회귀 발생 사이트 특정.

### 위험 #2 — main.js 진입 허브 폐기 [S11]
**결합점**: 31개 모듈을 묶는 단일 진입(`main.js:2-59`) + appMode CSS 라우팅(`applyAppMode`/`snapshotBrowseState`/`restorePrevState`).
**왜 위험한가**: 모든 init 호출 순서가 main.js에 암묵 의존. 순서 바뀌면 tooltip/resize/SSE 미초기화.
**worktree 격리법**: main.js는 sink(역참조 0)이므로 **마지막에 통째로 React Router로 대체**. S1~S10이 끝나 모든 자식이 컴포넌트화된 뒤 진입만 갈아끼움 → 격리 worktree에서 라우터+useSSE(S3) 바인딩만 검증. `sse.test.ts`로 이벤트 핸들링 회귀 확인.

### 위험 #3 — settings/meta-docs 거대 파일 [S6/S10]
**결합점**: settings-view 1,590줄·meta-docs-view 1,370줄. 결합도 자체는 낮으나(import 2 / 16) 분해 공수가 큼.
**worktree 격리법**: 결합이 낮아 **독립 worktree에서 폼/패널 단위 서브컴포넌트로 안전 분해**. 다른 트랙과 병렬 가능. meta-docs-view는 getDateRange(api)만 쓰므로 S9 이전에도 착수 가능.

---

## 6. 테스트 공백 (변경 전 보강 대상)

**기존 커버(12 테스트)**: api(`api.test.ts`,`get-date-range.test.ts`) / left-panel(`left-panel.test.ts`) / renderers+스냅샷(`renderers.test.ts`,`.snap`) / state(`state.test.ts`) / sse(`sse.test.ts`) / formatters / events / anomaly / context-window / date-range-storage / parseToolDetail(`packages/web/parseToolDetail.test.ts`).

**공백(추출 표면인데 테스트 없음 → 변경 전 보강 권고)**:
| 추출 단계 | 표면 | 공백 | 보강 |
|----------|------|------|------|
| S7 | `chart.js`(462줄) | 단위 테스트 0 | canvas 렌더 입력→데이터 변환 골든마스터 |
| S8 | `session-detail/`(7파일) | 직접 테스트 0 | turn-rows/flat-view 출력 스냅샷 |
| S6 | `settings-view.js`(1,590) | 폼 핸들링 테스트 0 | 폼 검증/제출 단위 테스트 |
| S10 | `meta-docs-view.js`(1,370) | 직접 테스트 0 | 카탈로그/검색 필터 단위 테스트 |
| S11 | `main.js` appMode 라우팅 | 테스트 0 | (React Router 이행 시 신규) |

---

## 7. over-engineering 판정

| 약점 | 판정 | 근거 |
|------|------|------|
| 순환 의존 끊기 | **변경 불필요** | §3 — 전부 DAG. 착시. 작업 자체가 존재하지 않음 |
| renderers.js 배럴 | **실행(저비용)** | 경로 교정만으로 소멸, 스냅샷으로 안전. 단 "분해"는 이미 끝남(render/* 6파일) — 추가 분해 불필요 |
| state.js 추출 | **실행** | import 0, 추출이 실제 결합 감소. 1순위 |
| api.js 데이터 역전 | **실행** | 9개 사이드이펙트가 React state와 정면 충돌 → 반드시 끊어야 함 |
| settings-view 분해 | **실행(고공수)** | 결합 low지만 1,590줄 단일 파일 — 분해가 React화 전제 |
| main.js 라우터화 | **실행(마지막)** | sink라 위험 최소, 단 모든 자식 선행 필수 |
| session-detail facade 재분할 | **보류 권고** | 이미 7파일 facade로 분리됨(api/left-panel 미import). 추가 미세분할은 가상스크롤 성능 요구가 실측될 때만. 지금은 결합 충분히 분리됨 |

---

## 부록: 검증 명령 근거 (재현용)

- main.js import 31: `grep -cE "^import " main.js`
- api.js render 사이드이펙트: `grep -nE "renderProjects|renderBrowserSessions|drawDonut|..." api.js` → `:276-405`
- state.js import 0: `grep -cE "^import " state.js` → 0
- sse.js import 0 + callback: `sse.js:29,37,39`
- design-system 30 leaf: `find design-system -name '*.js' | wc -l` → 30, 비-leaf import → 빈 결과
- 순환 0: api.js↔left-panel / api↔metadocs / views detail↔default / session-detail↔상위 전부 단방향
