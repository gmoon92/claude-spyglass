# React 풀 마이그레이션 — Task 분해 (TaskCreate 1:1 등록용)

> 대상: `claude-spyglass` `packages/web` (Vanilla JS buildless ESM → React 18 + Vite + TypeScript strict)
> 기준 커밋: `2126e11` (HEAD, main) · 작성일 2026-05-31
> 정본 지시서: `.claude/docs/spyglass/react-migration/react-migration-master-prompt.md` (교정판 v2)
> **이 문서는 작업 문서 생성물이다. React 코드는 포함하지 않는다.**

## 0. 분해 규칙 (메타)

- task id 형식: `P{phase}-{nn}` (예: `P1-01`).
- 각 task는 `title / 대상 경로 / phase / depends_on / test_strategy / worktree / risk` 7항목을 모두 가진다.
- `test_strategy`는 `bun test`(루트 러너, Playwright 미설치 — `package.json` scripts:test=`bun test`) 기준이다. 단일 파일은 `bun test packages/web/assets/js/__tests__/<name>.test.ts`로 실행.
- `worktree=yes`인 task는 `git worktree`로 격리 후 작업한다(사용자 안정성 제약). 회귀 추적은 `git bisect`로 한다.
- 모든 회귀 게이트: `bun run --cwd packages/web typecheck`(checkJs blocking, `.github/workflows/test.yml:32-46`) + `bun test` 전량 통과.

## 1. 검증된 실측 근거 (file:line)

| 항목 | 실측값 | 근거 |
|------|--------|------|
| web 루트 .js | 44개 | `ls packages/web/assets/js/*.js` |
| design-system .js | 30개 (icons 21·primitives 3·markers 2·badges/chips/feedback/stats 각 1) | `find packages/web/assets/js/design-system -name '*.js'` |
| web 단위 테스트 | 11개(`__tests__/`) + `parseToolDetail.test.ts` = 12 파일 / 총 case 165+ | 아래 [부록 A] |
| 스냅샷 골든마스터 | `__tests__/__snapshots__/renderers.test.ts.snap` | 존재 확인 |
| innerHTML | 130건 | `grep -rn innerHTML ... | grep -v __tests__ | wc -l` |
| tsconfig | `strict:false` + `checkJs:true` + `allowJs:true`, `paths:@spyglass/types` | `packages/web/tsconfig.json` |
| 빌드 스크립트 | web `package.json`에 `typecheck`만 존재, **build 없음** (buildless) | `packages/web/package.json` |
| HTML 진입 | `<script type="module" src="/assets/js/main.js">` (`index.html:978`) | `index.html` |
| i18n 로딩 | classic `<script src=/assets/js/i18n.js>` 3종(`index.html:975-977`) → `window.I18n` 전역, web 39파일이 의존 | `grep window.I18n` |
| CSS | `<link>` 35개 (`index.html:90-113` 외) | `find ... -name '*.css'` |
| 서버 정적 서빙 | `/index.html`(`dispatch.ts:122`) + `/assets/`(`:134`) + `/locales/`(`:152`) → `webFile()`(`:31`) | `packages/server/src/runtime/dispatch.ts` |
| api→render 결합 | `api.js:57,59` import, `:287 setSourceData`, `:349,370 renderBrowserSessions()` | `packages/web/assets/js/api.js` |
| 최대 파일 | settings-view 1590 / turn-views 1117 / meta-docs-view 1370 / main 1036 / llm-input 902 | `wc -l` |
| 순환 의존 | 0 (DAG) | component-boundary-analysis §부록B |

---

## 페이즈 1: 빌드 인프라 + 전역 스토어 (마스터 §페이즈1)

> Vite 도입은 buildless 정체성 폐기. 서버 정적 서빙 계약(`dispatch.ts`)이 `/assets/js/*.js`를 가정하므로 **서빙 경로 계약 변경이 핵심 GAP**.

