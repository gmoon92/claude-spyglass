# 안정화 오케스트레이션 패널 — Spyglass Web React 풀 마이그레이션 (대안 C)

> 역할: stabilization (안정화 오케스트레이션). 적용 스킬: `stabilization-orchestrator` + `stabilization-cycle` (6단계).
> 대상 레포: `claude-spyglass` (HEAD `2126e11` · v3.0.7). 대상 패키지: `packages/web` (Vanilla JS buildless ESM, 105 `.js`).
> 정본 작업지시서: `${CLAUDE_PROJECT_DIR(claude-code-system)}/.claude/docs/spyglass/react-migration/react-migration-master-prompt.md`.
> **이 문서는 "어떻게 회귀 0으로 안전하게 진행할지"의 운용 설계서다. React 코드는 작성하지 않는다.**

---

## 0. 실측 baseline (오케스트레이션 게이트의 기준선)

추측 금지. 모든 수치는 HEAD `2126e11`에서 직접 측정.

| 항목 | 실측값 | 근거 (파일:라인 / 명령) |
|------|--------|------------------------|
| 테스트 baseline | **174 pass / 0 fail / 20 snapshots / 255 expect / 12 files** | `bun test packages/web/` (root에서 실행) |
| 테스트 파일 | 12개 | `packages/web/assets/js/__tests__/` 11개 + `packages/web/parseToolDetail.test.ts` 1개 |
| 출력 골든마스터 | renderers 스냅샷 1파일 | `packages/web/assets/js/__tests__/__snapshots__/renderers.test.ts.snap` |
| web typecheck baseline | **0 에러** (exit 0) | `bun run --cwd packages/web typecheck` (= `tsc --noEmit -p tsconfig.json`) |
| tsconfig | `strict:false` + `checkJs:true` + `allowJs:true` | `packages/web/tsconfig.json:11` (strict), `:9` (checkJs) |
| tsconfig include/exclude | `include: assets/js/**/*.js,*.d.ts`, `exclude: __tests__/**` | `packages/web/tsconfig.json:23-24` |
| CI 타입 게이트 | **web typecheck = blocking** (continue-on-error 제거됨) | `.github/workflows/test.yml:32-46` (`web-typecheck` job, R5에서 181→0) |
| innerHTML | **130건** | `grep -rn innerHTML packages/web/assets/js --include='*.js' | wc -l` |
| design-system | **30개 .js**, 7 서브디렉토리 | `packages/web/assets/js/design-system/{badges,chips,feedback,icons,markers,primitives,stats}` |
| 최대 파일 | settings-view 1590 · meta-docs-view 1370 · meta-docs-flow 1157 · session-detail/turn-views 1117 · main 1036 · llm-input-view 902 · chart 462 · api 443 | `find ... | xargs wc -l | sort -rn` |
| `state.js` | 82줄, **import 0건**(순수 leaf) / **13개 모듈이 import**(고 fan-in) | `state.js` import 없음 · `grep -rln state.js` = 13 |
| `api.js` | 443줄 / **11개 모듈이 import** | `grep -rln api.js` = 11 |
| `sse.js` | 64줄 / **`main.js`만 import** (단일 소비처) | `grep -rln sse.js` = `main.js` |
| R5 타입 인프라 | `globals.d.ts`+`dom.js` 헬퍼 존재, `render/` 8파일(@ts-check) | `packages/web/assets/js/{globals.d.ts,dom.js}` · `render/{badges,cells,expand,extract,icons,model,rows,skeleton}.js` |

**대안 C의 안정화상 함의**: buildless 정체성 폐기 + Vite 도입은 "전역 인프라 약점(빌드 파이프라인 부재)"이 약점 #1이 된다. 기존 회귀 보루(`bun test` 174개 + 스냅샷 + CI blocking typecheck 0)는 **마이그레이션 내내 깨지면 안 되는 불변식**이다. 따라서 Vite 도입 시 기존 12개 테스트가 Vite/Vitest 환경에서도 동일하게 green이어야 하고, 스냅샷이 1:1 보존되어야 한다.

