# 되돌리기 안전성 검토 (review-safety)

> 역할: 되돌리기 안전성 검토자 — 각 task 가 worktree 격리·TDD 테스트우선·git bisect·회귀0 게이트로 실제 되돌릴 수 있는지 검증.
> 대상: `claude-spyglass` `docs/react-migration/{tasks.json, README.md}` + 근거 패널(`_panel/tdd.md`, `_panel/dependency-safety.md`).
> 검증 시점 실측 HEAD: `1992b54` (tasks.json baseline `2126e11` 과 불일치 — 아래 BLK-1).
> 검증 방식: tasks.json·README 의 모든 되돌리기 전제를 실제 소스/게이트 스크립트와 1:1 대조. 추측 금지, 근거 파일:라인 첨부.

---

## 0. 한 줄 결론

전체 골격(bottom-up DAG 추출 순서·5형 테스트 계승·worktree 격리·Tidy First 커밋 분리)은 **되돌리기 안전성 측면에서 건전**하다. 단 **빅뱅 환원 불가 task 2개**(P4-06 main.js, P4-07 entry), **bisect 무력화 요인 3개**(baseline SHA 3종 불일치·web 단독 test 스크립트 부재·러너 결정 미정), **정적 게이트 거짓안심 2개**(DEP가 web→types 강제 못 함·KEBAB web 무커버리지), **테스트 공백/전제 stale 2개**(parseToolDetail SSoT 이중화·D형 스냅샷 러너 직렬화 위험)를 머지 전에 닫아야 회귀 0이 성립한다.

게이트 부재로 인한 거짓통과(green인데 실제론 회귀)가 worktree·bisect 보다 더 큰 위험이다.

---

## 1. Blocker — 되돌리기 안전성을 깨는 선결 결함

### BLK-1. baseline HEAD 3종 불일치 → `git bisect good <SHA>` 앵커 붕괴 [회귀추적 치명]

bisect 의 핵심은 "마지막 known-good 커밋"을 정확히 지목하는 것이다. 그런데 문서마다 기준 커밋이 다르다:

| 출처 | 주장 baseline | 근거 |
|------|--------------|------|
| `tasks.json` `baseline.head` | `2126e11` | tasks.json:14 |
| `_panel/dependency-safety.md` | `2126e11` | 검증 HEAD 선언 |
| `_panel/tdd.md` | `9b939d5` | 근거 기준점 |
| **실측 현재 HEAD** | **`1992b54`** | `git log --oneline -1` |

`README.md §3` 의 `git bisect good <마지막 게이트-pass 커밋 SHA>` 가 어느 SHA 를 가리키는지 문서 간 합의가 없다. baseline 이 틀리면 bisect 가 회귀 없는 구간을 bad 로, 회귀 구간을 good 으로 오판한다.
**조치**: 실제 마이그레이션 착수 직전 HEAD 를 단일 SSoT 로 고정하고 모든 문서/게이트 스크립트가 동일 SHA 를 참조하도록 통일. tasks.json `baseline` 은 실측치(174 pass/12 files/20 snap/typecheck0)는 현 HEAD `1992b54` 에서 재확인됨 — 수치는 유효하나 **SHA 라벨만 stale**.

### BLK-2. web 단독 `bun test`/빌드 스크립트 부재 → bisect run 명령 비결정 [회귀추적]

`README §3` 의 bisect 게이트와 `regression_gate` 는 `bun test packages/web/` · `bun run --cwd packages/web typecheck` 를 전제한다. 실측:

- `packages/web/package.json` `scripts` 에는 **`typecheck` 1개뿐** — `test`·`dev`·`build`·`preview` 없음.
- 루트 `package.json` 은 `"test": "bun test"`(전 패키지). `bun test packages/web/` 는 경로 인자라 동작은 하나, **web 스코프 단독 게이트가 스크립트로 고정돼 있지 않다.**
- P1-01 `done_criteria` 가 `dev/build/preview` 스크립트 추가를 요구하지만, **bisect 게이트가 이 스크립트들을 P1-01 머지 전부터 참조하면**(P1-01 이전 커밋엔 스크립트 없음) `git bisect run` 이 P1-01 이전 구간에서 전부 비정상 종료 → bisect 가 "스크립트 부재"를 회귀로 오분류.