| id | title | 대상 경로 | depends_on | test_strategy | worktree | risk |
|----|-------|-----------|-----------|---------------|----------|------|
| **P1-01** | Vite + React18 + TS strict 빌드 파이프라인 스캐폴딩 (vite.config.ts, package.json build/dev 스크립트, tsconfig strict:true 신설) | `packages/web/{vite.config.ts,package.json,tsconfig.json}` | — | `bun run --cwd packages/web typecheck` 무에러 유지 (신규 strict tsconfig는 .tsx 전용 include, 기존 checkJs는 별도 tsconfig로 분리 유지) | yes | high |
| **P1-02** | 서버 정적 서빙 계약 결정 문서화 — Vite `outDir`/`base` ↔ `dispatch.ts:122,134,152` 정합 (GAP: `/assets/js/main.js` URL 유지 vs 해시 번들 전환) | `packages/web/docs/react-migration/.architecture-decision-serving.md`, 근거 `packages/server/src/runtime/dispatch.ts:31,122,134,152` | P1-01 | (문서 task — 코드 회귀 없음) `bun test` 전량 통과 확인만 | no | high |
| **P1-03** | i18n 전역(`window.I18n`) → ESM/React 컨텍스트 어댑터 전략 결정 (39파일 의존, `index.html:975-977` classic script) | `packages/web/docs/react-migration/.migration-gap-report-i18n.md`, 근거 `packages/web/assets/js/i18n.js`, `main.js:867-869` | P1-01 | 기존 `bun test` 미영향 확인 | no | med |
| **P1-04** | Zustand 전역 스토어 설계 — `state.js`(82줄, SSoT) getter/setter 11쌍 + appMode/metaSubTab/prevState 1:1 매핑 (sessionStorage 영속 포함) | 신규 `packages/web/assets/js/store/app-store.ts`, 근거 `packages/web/assets/js/state.js:11-82` | P1-01 | 신규 `packages/web/assets/js/__tests__/app-store.test.ts` 작성(TDD 선행); 기존 `state.test.ts`(14 case)와 동작 동치 검증 | yes | med |
| **P1-05** | 스토어 localStorage/sessionStorage 영속 미들웨어 단위 테스트 우선 작성 (`spyglass.appMode`, `spyglass.metaSubTab`, `spyglass:lang`, date-range) | `packages/web/assets/js/__tests__/app-store-persist.test.ts`, 근거 `state.js:11-12,30-35`, `util/date-range-storage.js` | P1-04 | 신규 테스트로 영속 키 round-trip 검증; 기존 `date-range-storage.test.ts`(12) 회귀 0 | yes | low |
| **P1-06** | 기존 12개 web 테스트의 import 경로(`'../renderers.js'` 등) 호환 유지 전략 — Vite/bun test resolve 정합 검증 | `packages/web/bunfig.toml`(신규 가능), 근거 `__tests__/renderers.test.ts:2`, `left-panel.test.ts:10` | P1-01 | `bun test packages/web` 전량(12파일) 통과 게이트 | yes | med |
| **P1-07** | Zod 스키마 계층 설계 — SSE/API JSON 파싱 런타임 검증 (마스터 §2-3 any 금지) | 신규 `packages/web/assets/js/schema/sse-schema.ts`, 근거 sse-analysis.md §2.3-2.5 페이로드 | P1-01 | 신규 `schema` 단위 테스트; SSE 페이로드 fixture 검증 | yes | med |

---

## 페이즈 2: 원자적 저위험 컴포넌트화 (마스터 §페이즈2)

> design-system 30개 + settings-view 분해. settings-view는 결합도 low(import 2개)이나 1590줄 = 최대 파일 → 분해 선행 필수.