---

## 1. 약점 분해 + 마스터 보드

거대 요구("web 전체를 React+Vite+TS strict로 풀 마이그레이션")를 **독립 검증·롤백 단위**의 약점 N개로 분해한다. 각 약점 = 1 사이클(6단계). 파일/소비처 결합을 근거로 병렬/직렬 그룹을 정한다.

상태 범례: ⬜ Pending · 🟡 In Progress · ✅ Done · ↩️ Reverted · 🔁 Redefined · ✅C Closed(불필요/보류)

| ID | 약점 (대상 1개) | 의존(blockedBy) | 병렬 그룹 | 격리(워크트리) | 상태 |
|----|------------------|------------------|-----------|----------------|------|
| **W0** | Vite+TS(strict) 빌드 파이프라인 도입 + Vitest로 12 테스트 이식(스냅샷 1:1) | — | G0 (선행, 단독) | `wt-w0-buildchain` | ⬜ |
| **W1** | Zustand 전역 스토어 (`state.js` 82줄 흡수, localStorage 영속) | W0 | G1 (코어) | `wt-w1-store` | ⬜ |
| **W2** | `api.js`(443줄) 사이드이펙트 제거 → Raw Data 반환 (데이터 흐름 역전) | W0, W1 | G1 (코어) | `wt-w2-api` | ⬜ |
| **W3** | design-system 30개 → Stateless 컴포넌트 (icons 21·primitives·markers·badges·chips·feedback·stats) | W0 | **G2 (독립·병렬)** | `wt-w3-ds` | ⬜ |
| **W4** | `render/` 8파일(@ts-check 셀/행/배지) → 컴포넌트, renderers 스냅샷 회귀 검증 | W0, W3 | G2 | `wt-w4-render` | ⬜ |
| **W5** | `settings-view.js` 1590줄 폼 서브컴포넌트 분해 → React | W0, W1 | **G3 (독립·병렬)** | `wt-w5-settings` | ⬜ |
| **W6** | `chart.js`(462)+`context-chart.js`(440) `useRef` 캔버스 캡슐화 | W0 | **G4 (독립·병렬)** | `wt-w6-charts` | ⬜ |
| **W7** | `left-panel.js`(195)+`session-detail/`(turn-views 1117 등) DOM 분해, 스토어 결합 | W0,W1,W2,W4 | G5 (결합) | `wt-w7-session` | ⬜ |
| **W8** | `meta-docs-view.js`(1370)+`meta-docs-flow.js`(1157) 모놀리식 해체(flow/table/search) | W0,W1 | G6 (결합) | `wt-w8-metadocs` | ⬜ |
| **W9** | `useSSE` 커스텀 훅 (`sse.js` 64줄, ping/cleanup) | W0,W1 | G7 (단일소비처) | `wt-w9-sse` | ⬜ |
| **W10** | `main.js`(1036줄) 폐기 → React Router v6 레이아웃 + 진입점 통합 | **W1~W9 전부** | G8 (최종 통합) | `wt-w10-router` | ⬜ |
| **W11** | 전 파일 `.ts/.tsx` 전환 + `strict:true` 승격 (checkJs 0 baseline에서) | W10 | G9 (최종) | `wt-w11-strict` | ⬜ |
| **W12** | `React.memo`/`useMemo`/가상스크롤 성능 (over-eng 후보, 측정 선행) | W10 | G9 | `wt-w12-perf` | ⬜ |

분해 근거:
- **state.js는 import 0이지만 fan-in 13** → 순수 leaf가 아니라 **공유 도메인 코어**(`reference-classification.md` 분류). W1(스토어)을 먼저 안정화하지 않으면 W5/W7/W8/W9가 모두 옛 상태 체인에 결합된 채로 전환된다. 그래서 W1은 G2/G3/G4 병렬 트랙의 **선행 의존**이 아니라(병렬 가능), 스토어를 소비하는 트랙(W5/W7/W8/W9)의 선행 의존이다.
- **api.js fan-in 11** → 마찬가지로 코어. W2를 W1 뒤에 직렬 배치.
- **sse.js는 main.js 단일 소비처** → 결합이 좁다. W9는 독립성 높음.