**조치**: bisect run 게이트 명령은 **경로 인자형**(`bun test packages/web/`, `tsc --noEmit -p packages/web/tsconfig.json`)으로 baseline 전 구간에서 동작하는 형태로 고정. 패키지 스크립트는 편의용일 뿐 게이트 SSoT 가 아님을 README §3·§4 에 명시.

### BLK-3. 테스트 러너 결정(P1-06 vs tdd.md) 충돌 → 보루 분열 위험 [TDD/회귀게이트]

- `tasks.json P1-06` 과 `README §7 Gap 3`: **"기본은 bun test 유지, Vitest 전환은 휴먼 결정(Gap)"**.
- `_panel/tdd.md §1`: **"대안 C 는 Vitest 로 통일, bun test 잔존 시 보루 분열"** — 이미 Vitest 전환을 Tidy 커밋으로 박는 절차까지 기술.

두 문서가 정반대다. 러너가 미정인 채 D형 스냅샷(BLK-5)·B형 fake timer 테스트를 전환하면, **나중에 러너를 바꿀 때 20 스냅샷·sse fake timer 가 재직렬화/재작성되어 "회귀 0 비교"의 기준선 자체가 흔들린다.** 러너 전환은 되돌리기 관점에서 **모든 테스트의 기준선을 동시에 흔드는 빅뱅**이므로 P1(인프라)에서 단일 결정으로 확정해야 한다.
**조치**: P1-06 을 "러너 결정"을 **명시적 선결 게이트**로 승격(P1-01 직후, P1-04 이전). bun test 유지로 확정하면 tdd.md §1 의 Vitest 절차를 폐기, Vitest 채택 시 BLK-5 스냅샷 재생성을 P1 안에서 1회 수행하고 그 diff 를 휴먼 검증.

### BLK-4. 정적 아키텍처 게이트의 거짓안심 — DEP 가 "web→types only" 를 강제하지 못함 [정적게이트]

`README §6`·`tasks.json static_gate` 는 "web 은 `@spyglass/types`(rank0)만 import" 를 정적 게이트로 보장한다고 명시. 실측 `check-architecture.sh`:

- `rank_of` 매핑: `types=0 … web=4` (스크립트 본문 SSoT).
- DEP 검사는 **importer rank ≤ imported rank(역방향/동일층)만** emit. web(4)이 `@spyglass/storage`(1)·`server`(3)·`metrics`(2) 를 import 해도 **rank<4 = 정방향 = 통과**.

즉 "web 은 types 만" 은 **컨벤션일 뿐 스크립트가 막지 않는다.** 클라이언트가 server/storage 를 실수로 import 해도 게이트가 green → 되돌릴 신호 자체가 안 뜸. 백엔드 무수정·클라이언트 격리 원칙(mission)이 정적으로 깨질 수 있다.
**조치**: (a) `check-architecture.sh` 에 "web/desktop/tui 는 types 외 @spyglass import 금지" 규칙을 신규 추가하거나, (b) tasks.json/README 가 "이 제약은 정적 게이트가 아닌 휴먼/리뷰 검증"임을 정정. 현 문구는 보장 수준을 과장.

### BLK-5. D형 골든마스터(renderers 20 snapshot)의 러너 직렬화 함정 [회귀게이트 핵심]

`renderers.test.ts.snap` 헤더는 `// Bun Snapshot v1`(tdd.md §9 확인). 회귀 0 의 3번째 게이트가 이 20개 1:1 일치다. 위험:

1. 러너를 Vitest 로 바꾸면(BLK-3) 스냅샷 직렬화 규칙이 달라 **전 20개가 한 번에 깨진다** — bisect 가 "어느 컴포넌트 전환이 회귀냐"를 못 가린다(러너 교체 커밋이 전부를 오염).
2. React `renderToStaticMarkup` 는 `class`→`className`·자기닫힘 태그·속성 순서가 Vanilla 문자열과 미세 상이(tdd.md §4-2 경고). P2-04 test_strategy 의 "정규화 후 비교(단 data-*/id/class 토큰 제외)" 는 옳은 방향이나, **정규화 헬퍼 자체가 검증되지 않으면 위양성(실제 회귀를 정규화가 삼킴)** 위험.

