# React 마이그레이션 — 아키텍처/리팩토링 패널 (architecture)

> 역할: spyglass 아키텍처/리팩토링 전문가. 대안 C(풀 마이그레이션, buildless→Vite) 전제.
> 적용 스킬: `architecture-guard`, `detect-architecture-violation`, `refactoring-expert` (모두 Read 완료).
> 본 문서는 **개발 작업 문서**다. React 코드는 작성하지 않는다. 모든 단정에 `파일:라인` 근거를 붙였고, 추측은 명시적으로 "추정"으로 표기한다.

---

## 0. 핵심 발견 요약 (Blocker/가드 우선)

| # | 발견 | 영향 | 근거 |
|---|------|------|------|
| F1 | **web 은 현재 아키텍처 정적 게이트의 사각지대다.** `check-architecture.sh` 의 DEP·KEBAB 검사는 `packages/*/src` 만 스캔하는데, web 코드는 `assets/js/` 에 있어 `packages/web/src/` 가 없다. | Vite 마이그레이션이 `packages/web/src/` 를 신설하는 순간, web 이 **처음으로** KEBAB(디렉토리)·DEP(@spyglass import) 게이트의 대상이 된다. 신규 디렉토리/임포트가 곧바로 차단될 수 있다. | DEP: `check-architecture.sh:53-72` (`src="${dir%/}/src"`, `[[ -d "$src" ]] \|\| continue`), KEBAB: `check-architecture.sh:76-83` (`find packages/*/src -type d`). web src 부재: `ls packages/web/src` → 없음 |
| F2 | **web→types 경계는 `tsconfig.json` paths alias 단 한 곳에서만 성립**하고, 런타임 import 가 아니라 JSDoc typedef 1파일뿐이다. | Vite 전환 시 이 경계를 **런타임/번들 import 로 승격**해도 rank(types=0 < web=4) 상 정방향이라 위반 아님. 단 정적 게이트가 `from '@spyglass/types'` 를 잡으므로 import 형태를 게이트와 정합하게 써야 한다. | alias: `packages/web/tsconfig.json` `"@spyglass/types": ["../types/src/index.ts"]`. 실사용: `api.js:8-9` JSDoc `import('@spyglass/types')` 2건, 전체 1파일만 참조 |
| F3 | **api.js 가 13개 render/update 함수를 직접 호출**하는 데이터흐름 결합이 실재한다. | 대안 C 의 "데이터흐름 역전" 의 핵심 표적. Tidy First 로 순수 이동(추출)과 흐름 역전(동작 변경)을 **분리 커밋**해야 한다. | `api.js:276 renderProjects`, `:287 setSourceData`, `:292 renderTypeLegend`, `:349/:370 renderBrowserSessions`, `:359 renderCachePanel`, `:403 renderBurnRate`, `:404 renderCacheHealth`, `:405 renderToolCategoriesCard`, `:411 renderLivePulse`, `:418 renderAnomalyBadge` |
| F4 | **innerHTML 130건**, SSoT 렌더 함수 경유 vs 직접 HTML 작성이 혼재. | 130건을 JSX 로 옮길 때 `render/badges.js#toolIconHtml()`·`design-tokens.css` 토큰 SSoT 를 우회하지 않아야(아키 표준 §3). | `grep -rn innerHTML packages/web/assets/js --include=*.js` → 130 |
| F5 | i18n 3종(`i18n.js`,`i18n-dom.js`,`lang-switcher.js`)은 **비-module `<script>` 전역 IIFE**, main.js 만 `type="module"`. | Vite 단일 엔트리로 통합 시 전역 i18n 을 ESM/번들 의존성으로 흡수해야 한다(전역 오염 제거). | `index.html:975-978` (3개 일반 script + 1개 module), `i18n.js:2` "번들러 없음, IIFE 전역 노출" |

---

## 1. 새 React 구조 — 디렉토리/레이어 경계 규칙

### 1.1 패키지 위치 결정: `packages/web` 유지 (신규 패키지 금지)

- web 의 layer rank 는 **4** (`architecture-standards.md` §1, `check-architecture.sh:39`). React+Vite 전환은 **빌드 방식 변경**이지 책임 변경이 아니므로 **새 패키지를 만들지 않는다.** rank 표/`rank_of()` 갱신 불필요 → architecture-guard 의 "신규 패키지 rank 등록" 절차 회피(안전).
- 서버의 정적 서빙 계약(`dispatch.ts`)이 web 디렉토리 위치에 의존하므로(아래 §3.2), 패키지 이동은 server 변경을 유발한다. 백엔드 불변 원칙(미션)에 반하므로 **이동 금지**.