| id | title | 대상 경로 | depends_on | test_strategy | worktree | risk |
|----|-------|-----------|-----------|---------------|----------|------|
| **P2-01** | design-system icons 21개 → stateless TSX 컴포넌트 이식 | `packages/web/assets/js/design-system/icons/*.js`(21) → `.tsx` | P1-01 | 신규 스냅샷 테스트(아이콘 SVG 출력 고정); 순수 함수라 회귀 위험 최소 | yes | low |
| **P2-02** | design-system primitives 3 (close-button, filter-button, tab) → TSX | `design-system/primitives/{close-button,filter-button,tab}.js` | P2-01 | 신규 컴포넌트 렌더 테스트; 클릭 핸들러 prop 검증 | yes | low |
| **P2-03** | design-system markers 2 + badges/chips/feedback/stats 5 → TSX | `design-system/{markers/*,badges/badge,chips/chip,feedback/index,stats/bar}.js`(7) | P2-01 | 신규 스냅샷 테스트 | yes | low |
| **P2-04** | `render/badges.js`(393줄)·`render/model.js`(164)·`render/cells.js`(88) 순수 렌더 함수 → TSX 컴포넌트 (스냅샷 골든마스터 대상) | `packages/web/assets/js/render/{badges,model,cells,rows,icons,expand,extract,skeleton}.js` | P1-01 | 기존 `renderers.test.ts.snap`(20 case) **동일 입력→동일 출력** 게이트 — 의도 변경 시에만 스냅샷 갱신+커밋 사유 명기 | yes | med |
| **P2-05** | settings-view 1590줄 → 폼 단위 서브 컴포넌트 경계 설계 (진단/Hook/Graph DB/Proxy 4영역) 문서화 | `packages/web/docs/react-migration/.architecture-decision-settings.md`, 근거 `settings-view.js`(import: dom.js, formatters.js 2개) | P1-04 | (설계 task) 회귀 0 확인 | yes | med |
| **P2-06** | settings-view 진단/Hook 폼 → React 컴포넌트 + 폼 핸들링 단위 테스트 | 신규 `packages/web/assets/js/settings/*.tsx`, 근거 `settings-view.js` | P2-05, P1-04 | 신규 폼 핸들링 테스트(입력→상태→apiFetch 호출 mock) | yes | med |
| **P2-07** | settings-view Graph DB/Proxy 폼 → React 컴포넌트 | 신규 `packages/web/assets/js/settings/*.tsx`, 근거 `settings-view.js` | P2-05, P1-04 | 신규 폼 테스트; apiFetch 모킹 | yes | med |
| **P2-08** | `components/` 3개(date-range-dropdown 321·filter-bar 86·search-box 42) → TSX | `packages/web/assets/js/components/{date-range-dropdown,filter-bar,search-box}.js` | P2-01, P1-04 | 신규 컴포넌트 테스트; date-range는 `date-range-storage.test.ts`(12)·`get-date-range.test.ts`(20) 회귀 게이트 | yes | low |

---

## 페이즈 3: 중위험 결합 컴포넌트 + API 역전 (마스터 §페이즈3)

> chart.js canvas 캡슐화, left-panel/session-detail 분해, api.js render 직접 호출 제거(선언적 역전).