**조치**: (a) 러너 확정(BLK-3) 후 스냅샷 1회 재생성·diff 휴먼 검증을 P1 게이트로. (b) P2-04 의 정규화 헬퍼에 "의도적 셀렉터 변형 주입 → 정규화가 그걸 잡는지" 거짓통과 검증 테스트를 동반(tasks.json 의 거짓통과 검증 원칙을 정규화 헬퍼에도 적용).

---

## 2. 빅뱅(되돌리기 어려운) task 식별

작은 커밋·revert 단위로 환원 가능한지 기준. **환원 단위가 "기능 전체"이거나 "수동 verify 에만 의존"하면 빅뱅.**

| task | 빅뱅 사유 | 되돌리기 난이도 | 완화책 |
|------|----------|----------------|--------|
| **P4-06** main.js 폐기→React Router | main.js 는 sink(역참조 0, dependency-safety §1.2)라 "통째 교체"가 안전 방향이나, **교체 자체가 단일 거대 전환**. 자동 게이트가 아닌 **수동 verify(3모드·init 순서·tooltip/resize/SSE)** 에 의존(test_strategy 명시). 부분 revert 불가 — 라우터냐 main.js냐 이분법. | **높음** | depends_on(P3-03·P4-03·P4-05·P3-08) 전부 머지·게이트 통과 후 단독 worktree. revert 단위 = 이 커밋 전체. **수동 verify 체크리스트를 사전 문서화**(Gap)해 재현 가능한 회귀 판정 기준 확보. |
| **P4-07** index.html 진입 전환 | FOUC/lang 인라인·classic i18n 3종·SPA fallback 동시 전환. `bun test` 영향 0 = **자동 게이트 사각**. 전부 수동 verify. dispatch SPA fallback 1분기는 백엔드 접근(P1-02 휴먼 경계). | **높음** | P4-06 직후. 병존 종료(classic i18n·main.js 제거)는 **비가역에 가까움** — 되돌리려면 entry+라우터 동시 revert. lang 우선순위 4종·SPA fallback 수동 시나리오를 사전 고정. |
| **P3-03** api.js 데이터 역전 | 9개 render 사이드이펙트 제거 = 데이터 흐름 역전 핵심. **그러나 되돌리기 설계는 우수**: Tidy 4단계(A 특성화→B 어댑터 refactor→C 스토어 치환 feat→D 역참조0)로 9개 사이트별 작은 커밋. | 중(설계로 완화됨) | 이미 bisect 해상도 확보됨. 단 B(refactor)와 C(feat) 사이 **중간 상태가 화면 정상 동작해야** 부분 revert 가능 — 중간 커밋도 게이트 통과 필수임을 명시. |
| **P5-02** strict:true 단일화 | tsconfig 전역 1줄 변경이 전 파일 typecheck 동시 영향. 되돌리기는 1줄 revert 라 **기술적으론 쉬우나**, strict 위반이 다수 파일에 분산되면 fix-forward 가 거대해짐. | 중 | P5-01(전 파일 .ts/.tsx) 완료가 전제. tsconfig 변경은 P1-01·P5-02 단 2시점(README §5)이라 충돌원 격리됨 — 양호. |

**판정**: 진성 빅뱅은 **P4-06·P4-07 2개**. 둘 다 자동 회귀 게이트(bun test) 사각이고 수동 verify 의존 → **회귀 0 보장의 실질적 구멍**. 완화의 핵심은 "수동 verify 체크리스트의 사전 문서화 + 재현성"이며, 현 tasks.json 은 verify 항목을 나열만 하고 **판정 기준(통과/실패 결정 규칙)을 명시하지 않음** → Gap.

---

## 3. 테스트 공백 / TDD 전제 stale

### GAP-1. parseToolDetail SSoT 이미 이중화 — P3-05/tdd.md §6 전제 stale [TDD]

