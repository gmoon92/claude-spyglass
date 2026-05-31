# 패널 합의/이견 요약 (audit trail)

> 6개 전문가 패널 의견(`_panel/`)의 핵심 합의와 이견을 기록한다. 정본 작업지시서 `react-migration-master-prompt.md`(교정판 v2) 종합.
> 기준 HEAD `2126e11` · v3.0.7. 본 문서는 개발 작업 문서이며 React 코드는 포함하지 않는다.

## 패널 구성

| 패널 | 역할 | 원본 |
|------|------|------|
| task-decomposition | TaskCreate 1:1 등록용 task 분해 | `_panel/task-decomposition.md` |
| dependency-safety | 회귀 0 추출 순서·결합점 판정 | `_panel/dependency-safety.md` |
| tdd | 12 테스트의 React+Zustand 1:1 계승 절차 | `_panel/tdd.md` |
| stabilization | 안정화 오케스트레이션·워크트리·게이트 | `_panel/stabilization.md` |
| architecture | 디렉토리/레이어 경계·정적 게이트·서빙 계약 | `_panel/architecture.md` |
| build-infra | Vite+Bun+React 빌드/패키징/2-모드 | `_panel/build-infra.md` |

---

## 1. 만장일치 합의 (6/6 또는 다수)

### C1. 회귀 보루 = bun test + 스냅샷 골든마스터 (Playwright 아님)
Playwright E2E 미설치. 회귀 검증의 보루는 `bun test` 12 파일(baseline 174 pass/0 fail) + `renderers.test.ts.snap` 20 snapshot. 6개 패널 전원 이 baseline 을 불변식으로 전제. 출력 동일성 검증의 핵심 자산은 스냅샷(I18n·Date.now 모킹으로 결정론 확보).

### C2. 5 페이즈 + bottom-up 추출 순서
인프라/스토어 → 원자 컴포넌트 → 중위험+API역전 → 모놀리식 해체/라우팅 → strict 승격/최적화. 추출은 leaf → 허브 역순:
`state.js → leaf util → sse.js → design-system 30 → render/* → settings-view 분해 → left-panel/session-detail/chart → api.js 역전 → meta-docs-view 분해 → main.js 라우터`.

### C3. 두 개의 최대 결합 위험점
- **api.js 데이터 역전** (9개 render 사이드이펙트 `:276~418`): fetch와 DOM 변이가 한 함수에 묶여 React state와 이중 렌더 충돌. dependency-safety/architecture/task-decomposition 전원 risk high. 핵심 완화: render-coupled fetcher 는 `main.js`만 소비하므로 다른 5 소비처(range 유틸)는 무영향.
- **main.js 진입 허브 폐기** (31 import): sink(역참조 0)이라 위험은 낮으나 모든 자식 컴포넌트화 후 마지막에 통째 교체.

### C4. Tidy First — 구조 변경과 동작 변경 커밋 분리
순수 추출(refactor:)과 데이터 흐름 역전(feat:)을 절대 같은 커밋에 섞지 않음. tdd/architecture/stabilization 전원. 이 분리가 곧 git bisect 해상도. 작은 커밋(서브컴포넌트/사이트 단위)이 bisect 운용의 전제.

### C5. 순환 의존 0 — "순환 끊기"는 변경 불필요
ESM 모듈 단위 전부 DAG. 디렉토리 grep 착시(views/, design-system 서브디렉토리)는 실제 파일 쌍으로 검증 시 전부 단방향. dependency-safety §3 + stabilization §7 + architecture §1.3. 순환 끊기 작업은 존재하지 않음(over-engineering 회피).

### C6. 워크트리 격리 + 회귀 0 게이트 + bisect
모든 실제 구현은 `git worktree add`로 격리(`git checkout -b` 혼용 금지). 3중 게이트(typecheck 증분 0 / bun test 전량 / 스냅샷 1:1) 통과해야 머지. 회귀 감지 시 `git bisect run` 자동 탐색.

---