---

## 2. 워크트리 의존성 트리 (분석→테스트→실행)

각 약점은 `dependency-analyst`(read-only, 메인에서 병렬) → 특성화/스냅샷 테스트(선행) → 실행(전용 워크트리) 순서. 실행은 분석·테스트 통과 후에만 unblock.

```
대안 C (web 풀 마이그레이션)
│
├─ W0 buildchain (Vite+TS strict + Vitest 이식)   [G0 · 선행, 단독 · 다른 모든 것의 blocker]
│    └─ W0-분석(빌드 옵션·jsx·lib·paths) ─▶ W0-테스트(12개 Vitest 통과+스냅샷 1:1) ─▶ W0-실행
│
├─ 코어 트랙 (직렬: 고 fan-in)                      [G1 · 순차 통합]
│    └─ W1 store ─blocks─▶ W2 api역전
│
├─ 독립 트랙 (병렬: 서로 다른 파일군)               [G2/G3/G4 · 별도 워크트리 동시]
│    ├─ W3 design-system  ─▶ W4 render            [G2]
│    ├─ W5 settings-view (분해 선행)               [G3]
│    └─ W6 charts (useRef)                         [G4]
│
├─ 결합 트랙 (코어 의존 → 코어 머지 후 unblock)      [G5/G6/G7]
│    ├─ W7 session-detail  (W1,W2,W4 의존)         [G5]
│    ├─ W8 meta-docs       (W1 의존)               [G6]
│    └─ W9 useSSE          (W1 의존, 단일소비처)    [G7]
│
└─ 최종 통합 (전부 머지 후)                          [G8/G9 · 단일 직렬]
     └─ W10 router(main.js 폐기) ─▶ W11 strict승격 ─▶ W12 perf(측정 후 조건부)
```

**병렬/직렬 판정 기준 (방법론 §2~3)**:
- **독립=병렬**: 서로 다른 파일/패키지를 건드리고 공유 코어를 변경하지 않으면 별도 워크트리에서 동시. → W3·W4(design-system+render), W5(settings), W6(charts)는 코어(state/api)를 *소비*하되 *변경*하지 않으므로 G2/G3/G4 병렬.
- **결합=직렬**: 같은 공유 자원(state 스토어, api, tsconfig, 진입점 main.js)을 변경하는 실행은 **머지 시점 순차 통합**. → W1→W2(코어), W7/W8/W9는 코어 머지 후, W10은 전부 머지 후.
- **혼용 금지**: 모든 실행 트랙은 `git worktree add`로 통일. `git checkout -b`(브랜치 전환) 혼용 시 stash 충돌·미커밋 유실 (`reference: gates-and-noise.md`, methodology §3).

---

## 3. 6단계 사이클을 React 마이그레이션 약점에 매핑

각 약점이 `stabilization-cycle`의 6단계를 어떻게 통과하는지. 게이트 통과 시에만 다음 단계.

### 단계 1. 분석 (추측 금지, 파일:라인) — `dependency-analyst` read-only 병렬 위임
- 대상이 **무엇을 import / 누가 import**하는지 전수 추적. 예: W1은 `state.js` import 0 + 소비처 13 (위 baseline) → 코어로 분류.
- 역참조 4종 분류(`reference-classification.md`): state/api는 **공유 도메인 코어** → top-down 강행 금지, 코어(스토어)부터 bottom-up.
- innerHTML 130건은 약점별로 어느 파일에 몇 건인지 매핑(분석 산출물). 의도적 출력은 renderers 스냅샷이 골든마스터로 고정 중.
- **GATE-A**: 결론이 표면 grep이 아니라 실제 import 그래프인가? 디렉토리 grep 착시(design-system 서브디렉토리 간 가짜 순환 등) 배제했는가?