tdd.md §6·P3-05 는 "parseToolDetail 가 **테스트 파일에 인라인 복제**(index.html 추출본), 선행 Tidy 로 `src/lib/parse-tool-detail.ts` 추출" 을 전제. 실측:

- `parseToolDetail.test.ts:9-24` 에 **여전히 인라인 복제** 존재(`function parseToolDetail` 직접 정의, import 아님).
- **동시에** `render/extract.js:212` 에 `export function parseToolDetail` 이 **이미 존재**(turn-rows/flat-view 소비, extract.js:6 주석).

즉 SSoT 가 이미 **2곳으로 분기**돼 있다(테스트 인라인 ≠ extract.js export). P3-05 의 Tidy 가 `src/lib/parse-tool-detail.ts` 로 추출하면 **3번째 사본**이 되거나, extract.js 본을 무시. 두 사본이 현재 **동작 동일한지 미검증** — 다르면 "10케이스 통과"가 extract.js 의 실제 동작을 보증하지 못한다(테스트가 자기복제본만 검증).
**조치**: P3-05 선행 Tidy 를 "인라인 복제 → `render/extract.js` 의 export 를 import 하도록 교체(추출 아닌 **재연결**)"로 정정. 두 사본 동작 동치를 먼저 확인(diff 또는 양쪽 입력 동일 출력 테스트) 후에만 단일화. tasks.json P3-05 `path`/test_strategy·tdd.md §6 갱신 필요.

### GAP-2. 수동 verify task 의 판정 기준 부재 [회귀게이트]

P3-01(canvas resize/redraw)·P4-06(3모드)·P4-07(FOUC/lang/SPA)·P5-04(프레임 드랍)·P5-05(가시영역)는 **수동 verify 가 유일/주요 게이트**. tasks.json 은 verify 대상을 나열하나 **"무엇을 보면 통과/실패인지"의 결정 규칙이 없음**. 수동 게이트는 판정 기준이 없으면 회귀 0 을 증명할 수 없고 bisect 도 불가(자동 exit code 없음).
**조치**: 각 수동 verify task 에 **재현 시나리오 + 기대 관측치**를 사전 체크리스트로 Gap 문서화. 가능하면 webapp-testing(Playwright) 도입을 별도 비용 페이즈로 분리해 수동→자동 전환(master-prompt §6 이미 허용).

### GAP-3. 신규 cleanup 계약(P3-02·P4-04)은 회귀가 아닌 신기능 — bisect 무의미 [TDD, 양호하나 명시 필요]

- `left-panel.js:37` 은 `addEventListener` 만 있고 **removeEventListener 없음**(실측) → 언마운트 cleanup 은 **원본 미보장 신규 계약**(tdd.md §5·§3-2, README §7-6 정확).
- `sse.js:33-34,57` 은 재호출 시 close+clearTimeout 하나, **외부 명시 close API 없음** → useSSE 언마운트 cleanup 도 신규.

이 신규 Red 테스트들은 **baseline 에 대응 케이스가 없어** bisect 의 "good 기준"이 존재하지 않는다(원본은 이 테스트가 항상 fail). 되돌리기 관점에서 정상이나, **회귀 0 정의(README §4 "174 pass 유지")와 분리 추적**해야 함 — 신규 케이스 통과 수 증가는 "회귀"가 아니라 "신계약". tasks.json 은 이를 Gap 으로 정확히 분류함(양호). 단 README §4 의 "174 pass / 0 fail 유지" 문구에 **"신규 케이스는 별도 카운트"**를 명시해 거짓 회귀 경보 방지.

### GAP-4. 특성화 테스트 0 → "현재 동작 고정"의 결정론 미검증 [TDD]

chart.js·session-detail·settings-view·meta-docs-view 는 직접 테스트 0(dependency-safety §6). README §2 는 "변경 전 특성화 테스트 신규(의도적 오답 Red 후 현재 출력 고정)"를 요구. 위험: 이 표면들은 **결정론 조건(Date.now/I18n 모킹 등)이 renderers 처럼 정리돼 있지 않음** → 특성화 스냅샷이 비결정적이면 고정 자체가 흔들려 되돌리기 기준선이 무의미.
**조치**: 특성화 테스트 작성 시 renderers.test.ts 의 모킹 패턴(Date.now/I18n 고정, tdd.md §4-1)을 동일 적용. 결정론 미확보 표면은 "골든마스터 부적합 → 수동 verify"로 명시 강등.