| id | title | 대상 경로 | depends_on | test_strategy | worktree | risk |
|----|-------|-----------|-----------|---------------|----------|------|
| **P3-01** | `chart.js`(462줄) → `useRef` canvas 컴포넌트 캡슐화 (`setSourceData` 외부 주입 → props), donutMode → 스토어 | `packages/web/assets/js/chart.js` → `Chart.tsx`, 근거 chart.js, component-boundary §5.2-C | P1-04, P2-04 | 기존 `context-window.test.ts`(6) 등 차트 의존 테스트 회귀; canvas timing/resize는 수동 verify 보강 | yes | med |
| **P3-02** | `left-panel.js`(195줄) `_allProjects/_allSessions` → 스토어/props, `renderBrowserSessions/renderProjects` → `<Sidebar>` JSX | `packages/web/assets/js/left-panel.js` → `Sidebar.tsx` | P1-04, P2-08 | 기존 `left-panel.test.ts`(2: `renderBrowserSessions`·`GLOBAL_PROJECT_KEY`) 동작 동치 게이트 | yes | med |
| **P3-03** | `api.js`(443줄) 데이터 흐름 역전 — `:287 setSourceData`/`:349,370 renderBrowserSessions()` 직접 호출 제거, raw data 반환 + 스토어 dispatch | `packages/web/assets/js/api.js`, import `:57,59` | P1-04, P3-01, P3-02 | 기존 `api.test.ts`(10: `setActiveRange`·`getDateRange`·`buildQuery`) 회귀; render 사이드이펙트 제거 후 스토어 구독 검증 | yes | high |
| **P3-04** | `session-detail/` facade(7파일, 최대 `turn-views.js` 1117줄) 컴포넌트 경계 설계 문서화 | `packages/web/docs/react-migration/.architecture-decision-session-detail.md`, 근거 `session-detail/{index,flat-view,turn-rows,turn-views,state,system-reminder*}.js` | P1-04 | (설계 task) | yes | med |
| **P3-05** | `session-detail/flat-view.js`(201)·`turn-rows.js`(402) → `<SessionLog>`/`<TurnRows>` TSX | `packages/web/assets/js/session-detail/{flat-view,turn-rows}.js` | P3-04, P3-02 | 신규 컴포넌트 테스트 + `parseToolDetail.test.ts`(10) 회귀 게이트 | yes | high |
| **P3-06** | `session-detail/turn-views.js`(1117줄) → 턴 카드 서브 컴포넌트 분해 | `packages/web/assets/js/session-detail/turn-views.js` | P3-04, P3-05 | 신규 분해 컴포넌트 테스트; 출력 동치 검증 | yes | high |
| **P3-07** | `session-detail/{system-reminder,system-reminder-popover}.js`(73+241) + `views/detail-view.js`(193) → TSX | `packages/web/assets/js/session-detail/system-reminder*.js`, `views/detail-view.js` | P3-05 | 신규 컴포넌트 테스트 | yes | med |
| **P3-08** | `llm-input-view.js`(902줄) 상태 정제 → `<LLMInput>` TSX (toggle/expand/scroll 상태 분리) | `packages/web/assets/js/llm-input-view.js` | P1-04, P3-02 | 신규 컴포넌트 테스트; state 의존(state.js)만 → 스토어 연결 검증 | yes | med |

---

## 페이즈 4: 고위험 모놀리식 해체 + 라우팅/SSE (마스터 §페이즈4)

> meta-docs-view 분해, main.js → React Router v6, sse.js → useSSE 훅.

| id | title | 대상 경로 | depends_on | test_strategy | worktree | risk |
|----|-------|-----------|-----------|---------------|----------|------|
| **P4-01** | `meta-docs-view.js`(1370줄, import 16) 분해 경계 설계 — flow/catalog/search/sidebar/tool-stats 5분할 문서화 | `packages/web/docs/react-migration/.architecture-decision-meta-docs.md`, 근거 component-boundary §5.2-F | P1-04 | (설계 task) | yes | high |
| **P4-02** | meta-docs catalog 테이블 + 검색 → `<MetaDocsCatalog>`/`<MetaDocsSearch>` TSX | 신규 `packages/web/assets/js/meta-docs/*.tsx`, 근거 `meta-docs-view.js` | P4-01, P2-08 | 신규 컴포넌트 테스트; 검색 필터 동작 검증 | yes | high |
| **P4-03** | meta-docs flow(ego-graph) + tool-stats 패널 → TSX 통합 | 신규 `packages/web/assets/js/meta-docs/*.tsx`, 근거 `meta-docs-view.js` import 16개 | P4-02 | 신규 테스트; scopeMode/searchText/activeRow 상태 검증 | yes | high |
| **P4-04** | `useSSE` 커스텀 훅 — `sse.js`(64줄) 재연결/5초 backoff 기반, 3 이벤트(`new_request`/`new_proxy_request`/`session_update`) 바인딩 + Zod 검증 | 신규 `packages/web/assets/js/hooks/use-sse.ts`, 근거 `sse.js:37-60`, sse-analysis §4 | P1-04, P1-07 | 기존 `sse.test.ts`(8: `connectSSE`) 동작 동치 게이트 + 신규 훅 테스트(mock EventSource) | yes | high |
| **P4-05** | SSE 이벤트 핸들러(`onNewRequest`/`onNewProxyRequest`/`onSessionUpdate`, `main.js:359-426`) → 스토어 액션 이전 | `packages/web/assets/js/main.js:359-440` → 스토어 액션, 근거 sse-analysis §4.2 | P4-04, P3-03 | 기존 `events.test.ts`(6: `DETAIL_FILTER_CHANGED`·`FEED_UPDATED`) + `sse.test.ts` 회귀 | yes | high |
| **P4-06** | `main.js`(1036줄, import 31) → React Router v6 레이아웃 (`<App>/<BrowseLayout>/<MetaDocsLayout>/<SettingsLayout>`), appMode→useNavigate | `packages/web/assets/js/main.js` → `App.tsx` + routes, 근거 component-boundary §5.2-G | P3-03, P4-03, P4-05, P3-08 | 전 페이즈 컴포넌트 통합; `bun test` 전량 + 수동 verify(3모드 전환) | yes | high |
| **P4-07** | `index.html` 진입 전환 — `main.js` module script(`:978`) → Vite 번들, FOUC/lang 인라인 스크립트(`:14-83`) 보존 처리 | `packages/web/index.html:14-83,975-978` | P4-06, P1-02, P1-03 | 수동 verify(FOUC·lang 우선순위 4종); `bun test` 영향 없음 | yes | high |