### 1.2 권장 디렉토리 레이아웃 (rank·KEBAB 게이트 정합)

Vite 관례상 소스를 `src/` 로 모으되, **모든 디렉토리는 kebab-case**(F1 게이트 대상). React 컴포넌트 **파일**은 PascalCase 정당(`architecture-standards.md` §5, `detect-architecture-violation` SKILL §2 주석 — 스크립트는 디렉토리만 검사).

```
packages/web/
├─ index.html              # Vite 엔트리 (server dispatch.ts 가 그대로 서빙 — §3.2)
├─ vite.config.ts
├─ tsconfig.json           # strict 승격은 페이즈 5 (마스터프롬프트 §4 페이즈5)
└─ src/
   ├─ main.tsx             # 진입점 (구 main.js 1036줄 대체 — 라우터 마운트)
   ├─ app/                 # App 셸, 라우팅, 모드 레이아웃
   ├─ components/          # 재사용 프레젠테이션 컴포넌트 (PascalCase 파일)
   │  └─ design-system/    # 구 design-system 30개 .js 이식 (icons/primitives/...)
   ├─ features/            # 도메인 화면 (browse / meta-docs / settings / session-detail)
   ├─ hooks/               # useSSE 등 (구 sse.js 64줄 기반)
   ├─ stores/              # Zustand (구 state.js 82줄 + 분산 로컬캐시 통합)
   ├─ api/                 # raw data only (구 api.js 443줄, render 호출 제거 — §2)
   ├─ lib/                 # 순수 유틸 (구 formatters.js/dom.js, i18n 흡수)
   └─ types/               # web 로컬 타입 (도메인 타입은 @spyglass/types 재사용)
```

### 1.3 레이어 경계 규칙 (의존 방향 — web 내부)

DAG 강제. 화살표 = "import 해도 됨". 역방향/순환 금지(`detect-architecture-violation` §2, architecture-guard "단방향 의존").

```
types(@spyglass/types, 외부 rank0)  ←─ (모두 참조 가능, 정방향)
        ▲
api ──► stores ──► hooks ──► features ──► app ──► main.tsx
                                   │
components/(design-system) ◄───────┘   (features/app 가 components 를 소비, 역참조 금지)
lib/ ◄── (모든 층이 참조 가능한 leaf, 어떤 층도 import 하지 않음)
```

규칙(머지 게이트):
1. **`components/` 와 `lib/` 는 leaf** — `stores`/`hooks`/`api`/`features` 를 import 금지(프레젠테이션·순수함수는 상태를 모른다).
2. **`api/` 는 `stores`/`features`/`components` 를 import 금지** — F3 의 역전을 구조로 못박는다. api 는 raw data 만 반환.
3. **`stores/`(Zustand)는 `hooks`/`features`/`components` 를 import 금지** — 상태는 UI 를 모른다(렌더링 아키 §6.2 전역상태 충돌 해소).
4. **`features/` 간 횡결합 금지** — 공유물은 `components`/`hooks`/`stores` 로 올린다(SRP, meta-docs↔session-detail 결합 방지).
5. **도메인 타입 SSoT = `@spyglass/types`** — web 로컬에서 서버 도메인 타입을 재선언 금지(SSoT, F2). JSON 파싱 경계는 Zod 등으로 검증 후 `@spyglass/types` 형태로 정규화(마스터프롬프트 §2-3).

### 1.4 게이트 정합 체크리스트 (커밋 전)

- `bash .claude/skills/detect-architecture-violation/scripts/check-architecture.sh` 통과 — F1 때문에 web/src 신설 직후부터 의미 있다.
- 신규 디렉토리 전부 kebab-case (PascalCase 디렉토리 = 즉시 Blocker).
- `from '@spyglass/...'` 는 types(rank0)만 — storage 이상 상위 패키지 import 금지(web rank4 라 정방향이지만, web→server import 는 백엔드 결합이므로 금지).

---

## 2. innerHTML 130건 제거 + api.js 데이터흐름 역전 — 안전 리팩토링 패턴

`refactoring-expert` 원칙 적용: strangler(한 번에 다시 쓰지 않음) + Tidy First(구조/동작 분리 커밋) + 동작 보존을 테스트로 증명.

### 2.1 api.js 역전 — 4단계, 커밋 분리