## 2. 패널 간 이견 (휴먼 결정 필요)

### D1. 테스트 러너: bun test 유지 vs Vitest 전환 ★최대 이견★
- **tdd 패널**: Vitest 전환 권장. "Vite 도입 시 두 러너가 갈라져 보루가 분열". `bun:test`→Vitest 시그니처 1:1 매핑(`mock`→`vi.fn()`, `jest.useFakeTimers`→`vi.useFakeTimers`). Bun snapshot(`// Bun Snapshot v1`)은 직렬화 규칙이 달라 "동일 입력 1회 재생성+diff 0 확인" 필요.
- **architecture + build-infra 패널**: bun test **유지** 권장. "회귀 보루 교체는 미션 안정성 제약상 신중". Vite는 dev서버/번들러로만, 러너는 Bun 유지. Vitest 전환은 별도 비용 결정.
- **종합 처리**: `tasks.json` P1-06 은 **기본 bun test 유지**, Vitest 전환 여부를 Gap Report 휴먼 결정으로 분리. 보루 분열 방지 우선.
- **✅ 휴먼 결정(2026-05-31): 단계적 전환 확정.** 전 구간(P1~P4) 회귀 보루는 bun test 유지(P1-06), Vite 셋업 후 **P5-07** 에서 Vitest 로 통일(스냅샷 1회 재생성 + diff 0). 두 러너 병존 기간 최소화, 보루 분열 없이 마무리.

### D2. 백엔드 "무수정" 경계 해석
- **build-infra 패널**: dispatch.ts 정적 라우팅(mimeMap 확장 G1, WEB_ROOT→dist, SPA fallback G3)은 "클라이언트 자산을 데몬이 서빙하기 위한 인프라 접합부". REST API/SSE 핸들러 로직은 무수정, 변경은 정적 자산 라우팅 분기로 한정.
- **architecture 패널**: "server 무수정 제약만 확정", 빌드 출력 매핑 세부는 빌드 트랙 실측 검증으로 위임, `.architecture-decision.md` 기록 필요.
- **종합 처리**: P1-02 에서 정적 라우팅 분기 변경 경계를 휴먼 검증 포인트로 명시. 미션의 "백엔드 무수정"은 핸들러 로직 한정으로 해석하되 사용자 확인.

### D3. settings-view 난이도 표기
- 원본 마스터 프롬프트: "폼 중심 저위험".
- **task-decomposition + dependency-safety + architecture 전원 교정**: 결합도는 low(import 2)이나 **1590줄 최대 파일** → "쉬움"으로 다루지 말고 폼 단위 분해(refactor) 선행 필수. risk med.
- **종합 처리**: P2-05(분해 설계) → P2-06/07(이식) 분리 반영.

### D4. session-detail facade 추가 분할 여부
- **dependency-safety 패널**: "보류 권고". 이미 7파일 facade 로 분리됨(api/left-panel 미import). 추가 미세분할은 가상스크롤 성능 요구가 실측될 때만.
- **task-decomposition 패널**: P3-04~07 로 분해 task 등록.
- **종합 처리**: P3-04(경계 설계)·P3-06(turn-views 1117 분해)은 등록하되, 추가 미세분할은 P5-05(가상스크롤) 측정 선행 조건. over-engineering 가드.

---

## 3. 패널별 고유 기여 (단독 발견)