### 단계 2. 테스트 우선 (현재 동작 고정) — **TDD, 테스트가 React보다 먼저**
- **W0가 결정적**: Vite/Vitest로 전환 시 기존 12 테스트가 동일 환경에서 green이어야 함. 이식이 곧 특성화 테스트.
- 컴포넌트 전환 약점(W3/W4/W7): **renderers 스냅샷이 이미 골든마스터** (`renderers.test.ts.snap`, 20 snapshots). React 컴포넌트는 **동일 입력→동일 HTML 출력**을 이 스냅샷으로 검증. I18n·Date.now 모킹으로 결정론 확보됨.
- 테스트 공백 함수는 특성화 테스트 신규 작성: 의도적 오답으로 **red 확인**(테스트 생존 증명) → 현재 출력으로 기대값 고정.
- **GATE-B**: 변경 표면이 테스트로 덮였는가? red→green 확인? (테스트 없는 함수 변경·추출 금지)

### 단계 3. 격리 (워크트리)
- 약점별 전용 워크트리(2절 표의 `wt-*`). 메인 작업 디렉토리·미커밋·타 브랜치 불가침.
- 병렬 그룹(G2/G3/G4)은 전부 워크트리로 통일.

### 단계 4. 실행 (동작 보존)
- 순수 이동은 `git mv`(100% rename = 로직 무변경 증거). 단, React 전환은 *로직 변환*이므로 "동일 출력"이 동작 보존의 기준(스냅샷/특성화 테스트로 증명).
- 셀렉터 계약 유지: 기존 DOM의 주요 ID·CSS class·`data-session-id` 등 기능적 속성을 JSX에 1:1 유지(향후 E2E 도입 대비, master-prompt §2-1).
- 작은 커밋 = 롤백 단위. 약점 1개 안에서도 파일/서브컴포넌트 단위로 분할 커밋.

### 단계 5. 검증 게이트 (회귀 0) — **4절에서 상술**
- typecheck baseline(0 에러) 유지 증분 0 + `bun test`/Vitest 174 전량 통과 + 스냅샷 일치 + 거짓통과 검증.

### 단계 6. over-engineering 가드 (3자문) — 커밋 전 기록
- (a) 이 변경이 실제 결합/위험을 줄였나, 간접 계층만 늘렸나?
- (b) 분리 경계가 향후 변경을 쉽게 하나, 파일만 옮겼나?
- (c) 기존 동작·테스트·이벤트 흐름 100% 동일한가?
- **특히 W12(perf)**: React.memo/가상스크롤은 *측정된 성능 문제가 없으면* over-engineering. 고주기 SSE 스트림에서 실제 프레임 드랍·렌더 비용을 측정한 뒤에만 도입. 측정 없으면 "변경 불필요"로 종결이 정당한 결과.

---

## 4. 회귀 0 검증 게이트 (절대 조건)

**게이트 통과 못 하면 머지하지 않는다.** 매 약점 머지 직전 + 매 머지 직후 전체 재실행 (`gates-and-noise.md`).

### 게이트 3종 + 1 (대안 C 특화)