현재: `api.js` 가 fetch 후 13개 render 함수를 직접 호출(F3). 목표: api 는 raw data 만 반환, 상태 갱신은 stores 가, 렌더는 React 가.

- **단계 A (특성화 테스트 선행)** — `api.test.ts` 가 이미 존재(`__tests__/api.test.ts`). 역전 전 현 동작을 고정하는 테스트가 충분한지 확인하고, 부족하면 fetch→반환 형태에 대한 특성화 테스트 추가. (refactoring-expert 절차 3: 테스트 없으면 추출 전 characterization test부터.)
- **단계 B (Tidy First — 순수 추출, 동작 불변)** — 각 fetch 함수에서 render 호출을 떼어내되, 동작을 유지하기 위해 **호출부(임시 어댑터)로 render 호출을 끌어올린다**. api 는 raw data return. 이 커밋은 `refactor:` — 출력 동일, `renderers.test.ts.snap` 스냅샷·`left-panel.test.ts` 그대로 통과해야 함.
- **단계 C (동작 변경 — 별도 커밋)** — 어댑터를 Zustand 액션으로 치환. fetch→`store.setProjects(raw)` → 구독 컴포넌트 자동 리렌더. 이 커밋은 `feat:`/`refactor:` 로 B 와 **절대 같은 커밋에 섞지 않음**(Tidy First 필수, architecture-guard 위임 규칙).
- **단계 D (회귀 가드)** — `bun test` 전량 통과 + `detect-architecture-violation` 으로 `api/ → stores/` 역참조 0 확인(§1.3 규칙 2).

대상 라인(역전 표적): `api.js:276,287,292,349,359,370,403,404,405,411,418`.

### 2.2 innerHTML 130건 → JSX — SSoT 우회 금지 패턴

- **골든마스터 우선**: `makeRequestRow`/`makeTargetCell`/`makeSessionRow` 출력은 `__tests__/__snapshots__/renderers.test.ts.snap` 에 고정. JSX 전환 시 **동일 입력→동일 출력**을 이 스냅샷으로 검증. 출력이 의도적으로 바뀔 때만 스냅샷 갱신 + 사유를 커밋 메시지에(마스터프롬프트 §2-1).
- **SSoT 경유 강제**(아키 표준 §3): 툴 아이콘 색·글리프는 `render/badges.js#toolIconHtml()` + `.tool-chip-{kind}` 가 단일 출처. JSX 컴포넌트에서 hex/글리프 **직접 지정 금지** → 토큰/CSS 변수(`design-tokens.css#--sub-type-*`) 또는 기존 렌더 헬퍼를 컴포넌트로 1:1 이식. chip-key 규칙은 `session-detail/turn-rows.js#chipKey()` 재구현 금지.
- **분해 순서(strangler, 의존 역순)** — leaf 부터:
  1. `design-system/*`(30개), `formatters.js`, `dom.js` — innerHTML 거의 없는 순수/프레젠테이션 → 컴포넌트/hook 으로 즉시 이식.
  2. `left-panel.js`(195줄, `body.innerHTML=rows.join('')` 패턴) — 스냅샷 보호하 컴포넌트화.
  3. `settings-view.js`(1590줄, 최대 파일) — **폼 단위 서브컴포넌트 분해 선행**(결합도 낮으나 분해공수 높음, 컴포넌트경계 §5.2). innerHTML 다수 집중.
  4. `session-detail/`(facade) — col-resize 보존 주석(`turn-views.js`: thead/colgroup 미변경) → JSX 에서도 table 골격 안정 유지.
  5. `meta-docs-view.js`(1370줄) — flow/table/search/sidebar 로 분해 후 이식.
- **셀렉터 계약 유지**(마스터프롬프트 §2-1): 기존 DOM id/class/`data-*`(`data-session-id`, `dateFilter` 등 `index.html:412` 주석 참조)를 JSX 에 1:1 유지 — 향후 E2E·CSS 호환.

### 2.3 SRP 분해 임계 (경고 트리거, 아키 표준 §4)

- 함수 200줄+ / 파일 500줄+ = 분해 후보. 표적: `settings-view.js`(1590), `meta-docs-view.js`(1370), `main.js`(1036), `llm-input-view.js`(902, 컴포넌트경계 §1.1). 이들은 React 전환과 **동시에** 분해하지 말고, "분해(refactor) → 이식(feat)" 을 분리.

---

## 3. buildless→Vite 전환 가드 (기존 아키텍처 규칙과 충돌 방지)

### 3.1 정적 게이트 충돌 — F1 의 직접 결과