| 패널 | 고유 기여 |
|------|-----------|
| dependency-safety | api.js 절단선 발견 — render-coupled fetcher 는 main.js 단일 소비처, 나머지 5 소비처는 순수 range 유틸뿐. 역전 위험이 좁게 격리됨. |
| tdd | 12 테스트 5형 계승 분류(A 스토어/B 훅/C 마운트가드/D 골든마스터/E 순수). useSSE·LeftPanel 언마운트 cleanup 은 원본 미보장 신규 계약 → Gap 기록. parseToolDetail 인라인 복제 → 선행 Tidy 추출. |
| architecture | **F1 정적 게이트 사각지대** — `check-architecture.sh` 가 `packages/*/src`만 스캔. web/src 신설 순간 KEBAB/DEP 게이트가 web 에 처음 적용 → 디렉토리 kebab-case 필수, 컴포넌트는 파일명만 PascalCase. 레이어 경계 규칙(api→stores→hooks→features→app, components/lib leaf). |
| build-infra | 2-모드 통합(dev Vite proxy / 운영 데몬 dist 서빙). 방식 A(WEB_ROOT→dist) + locales publicDir 복사 + mimeMap 확장 + electron-builder from:../web/dist + build 선행. SSE proxy 패스스루. |
| stabilization | 13 약점(W0~W12) 보드 + 의존성 위상정렬 머지 순서. 거짓통과 검증(의도적 타입에러 주입). over-eng 3자문(특히 W12 perf 측정 선행). |
| task-decomposition | TaskCreate 1:1 등록 가능한 P1-01~P5-06 전수 분해 + 의존성 그래프 + 부록(기존 12 테스트 게이트 매핑). |

---

## 4. 실측 교정 (원본 마스터 프롬프트 → 패널 공통 확인)

| 항목 | 원본 주장 | 패널 공통 실측 |
|------|----------|----------------|
| 회귀 보루 | Playwright E2E | bun test 12파일 + 스냅샷 (Playwright 0건) |
| web 단위 테스트 | "Vanilla선 불가능" | 이미 12개 존재(174 case) |
| TS strict | "JSDoc를 strict로 승격" | strict:false+checkJs:true, R5에서 typecheck 181→0·CI blocking. strict 는 .tsx 전환 시 과제 |
| design-system | 45개 | 30개 .js |
| settings-view | 폼 중심 저위험 | 결합 low / 1590줄 최대 파일, 분해 공수 high |

---

## 5. 미결 Gap (휴먼 검증 포인트 종합)

1. **서빙 계약** (P1-02, high): Vite 해시 번들 ↔ dispatch.ts `/assets/js/main.js` 가정. WEB_ROOT→dist/base/assetsDir/locales/mimeMap/SPA-fallback 매핑. 백엔드 무수정 경계 해석.
2. **i18n 전역** (P1-03): `window.I18n` 39파일 의존 + classic script 3종. 병존 기간 유지, ESM화 별도 트랙. 스냅샷 모킹 영향.
3. ~~**테스트 러너** (P1-06, D1): bun test 유지 vs Vitest 전환.~~ → **✅ 해소(2026-05-31): 단계적 전환 — bun test 보루 유지 + P5-07 Vitest 통일.**
4. **canvas timing** (P3-01): chart.js resize/redraw 단위테스트 불충분 → 수동 verify.
5. **SPA fallback** (P4-07): React Router 직접진입/새로고침 404 → dispatch 1분기 추가.
6. **신규 계약** (P3-02/P4-04): useSSE·LeftPanel 언마운트 cleanup 은 원본 미보장.

---

## 6. 검토 라운드 반영 내역 (review round → 보강 audit trail)

> 3개 검토 패널(`_panel/review-completeness.md`·`review-safety.md`·`review-schema.md`)이 tasks.json(당시 36 task)·README·phases.md 를 대조 검토했다. 지적된 누락/위험/스키마 결함을 어떻게 반영했는지 1:1 기록한다. 반영 후 task 36→39, 회귀 0 보장의 실질 구멍(빅뱅 수동 verify·정적 게이트 거짓안심·SSoT 이중화)을 닫았다.

### 6-1. 완전성 검토(review-completeness) 반영