---

## 4. 위험 결합(worktree 격리로도 안 끊기는 지점)

### CPL-1. KEBAB 게이트 web 무커버리지 — 첫 src/ 커밋이 첫 노출 [정적게이트]

`check-architecture.sh` KEBAB 은 `find packages/*/src -type d` 스캔. 실측 `packages/web/src` **부재** → web 은 현재 **게이트 무적용**. README §6 "src/ 신설 순간 처음 적용"은 사실이나, **이전 검증 이력 0** 이므로 P1-01·P2-01 의 첫 `src/components/...` 생성 커밋이 게이트의 첫 실전. PascalCase 디렉토리(예: `Components/`) 1개 슬립이 즉시 Blocker. worktree 격리로 안 끊김(스크립트 미실행 시 통과).
**조치**: P1-01 worktree 에서 **빈 `packages/web/src/` 생성 직후 `check-architecture.sh` 1회 실행**을 done_criteria 에 추가(게이트 가동 확인). 커밋 전 훅(`.githooks/`)에 포함됐는지도 확인 — 현 `.githooks/` 는 `post-push`·`doc-sync-prompt.md` 뿐이라 **pre-commit 자동 강제 없음** → check-architecture 는 수동/CI 호출 의존.

### CPL-2. 코어 머지 직렬 구간의 게이트 재실행 누락 위험 [회귀게이트]

README §5 머지 순서는 "매 머지 후 전체 게이트 재실행"을 규정(양호). 위험은 **병렬 worktree 4트랙(P2-01~04 ∥ P2-05~07 ∥ P2-08 ∥ P3-01)이 각자 P1-04 store 기준으로 분기**한 뒤, 머지 시점에 store 가 후속 커밋으로 바뀌어 있으면 **각 트랙의 "머지 전 게이트 통과"가 stale**해짐. worktree 는 파일 격리는 주지만 **공유 코어(store)의 시점 일관성은 보장 안 함**.
**조치**: 병렬 트랙은 머지 직전 **main 의 최신 store 로 rebase 후 게이트 재실행**을 머지 규약(README §5)에 명시. `git merge-base --is-ancestor` 점검만으로는 store 시맨틱 변화를 못 잡음.

### CPL-3. P1-02 백엔드 무수정 경계 — dispatch.ts 변경이 "클라이언트만 교체" 원칙과 충돌 [Gap, 정확히 식별됨]

P1-02·P4-07 은 dispatch.ts 의 WEB_ROOT/mimeMap/SPA-fallback 변경을 "클라이언트 자산 서빙 접합부"로 한정. mission constraint 의 "백엔드 무수정"과 **경계 충돌**을 tasks.json 이 휴먼 검증 포인트로 정확히 격리함(양호). 되돌리기 관점: dispatch.ts 변경은 **서버 패키지 커밋**이므로 web worktree 와 분리된 revert 단위 — 혼선 방지 위해 **별도 커밋·별도 worktree** 강제 필요(현 문서는 P1-02 worktree:false).
**조치**: dispatch.ts 실제 변경(P4-07 fallback 1분기)은 web 트랙과 **분리된 커밋 prefix/worktree** 로 격리해 백엔드 회귀와 클라이언트 회귀를 bisect 가 구분하게 함.

---

## 5. 양호 판정 (되돌리기 안전성 충족 — 유지)