---

## 페이즈 5: TS strict 승격 + 렌더링 최적화 (마스터 §페이즈5)

> 전 파일 .tsx 전환 완료, strict:true, memo/가상스크롤.

| id | title | 대상 경로 | depends_on | test_strategy | worktree | risk |
|----|-------|-----------|-----------|---------------|----------|------|
| **P5-01** | 잔여 유틸/뷰 .js → .ts/.tsx 일괄 전환 (`renderers.js` 16·`formatters.js` 69·`dom.js` 68·`app-rail.js` 67·`util/*` 2·`state/anomaly-cache.js` 24·`views/default-view.js` 12) | `packages/web/assets/js/{renderers,formatters,dom,app-rail}.js`, `util/*`, `state/*`, `views/*` | P4-06 | 기존 `formatters.test.ts`(53)·`anomaly.test.ts`(14) 회귀 0; `renderers.test.ts.snap` 일치 | yes | med |
| **P5-02** | `tsconfig.json` `strict:true` 단일화 — checkJs 임시 tsconfig 폐기, strict 한정 위반 0 달성 | `packages/web/tsconfig.json` | P5-01 | `bun run --cwd packages/web typecheck` 무에러 (CI `web-typecheck` blocking 유지) | yes | high |
| **P5-03** | `any` 잔재 제거 + Zod 스키마 전면 적용 (JSON 파싱부) | `packages/web/assets/js/schema/*`, api/sse 파싱부 | P5-02, P1-07 | typecheck strict 0 에러; 스키마 테스트 통과 | yes | med |
| **P5-04** | `React.memo`/`useMemo` 배치 최적화 — SSE 고주기(5-20 events/sec) 스트림 리렌더 억제 | SSE 구독 컴포넌트(`<Sidebar>`, feed, `<SessionLog>`) | P5-02 | 기존 테스트 회귀 0; 수동 verify(고주기 입력 시 프레임) | yes | med |
| **P5-05** | session-detail/meta-docs 카탈로그 가상 스크롤 부분 도입 (대량 턴/항목) | `<SessionLog>`, `<MetaDocsCatalog>`, 근거 component-boundary §부록C | P5-04, P4-03, P3-06 | 신규 가상화 테스트; 출력 동치(가시영역) 검증 | yes | med |
| **P5-06** | 최종 회귀 게이트 + Gap Report 종합 — `bun test` 전량 통과 통계·신규 테스트 커버리지·미결 Gap 목록 출력 | `packages/web/docs/react-migration/.migration-final-report.md` | P5-05 | `bun test` 전량 + `bun run --cwd packages/web typecheck` 최종 게이트 | no | low |

---