| 지적 | 분류 | 반영 |
|------|------|------|
| M1 top-level .js 약 26개 무소속(obs-panel·cache-panel·context-chart·sparkline·tool-stats·metrics-api 등 + 툴팁/리사이즈 9종 + i18n 4종) | 누락 ★최대결함★ | **P1-08 신설**(105 파일 전수 매핑, orphan 0) + **P3-09 신설**(대시보드/통계 뷰 TSX 이식). P5-01 을 "열거"→"전수"(P1-08 매핑 기준 잔여 .js 0)로 재정의. 헬퍼군은 P1-08 매핑 결과로 P3-09/P5-01 귀속. |
| M2 innerHTML 130건 전수 매핑·최종 0 게이트 없음 | 누락 | **P1-08** 에 innerHTML 사이트별 인벤토리(파일:라인→소유 task) 포함. **P5-06** 최종 게이트에 "innerHTML 잔여 0(잔존 시 사유)" 추가. |
| M3 구 .js 삭제·dangling import 제거 게이트 없음 | 누락 | 이식 task done_criteria 에 "구 .js 삭제 + 잔여 import 0(grep)" 추가(P2-04·P2-07·P3-05·P3-09·P4-03·P4-06·P4-07). **P5-06** 에 ".js 잔여 0" 게이트. |
| M4 electron-builder 패키징 변경·검증 task 없음 | 누락 | **P4-08 신설**(from:../web/dist 전환 + 패키지 빌드 운영 분기 end-to-end verify). P1-02 는 "문서화" 한정으로 명확화. |
| M5 Playwright 도입 여부 결정/수동 verify 자동화 미결 | 누락 | README §7-7 에 "Playwright 도입 보류/도입 결정" Gap 항목 추가. 수동 verify task(P3-01·P4-06·P4-07·P5-04·P5-05)를 이 결정에 연결, 미도입 시 체크리스트+증거 의무화. P5-06 Gap 종합에 포함. |
| A1 수동 verify 합격 임계·증거 미정의 | 모호 | P3-01(리사이즈 깜빡임 0·도넛 재그림 1·증거 스크린샷)·P4-06(3모드/init 순서/재바인딩/SSE 재연결 4항+증거)·P4-07(lang 4종 매트릭스+FOUC+SPA fallback) done_criteria 에 사전 체크리스트+증거 아티팩트 명문화. |
| A2 "측정 없으면 종결" 무측정 통과 허용 | 모호 | P5-04/05 에 '측정' 필수 산출물(부하 시나리오+Profiler) + 임계(16ms 프레임 예산) 정의. 무측정 통과 금지, 미초과 시 측정 데이터와 함께 "불필요" 결론. |
| A3 "해체 완료" 객관 종료 조건 부재 | 모호 | P2-07(settings-view.js 삭제+import 0)·P4-03(meta-docs-view.js·flow.js 삭제+import 0)·P4-06(main.js 삭제+import 0)을 종료 조건으로 명문화. |
| A6 context-window.test.ts(6) 계승 귀속 약함 | 모호 | P3-01 의 명시 회귀 게이트로 귀속(context-chart 데이터 변환 의존). |

### 6-2. 되돌리기 안전성 검토(review-safety) 반영