- **추출 순서 DAG**: dependency-safety §3 순환 0 실측 재확인(api↔left-panel·api↔meta-docs·views·session-detail 전부 단방향). bottom-up(state→leaf→design-system→render→코어→api→main)이 매 단계 DAG 유지 → 단계별 revert 가능. **타당**.
- **Tidy First 커밋 분리**: refactor/feat 분리로 bisect 가 "구조 이동 vs 흐름 역전" 격리(README §3, tasks.json commits). api.js 9사이트 분할(P3-03)이 모범. **타당**.
- **5형 테스트 계승 + 케이스 추가/삭제 금지**: 동일 계약 동일 수 보존 → 회귀 비교 성립(tdd.md §0). state 14·sse 8·renderers 20·date-range-storage 12 등 실측 일치. **타당**.
- **공유 자원 변경 2시점 격리**: tsconfig(P1-01·P5-02)·main.js(P4-06 단일)로 충돌원 최소화(README §5). **타당**.
- **api.js 절단선**: render-coupled fetcher 가 main.js 만 소비(실측: extract.js/chart.js/left-panel import 방향 확인) → 5개 range 유틸 소비처 무영향. 역전의 blast radius 가 작음. **타당**.

---

## 6. 머지 전 필수 조치 요약 (우선순위)

| # | 항목 | 분류 | 막는 위험 |
|---|------|------|----------|
| 1 | baseline HEAD 단일 SHA 로 통일(`1992b54` 등 착수 시점) | BLK-1 | bisect 앵커 붕괴 |
| 2 | bisect 게이트를 경로인자형 명령으로 고정(패키지 스크립트 비의존) | BLK-2 | bisect run 비결정 |
| 3 | 테스트 러너 P1 단일 결정(bun test 유지 vs Vitest), tdd.md §1 정합 | BLK-3 | 보루 분열·스냅샷 기준선 흔들림 |
| 4 | DEP 게이트에 "web→types only" 규칙 추가 또는 "휴먼검증"으로 문구 정정 | BLK-4 | 클라이언트 격리 정적 거짓안심 |
| 5 | 스냅샷 러너 직렬화 1회 재생성·정규화 헬퍼 거짓통과 검증 | BLK-5 | D형 골든마스터 위양/위음 |
| 6 | parseToolDetail SSoT 이중화 정정(extract.js 재연결로) | GAP-1 | 테스트가 실동작 미보증 |
| 7 | P4-06/P4-07 수동 verify 판정 기준 사전 체크리스트화 | 빅뱅·GAP-2 | 수동 게이트 회귀0 미증명 |
| 8 | 병렬 트랙 머지 전 store rebase+게이트 재실행 규약화 | CPL-2 | 코어 시점 stale |
| 9 | 첫 src/ 커밋 직후 check-architecture.sh 가동 확인(pre-commit 훅 부재) | CPL-1 | KEBAB 첫 노출 슬립 |

---

## 7. 근거 파일:라인 색인 (재현용)

- baseline 불일치: `tasks.json:14`(2126e11) / `_panel/dependency-safety.md`(2126e11) / `_panel/tdd.md`(9b939d5) / 실측 `git log` → `1992b54`
- web 스크립트: `packages/web/package.json` scripts = `typecheck` 1개. 루트 `package.json` `"test":"bun test"`
- 러너 충돌: `tasks.json` P1-06 + `README §7-3`(bun 유지) vs `_panel/tdd.md §1`(Vitest 통일)
- DEP rank: `.claude/skills/detect-architecture-violation/scripts/check-architecture.sh` `rank_of`(web=4), DEP emit 조건(역방향/동일층만)
- KEBAB scope: 동 스크립트 `find packages/*/src -type d`; `packages/web/src` 부재
- 스냅샷: `renderers.test.ts.snap` 20 엔트리 `// Bun Snapshot v1`; 실측 `bun test packages/web/` = 174 pass/0 fail/20 snapshots
- parseToolDetail 이중화: 인라인 `parseToolDetail.test.ts:9-24` + export `render/extract.js:212`
- left-panel cleanup 부재: `left-panel.js:37` addEventListener only(removeEventListener 없음)
- sse close: `sse.js:16,33-34,52,57`(재호출 close 있음, 외부 명시 close API 없음)
- api.js 9 사이드이펙트: `api.js:276,277,287,291,292,348,349,359,369-370,405`; import `api.js:57,59,69`
- 게이트 훅: `.githooks/` = `post-push`·`doc-sync-prompt.md`(pre-commit 자동 강제 없음)