1. **타입 게이트** — `bun run --cwd packages/web typecheck` 에러 **증분 0** (baseline = 0, `tsconfig.json` 기준). W0~W10은 `strict:false`+`checkJs` baseline 유지, W11에서만 `strict:true`로 승격하며 strict 한정 위반을 0으로 줄이는 것이 약점 목표. CI `web-typecheck` job이 blocking이므로 PR 단위로 자동 강제됨(`test.yml:32-46`).
2. **동작 게이트** — `bun test packages/web/` (또는 W0 이후 Vitest 등가) **174 pass / 0 fail 유지**. 신규 컴포넌트/훅에는 대응 테스트 동반 추가(통과 수는 증가하되 fail 0 불변).
3. **스냅샷 게이트** — `renderers.test.ts.snap` **20 snapshots 1:1 일치**. 출력이 의도적으로 바뀌어야 할 때만 `bun test --update-snapshots` 후 **갱신 사유를 커밋 메시지에 명시**. 무단 갱신 금지.
4. **거짓 통과 검증** (대안 C 필수 — 빌드 도구 교체로 검사 누락 위험↑):
   - 새 `.ts/.tsx`가 typecheck 대상에 실제 포함됐는지 의심될 때, 의도적 타입에러(`const x: number = "s"`) 일시 주입 → typecheck가 그 파일을 잡는지 확인 → 잡으면 진짜 통과, 안 잡으면 include 누락(거짓 통과). 확인 후 즉시 복원. (`gates-and-noise.md` 스크립트 패턴)
   - Vitest 이식 후: 12개 테스트가 *실제로 실행되는지* 확인(파일 수 12 + 통과 수 174가 baseline과 일치). 0건 실행인데 "0 fail"이면 거짓 통과.

### IDE diagnostic은 노이즈, 빌드 도구가 진실
Vite 도입·`bun install`/패키지 추가 직후 IDE가 `Cannot find module` 등을 대량 출력 → TS server 재인덱싱 과도기 노이즈. **`tsc`/Vitest CLI 출력만 진실.** baseline 대비 증분 0 + 거짓통과 검증 통과면 노이즈 확정, 코드를 고치지 않는다.

### 게이트 실패 시 → git bisect 회귀 추적

회귀(테스트 fail 발생·스냅샷 불일치·typecheck 증분>0)가 머지 후 감지되면:

1. **good/bad 고정**: `git bisect start` → `git bisect bad`(현재) → `git bisect good <마지막 게이트 통과 커밋>`. 마지막 통과 커밋은 마스터 보드 진행 로그(6절)에 1줄씩 기록된 게이트-pass 커밋 SHA를 사용.
2. **자동 이분 탐색**: 게이트를 스크립트화해 `git bisect run`. 회귀 종류별 판정 명령:
   - 테스트 회귀: `git bisect run bash -c 'cd <repo> && bun test packages/web/ 2>&1 | grep -q "0 fail"'`
   - 타입 회귀: `git bisect run bash -c 'bun run --cwd packages/web typecheck'` (exit 0이 good)
   - 스냅샷 회귀: `git bisect run bash -c 'cd <repo> && bun test packages/web/ 2>&1 | grep -q "0 fail" && ! bun test packages/web/ 2>&1 | grep -q "snapshot.*failed"'`
3. **작은 커밋이 bisect 해상도**: 약점 안에서도 서브컴포넌트 단위로 커밋을 쪼개야 bisect가 원인 커밋을 좁게 짚는다. 거대 단일 커밋은 bisect 무력화 → 단계 4의 "작은 커밋" 원칙이 bisect 운용의 전제.
4. **원인 커밋 특정 후**: `git bisect reset` → 해당 커밋만 워크트리에서 revert 또는 fix-forward(테스트 우선). 재발 방지 규칙을 stabilization-cycle references에 박제(methodology §5 피드백 루프).

---

## 5. 머지 전략 (worktree → main 통합 순서)

선형 히스토리 유지(`ff` 또는 `cherry-pick`). 매 머지 후 전체 게이트 재실행. 공유 자원 변경 트랙은 가장 깨끗한 것부터 순차.

### 통합 순서 (의존성 위상정렬)

```
1. W0 (buildchain)         ── 모든 것의 blocker. 단독 머지 후 전체 게이트.
                              여기서 174 pass/0 fail/20 snap/typecheck 0이 Vite 환경에서 재현돼야 함.
2. W1 (store)              ── 코어 첫 통합. fan-in 13이므로 가장 먼저.
3. W2 (api 역전)           ── W1 위에 직렬. 코어 두 번째.
   ───────── 여기까지 코어 안정 → 병렬 트랙 unblock ─────────
4. 병렬 머지 (순차 통합, 가장 깨끗한 것부터):
     W3 design-system → W4 render → W6 charts → W5 settings
     (서로 다른 파일군이라 충돌 적음. 각 머지 후 게이트.)
5. 결합 트랙 (코어 머지 완료 후):
     W9 useSSE(단일소비처 → 가장 좁음, 먼저) → W8 meta-docs → W7 session-detail
6. W10 (router, main.js 폐기) ── 전 약점 머지 완료 후 단독. 진입점 단일 통합 지점.
7. W11 (strict 승격)       ── W10 후. tsconfig strict:true 변경은 전 파일 영향 → 최후.
8. W12 (perf)              ── 측정 후 조건부. 불필요하면 종결(over-eng 가드).
```