| 지적 | 분류 | 반영 |
|------|------|------|
| BLK-1 baseline HEAD 3종 불일치(2126e11/9b939d5/1992b54) → bisect 앵커 붕괴 | Blocker | tasks.json `baseline.head` 를 "착수 직전 확정 단일 SHA"로 전환 + `head_label` 로 SSoT 지침 명시. 수치는 유효·SHA 라벨만 stale 임을 기록. README §3 에 단일 SHA 앵커 규칙. 착수 전 확정 항목으로 작업 흐름에 못박음. |
| BLK-2 web 단독 스크립트 부재 → bisect run 비결정 | Blocker | constraints.bisect 와 README §3 에 "게이트는 경로인자형 명령(`bun test packages/web/`, `tsc --noEmit -p packages/web/tsconfig.json`)으로 baseline 전 구간 동작, 패키지 스크립트는 게이트 SSoT 아님" 명시. |
| BLK-3 러너 결정 충돌(P1-06 bun 유지 vs tdd.md Vitest) | Blocker | **P1-06 을 P1-01 직후·P1-04 이전 선결 게이트로 승격**. merge_order 재배치. 기본=bun test 유지, Vitest 채택 시 스냅샷 1회 재생성+diff 휴먼 검증을 P1 안에서. tdd.md §1 정합 정정 지시. |
| BLK-4 DEP 게이트가 "web→types only" 강제 못 함(rank 정방향 통과) | Blocker | constraints.static_gate·README §6 정정 — "types 외 @spyglass import 금지는 컨벤션, 정적 게이트 미보장 → 휴먼/리뷰 또는 스크립트 규칙 신규 추가로만 보장". 보장 수준 과장 제거. |
| BLK-5 D형 스냅샷 러너 직렬화 함정 + 정규화 헬퍼 미검증 | Blocker | README §4 에 러너 전환 시 P1 격리 재생성. P2-04 에 정규화 헬퍼 거짓통과 검증(의도적 셀렉터 변형 주입→정규화가 잡는지)을 동반 의무화. |
| GAP-1 parseToolDetail SSoT 이미 이중화(extract.js:212 export + 테스트 인라인 복제) | TDD stale | P3-05 선행 Tidy 를 "신규 추출"→"render/extract.js export 로 재연결(동작 동치 확인 후 단일화)"로 정정. 3번째 사본 생성 금지. README §2 에 명시. |
| GAP-2 수동 verify 판정 기준 부재 | 회귀게이트 | A1 과 동일하게 P3-01·P4-06·P4-07 등에 판정 규칙+증거 명문화. |
| GAP-3 신규 cleanup 계약은 회귀 아닌 신기능 | TDD | regression_gate·README §2·§4 에 "신계약 분리 카운트"(통과 증가는 회귀 아님, baseline 174 case pass 유지+신규 fail 0) 명시. |
| GAP-4 특성화 테스트 결정론 미검증 | TDD | README §2 에 특성화 테스트는 renderers.test.ts 모킹 패턴(Date.now/I18n 고정) 동일 적용, 결정론 미확보 표면은 수동 verify 강등. P3-01 test_strategy 반영. |
| CPL-1 KEBAB 게이트 web 무커버리지 + pre-commit 부재 | 정적게이트 | P1-01 done_criteria 에 "빈 src/ 생성 직후 check-architecture.sh 1회 실행". README §6 에 검증 이력 0·수동/CI 호출 의존 명시. |
| CPL-2 병렬 트랙 store 시점 stale | 회귀게이트 | README §5 머지 규약에 "병렬 트랙 머지 직전 main 최신 store 로 rebase 후 게이트 재실행". P4-06 done_criteria 반영. |
| CPL-3 dispatch.ts 변경의 백엔드 경계 충돌 | Gap | P1-02·P4-07 에 "서버 패키지 커밋은 web 트랙과 별도 prefix/worktree 격리". README §5 머지 규약 추가. |

### 6-3. 스키마 정합성 검토(review-schema) 반영

| 지적 | 분류 | 반영 |
|------|------|------|
| 4-A status enum 부재 | 권고 | baseline 에 `status_enum: [pending, in_progress, completed]` 추가. README 작업흐름에 명시. |
| 4-B title 120자 초과 4건(P1-01·P1-02·P1-05·P4-07) | 권고 | 4건 모두 핵심 동사구로 단축, 상세는 test_strategy/done_criteria 로 이전. 반영 후 120자 초과 0건(검증 완료). |
| 4-C P1-02/P1-03 합성 토큰 | 권고 | phase 1 merge_order 를 `["P1-01","P1-06","P1-02","P1-03","P1-08","P1-04","P1-05","P1-07"]` 개별 id 배열로 분리. 설명은 merge_order_note 별도 필드. |
| 4-D path 화살표 형식 혼재 | 정보 | 무해(metadata 문자열) — 현 단계 유지. |

### 6-4. 반영 검증

JSON 파싱·id 중복 0·dangling depends_on 0·순환 0·forward-phase 의존 0·merge_order↔phase 정합·title 120자 초과 0 을 재검증 통과. 39 task(P1 8·P2 8·P3 9·P4 8·P5 6).