- **충돌**: `packages/web/src/` 신설 시 KEBAB(디렉토리)·DEP(@spyglass import)가 web 에 처음 적용. PascalCase 디렉토리 1개라도 → 즉시 Blocker(`check-architecture.sh:80`).
- **가드**: §1.2 레이아웃대로 **모든 디렉토리 kebab-case**. 컴포넌트 PascalCase 는 파일명에만. 게이트가 디렉토리만 검사하므로 안전(`detect-architecture-violation` SKILL §2 마지막 행, 예외처리 80행).
- **표준 갱신 금지**: 게이트가 web 을 새로 잡는다고 `rank_of()`/스크립트를 임의 약화 금지. 규칙이 현실과 어긋나 보이면 리포트에 적어 사람이 `architecture-standards.md` 를 갱신(architecture-guard "과잉교정 금지", SKILL 82행).

### 3.2 서버 정적 서빙 계약 — 백엔드 불변 유지

- **계약**: `dispatch.ts` 는 `GET /`→`webFile('/index.html')`(`:122`), `/assets/*`→`webFile`(`:137`), `/locales/*`→`webFile`(`:155`). web 루트는 `SPYGLASS_WEB_ROOT` env(packaged) 또는 `../../../web/` fallback(dev)(`dispatch.ts:27-31`).
- **가드(미션: 백엔드 무수정)**: Vite 빌드 산출물을 **server 가 기대하는 경로에 맞춰 배출**한다. 즉 server 를 고치지 말고 Vite `build.outDir`/`base` 를 조정.
  - `index.html` 은 web 패키지 루트에 남기거나, 빌드 산출 index.html 이 `/assets/*` 로 자산을 참조하도록 `base: '/assets/'` (추정 — `dispatch.ts` 가 `/assets/` prefix 만 자산으로 서빙하므로 산출 자산 경로가 이 prefix 와 일치해야 함, `:134` 주석 "/assets/ prefix → packages/web/assets/").
  - `/locales/*` 는 `dispatch.ts:152-155` 가 web/locales 를 직접 서빙 → **번들에 넣지 말고 정적 디렉토리로 유지**(런타임 fetch, `i18n.js:94` 가 `locales/${lang}/${ns}.json` fetch).
  - packaged(Electron)에서 `SPYGLASS_WEB_ROOT` 가 가리키는 디렉토리에 빌드 산출물이 위치해야 함(`dispatch.ts:18-30` 주석). 빌드 산출 디렉토리 = 서빙 루트가 되도록 패키징 스크립트(server 외부)에서 맞춘다.
- **결정 기록 필요**(architecture-guard "모호성 문서화"): 빌드 산출물의 정확한 경로 매핑(outDir, base, locales 처리)은 server `dispatch.ts` 의 실제 경로 해석과 1:1 검증해야 하며, 미확정 부분은 `.architecture-decision.md` 로 남길 것. **본 패널은 server 코드를 바꾸지 않는다는 제약만 확정**하고, 빌드 출력 매핑 세부는 빌드 트랙에서 실측 검증.

### 3.3 패키지 경계(@spyglass/types) 가드 — F2

- **현 상태**: web→types 는 `tsconfig.json` paths alias + JSDoc typedef 2건(`api.js:8-9`)뿐. 런타임 import 0.
- **Vite 전환 시**: alias 를 `vite.config.ts` `resolve.alias` + `tsconfig` paths **양쪽에 일치**시켜야 함(빌드/타입 정합). types 는 rank0 이라 web(rank4)→types 는 정방향 — 위반 아님.
- **가드**: web 은 `@spyglass/types` **외 다른 @spyglass 패키지 import 금지**(storage/server 등 = 백엔드 결합, rank 상으론 정방향이나 클라이언트 격리 위반). 정적 게이트가 `from '@spyglass/X'` 를 잡으므로(`check-architecture.sh:72`), types 외 참조가 들어오면 사람이 검토. JSON 응답 → `@spyglass/types` 형태로 Zod 정규화하는 경계를 `api/` 에 둔다(마스터프롬프트 §2-3, "무분별한 any 금지").

### 3.4 타입 안정성 회귀 게이트 — R5 보호망 보존