### 머지 규약
- **사전 확인**: `git merge-base --is-ancestor origin/main main`으로 머지 가능성 점검 (methodology §3).
- **사용자 작업 불가침**: main 작업 디렉토리가 dirty하거나 타 브랜치(사용자 동시작업)면 즉시 멈추고 보고 → **별도 워크트리에서 target 체크아웃해 머지**. 미커밋·타 브랜치 절대 미접촉.
- **공유 자원 충돌 최소화**: `tsconfig.json`을 건드리는 약점은 W0(설정 추가)·W11(strict)뿐 → 두 시점에만 격리. `main.js`는 W10 단일 → 충돌원 제거.
- **push는 outward** → 게이트 통과 + 사용자 승인 후에만.

---

## 6. 마스터 보드 진행 로그 (사이클별 1줄 누적)

각 약점 종료 시 1줄: `<ID> | 결론유형(실행/보류/불필요/버그수정) | 게이트(typecheck 증분/테스트 회귀/스냅샷) | over-eng 3답 | 게이트-pass 커밋 SHA(bisect good 기준점)`.

| 시각 | ID | 결론 | typecheck 증분 | 테스트 회귀 | 스냅샷 | over-eng (a/b/c) | pass SHA |
|------|----|------|-----------------|-------------|--------|-------------------|----------|
| (실행 시 기록) | — | — | — | — | — | — | — |

**메트릭 추적**: 사이클당 실행/보류/불필요/버그 비율. **보류·불필요 비율이 높을수록 분석이 잘 작동** = 불필요 작업 차단(프레임워크 핵심 가치, methodology §5). 특히 W12(perf)는 측정 없이 도입하면 over-eng → "불필요" 결론이 정당.

---

## 7. 분기 규칙 요약 (실행 중 적용)

- **leaf 아님(state/api fan-in 高)** → 추출 강행 금지. 코어(W1 store)부터 bottom-up, 소비 트랙은 코어 머지 후 unblock.
- **착시(design-system 서브디렉토리 가짜 순환 등)** → 모듈 그래프 검증 후 "순환 아님 → 변경 불필요" 종결.
- **버그 발견** → 진짜 버그(데이터 손실/오계산/오표시)면 테스트 우선 수정(red→green, 스냅샷 갱신 사유 기록), 표현 선택(코드베이스 관례)이면 유지. 소비처까지 추적해 판정.
- **사용자 동시작업 감지** → 자율 진행이라도 멈춤 우선 + 보고 + 별도 워크트리 우회.
- **W0가 막히면 전체 보류**: Vite 환경에서 12 테스트·스냅샷·typecheck 0이 재현 안 되면 후속 전 약점 blocked. W0는 마이그레이션의 단일 실패점이므로 가장 보수적으로 검증.

---

## 8. 산출물·체크포인트

- 각 약점 종료 시: `bun test` 통계(pass/total/snapshot 일치) + 신규 테스트(Store/Component/Hook) + Gap Report 목록.
- 모호 지점(스키마 불명·레거시 DOM 숨은 의도): 임의 추측 구현 금지 → 해당 워크트리에 `.migration-gap-report.md`/`.architecture-decision.md` 생성, 휴먼 검증 포인트 기록 (master-prompt §3-3).
- E2E(Playwright)는 현재 0건. 신규 도입 결정 시 **별도 비용 페이즈**로 분리(보루는 여전히 `bun test`).