## 부록 A: 기존 web 테스트 (회귀 보루) — file:line

| 테스트 파일 | case 수 | 검증 대상 모듈 | 비고 |
|-------------|---------|----------------|------|
| `__tests__/renderers.test.ts` | 20 | `renderers.js` (`makeRequestRow`/`makeTargetCell`/`makeSessionRow`) | **스냅샷 골든마스터** `.snap` |
| `__tests__/formatters.test.ts` | 53 | `formatters.js` | 최다 case |
| `__tests__/get-date-range.test.ts` | 20 | date range | P2-08 게이트 |
| `__tests__/anomaly.test.ts` | 14 | `anomaly.js` | P5-01 게이트 |
| `__tests__/state.test.ts` | 14 | `state.js` | P1-04 동치 기준 |
| `__tests__/date-range-storage.test.ts` | 12 | `util/date-range-storage.js` | P1-05 게이트 |
| `__tests__/api.test.ts` | 10 | `api.js`(`setActiveRange`/`getDateRange`/`buildQuery`) | P3-03 게이트 |
| `parseToolDetail.test.ts` | 10 | tool detail 파싱 | P3-05 게이트 |
| `__tests__/sse.test.ts` | 8 | `sse.js`(`connectSSE`) | P4-04 동치 기준 |
| `__tests__/context-window.test.ts` | 6 | context window | P3-01 관련 |
| `__tests__/events.test.ts` | 6 | `events.js`(`DETAIL_FILTER_CHANGED`/`FEED_UPDATED`) | P4-05 게이트 |
| `__tests__/left-panel.test.ts` | 2 | `left-panel.js`(`renderBrowserSessions`/`GLOBAL_PROJECT_KEY`) | P3-02 동치 기준 |

테스트 import는 모두 상대 `.js` 경로(`'../renderers.js'`). P1-06이 이 resolve 호환을 보장한 뒤에야 후속 페이즈 진행.

## 부록 B: 핵심 GAP (휴먼 검증 필요)

1. **서빙 계약 (P1-02, risk high)**: `dispatch.ts:122,134`는 `/index.html`·`/assets/js/main.js`를 그대로 서빙. Vite 해시 번들 도입 시 서버 코드 수정 불가피(미션상 백엔드 무수정 제약과 충돌) → 번들 출력을 `/assets/` 하위 고정명으로 강제하거나 manifest 주입 필요. **휴먼 결정 포인트.**
2. **i18n 전역 (P1-03)**: `window.I18n` 전역에 39파일 의존, classic script 3종. Vite ESM 번들로 흡수 시 로딩 순서 보장 재설계 필요.
3. **FOUC/lang 인라인 스크립트 (P4-07)**: `index.html:14-83` 인라인 스크립트가 첫 paint 전 lang/영속상태 적용. React 진입 전 실행 보장 유지 필요.
4. **canvas timing (P3-01)**: chart.js resize 감지·재그리기 타이밍은 단위 테스트로 불충분 → 수동 verify 보강.

## 부록 C: 의존성 그래프 요약 (페이즈 게이트)

```
P1-01 (Vite/strict) ──┬─ P1-02 서빙계약(GAP)
                      ├─ P1-03 i18n(GAP)
                      ├─ P1-04 store ──┬─ P1-05 persist
                      │                ├─ P2-* (settings/components)
                      │                ├─ P3-* (chart/left-panel/api역전)
                      │                └─ P4-* (meta-docs/router/sse)
                      ├─ P1-06 test resolve (모든 후속 선행)
                      └─ P1-07 Zod ── P4-04 useSSE
P2-04 (render 스냅샷) ── P3-01 chart
P3-03 (api 역전) ── P4-05 ── P4-06 router ── P4-07 entry ── P5-* strict/최적화
```

병렬 가능: P2-01~04(design-system) ∥ P2-05~07(settings) ∥ P2-08(components) — 모두 P1-04 이후.
순차 강제: P3-02(left-panel) → P3-03(api 역전) → P4-05(SSE 핸들러) → P4-06(router).