- **현 게이트**: CI `web-typecheck` 잡이 **blocking** 으로 `bun run --cwd packages/web typecheck` 실행(`test.yml:32-46`, `strict:false`+`checkJs:true`, 181→0). `globals.d.ts`/`dom.js` 헬퍼 존재.
- **가드**: `.js`→`.tsx` 점진 전환 중에도 **typecheck 0 에러를 상시 회귀 게이트로 유지**(마스터프롬프트 §4 페이즈5). `strict:true` 승격은 전 파일 .ts/.tsx 전환 완료 후(페이즈 5) — 그 전엔 checkJs 0 에러 baseline 유지. Vite 도입으로 tsc 게이트를 없애지 말 것(R5 보호망 폐기 = 회귀 무방비).
- **테스트 러너 불변**: `bun test`(`package.json:15`)가 web `__tests__/`(11개 .ts) + `parseToolDetail.test.ts` 를 구동. Vite 도입해도 **테스트 러너는 bun test 유지**(Vitest 도입은 별도 비용 결정 — 미션 안정성 제약상 회귀보루 교체는 신중). 신규 컴포넌트/훅에 대응 테스트 추가(마스터프롬프트 §2-1).

---

## 4. 워크트리·TDD·bisect 안정성 제약 접지

미션의 안정성 제약(worktree 격리, TDD, bisect, 회귀 0, 작은 커밋)을 위 패턴에 매핑:

- **worktree 격리**: web src 신설은 게이트(F1) 영향이 크므로, 격리 워크트리에서 §1.2 레이아웃 + 게이트 통과를 먼저 검증 후 머지.
- **TDD/테스트 우선**: 모든 추출은 추출 전 테스트 통과 확인 → 추출 → 동일 테스트 재통과로 동작 불변 증명(refactoring-expert 절차 3). 스냅샷이 골든마스터.
- **bisect**: §2.1 Tidy First 커밋 분리(refactor↔feat)가 곧 bisect 단위 — 회귀 발생 시 "구조 이동"과 "흐름 역전" 중 어느 커밋인지 즉시 격리 가능.
- **회귀 0**: 매 커밋 `bun test` 전량 + `check-architecture.sh` + `web typecheck` 3중 게이트.

---

## 5. 미결/사람 검증 포인트 (Gap — 추측 금지 항목)

`.architecture-decision.md` / `.migration-gap-report.md` 로 남길 항목:

1. **Vite 빌드 산출물 ↔ dispatch.ts 경로 매핑**(§3.2): `base`/`outDir`/`SPYGLASS_WEB_ROOT`/`/locales` 처리의 정확한 값은 server 경로 해석과 실측 대조 필요. 본 패널은 "server 무수정" 제약만 확정. (추정 표기 부분)
2. **i18n 전역 IIFE 흡수 방식**(F5): `i18n.js`/`i18n-dom.js`/`lang-switcher.js` 의 전역 노출 API 를 어떤 컴포넌트/훅이 소비하는지 전수 조사 후 ESM 의존성으로 전환. main.js 의 i18n 소비 지점 매핑 필요(`main.js` 다수).
3. **R5 게이트 vs Vitest 결정**: 회귀보루(bun test)를 유지할지 Vitest 로 교체할지 — 교체 시 별도 비용 페이즈(마스터프롬프트 §6).
4. **leaf 추출 정밀 순서**: `scan-extraction-candidates.sh`(refactoring-expert) 실행 결과로 settings-view/meta-docs-view 분해 순서를 데이터로 확정(본 패널은 LOC 근거로 1차 제시).

---

## 부록: 근거 파일·라인 인덱스

- 정적 게이트: `.claude/skills/detect-architecture-violation/scripts/check-architecture.sh:39,53,72,76-83`
- rank/R1~R8/SSoT: `.claude/skills/detect-architecture-violation/references/architecture-standards.md` §1,§2,§3,§4,§5
- web tsconfig(alias·strict·checkJs): `packages/web/tsconfig.json`
- CI 타입 게이트: `.github/workflows/test.yml:32-46`
- 서버 정적 서빙: `packages/server/src/runtime/dispatch.ts:18-31,122-127,134-155,169`
- api.js render 결합: `packages/web/assets/js/api.js:56-71(import),276,287,292,349,359,370,403-418`
- 테스트/스냅샷: `packages/web/assets/js/__tests__/`(11) + `__snapshots__/renderers.test.ts.snap` + `packages/web/parseToolDetail.test.ts`
- 진입/스크립트: `packages/web/index.html:975-978`
- i18n 전역 IIFE: `packages/web/assets/js/i18n.js:2,94`
- 파일 규모: state.js 82 / sse.js 64 / api.js 443 / main.js 1036 / meta-docs-view.js 1370 / settings-view.js 1590 (`wc -l`), design-system 30 .js, innerHTML 130, web js 105
