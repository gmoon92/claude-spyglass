# Spyglass Web — React + Vite + TypeScript 풀 마이그레이션 (대안 C) 작업 문서

> 대상: `claude-spyglass` `packages/web` (Vanilla JS buildless ESM, 105 .js) → React 18 + Vite + TypeScript(strict).
> buildless 정체성을 의도적으로 폐기하고 Vite 빌드 파이프라인을 도입한다. 백엔드(REST API/SSE) 핸들러 로직은 무수정, 클라이언트만 교체.
> 기준 HEAD `2126e11` · v3.0.7. 정본 작업지시서: `../../../claude-code-system/.claude/docs/spyglass/react-migration/react-migration-master-prompt.md`(교정판 v2).
> **이 디렉토리는 개발 작업 문서다. React 코드는 아직 작성하지 않는다.**

## 문서 인덱스

| 문서 | 내용 |
|------|------|
| `README.md` (본 문서) | 작업 문서 인덱스 + 되돌리기 안전성 전략 |
| `tasks.json` | TaskCreate 1:1 등록용 JSON. mission/constraints/phases/tasks(39개). |
| `phases.md` | 5 페이즈 상세 명세(목표·대상·작업방식·검증·기간). |
| `panel-consensus.md` | 6 패널 합의/이견 + 검토 라운드 반영 내역 audit trail. |
| `_panel/*.md` | 6 전문가 패널 원본(task-decomposition·dependency-safety·tdd·stabilization·architecture·build-infra). |

분석 근거 문서(형제, `claude-code-system/.claude/docs/spyglass/react-migration/`): `rendering-architecture`·`sse-analysis`·`server-rendering-analysis`·`state-management-analysis`·`component-boundary-analysis`·`typescript-migration-analysis`·`react-migration-feasibility-report`.

## 작업 흐름

1. `tasks.json` 의 task 를 TaskCreate 로 등록(id 1:1), depends_on 으로 blockedBy 설정. status_enum=pending/in_progress/completed.
2. 페이즈 순서대로 진행. 각 task 의 `worktree:true` 는 전용 worktree 격리.
3. 매 task: 테스트 우선(Red) → 최소 구현(Green) → 정리(Refactor) → 3중 게이트 → 머지.
4. 설계/문서 task(P1-02·P1-03·P1-08·P2-05·P3-04·P4-01·P5-06)는 코드 회귀 없이 결정·인벤토리 기록.

> **착수 직전 1회 확정 항목**: ① baseline HEAD 단일 SHA(아래 §3), ② 테스트 러너(P1-06 선결 게이트). 둘 다 확정 전 본 마이그레이션 첫 커밋 금지.

---

# 되돌리기 안전성 전략 (Zero-Regression Contract)

미션 안정성 제약: **worktree 격리 · TDD 테스트 우선 · git bisect 회귀 추적 · 회귀 0 보장 · 작은 커밋**. 6 패널이 합의한 운영 규칙을 상술한다.

## 1. Worktree 격리 규칙

- **모든 실제 구현은 `git worktree add` 로 격리.** task 별 전용 worktree(`wt-<id>`, 예 `wt-p3-03-api`). 메인 작업 디렉토리·미커밋 변경·타 브랜치(사용자 동시작업) **불가침**.
- **`git checkout -b` 혼용 금지** — 브랜치 전환은 stash 충돌·미커밋 유실 위험. 격리 수단은 worktree 로 통일.
- **병렬 worktree**: 서로 다른 파일군 + 공유 코어(state/api/tsconfig) 미변경 task 는 동시 진행 가능.
  - P2-01~04(design-system+render) ∥ P2-05~07(settings) ∥ P2-08(components) — 모두 P1-04 이후.
  - P3-01(chart) ∥ P4-04(useSSE) ∥ P4-01~03(meta-docs) — 코어 소비만 하고 변경 안 함.
- **직렬 강제**: 공유 자원 변경은 머지 시점 순차 통합. 코어(P1-04 store → P3-03 api), 진입점(P4-06 main.js), tsconfig(P1-01·P5-02).
- **사용자 동시작업 감지 시**: 자율 진행이라도 즉시 멈춤 + 보고 + 별도 worktree 우회. main 작업 디렉토리가 dirty 면 머지 보류.

## 2. TDD — 테스트 우선

- **추출/전환 전 현재 동작을 고정하는 테스트 통과 확인 → 변경 → 동일 테스트 재통과로 동작 불변 증명.** 테스트 없는 함수 변경/추출 금지.
- 기존 12 테스트(174 case)를 5형으로 계승(상세 `_panel/tdd.md`):
  - **A형 스토어**: state(14)·events(6)·date-range-storage(12) → Zustand 액션/셀렉터/persist.
  - **B형 훅**: sse(8) → useSSE + renderHook.
  - **C형 마운트 가드**: left-panel(2) → 마운트/언마운트 회귀.
  - **D형 골든마스터**: renderers(20) → React 렌더 HTML 출력 동일성.
  - **E형 순수 계승**: formatters(53)·get-date-range(20)·api(10)·context-window(6)·anomaly(14)·parseToolDetail(10) → .ts 이식 거의 무변경.
- **테스트 공백 보강(변경 전)**: chart.js·session-detail·settings-view·meta-docs-view 는 직접 테스트 0 → 특성화 테스트 신규 작성(의도적 오답으로 Red 확인 후 현재 출력 고정). **결정론 필수**: 특성화 테스트는 renderers.test.ts 의 모킹 패턴(Date.now/I18n 고정)을 동일 적용한다. 결정론 미확보 표면은 골든마스터 부적합 → 수동 verify 로 강등(review-safety GAP-4).
- **신규 계약 추적**: useSSE·LeftPanel 언마운트 cleanup 은 원본 미보장 → Gap Report 에 "React 도입 필요"로 기록(휴먼 검증). **카운트 분리**: 이 신규 Red 테스트의 통과 수 증가는 "회귀"가 아니라 "신계약"이다. baseline 에 대응 케이스가 없어 bisect good 기준이 없음(원본은 항상 fail) → §4 회귀 0 정의와 분리 카운트(review-safety GAP-3).
- **parseToolDetail SSoT(P3-05)**: 이미 render/extract.js:212 에 export 가 존재하고 테스트는 인라인 복제본을 자체 정의해 SSoT 2곳 분기. P3-05 선행 Tidy 는 "신규 추출"이 아니라 "extract.js export 로 재연결"(동작 동치 확인 후 단일화)이다(review-safety GAP-1).
- **케이스 추가/삭제 금지**: 동일 계약을 동일 수로 보존해야 회귀 비교가 성립. 삭제 시 커밋 메시지에 사유 명기.

## 3. git bisect 회귀 추적

- **baseline 앵커 = 단일 SHA(BLK-1)**: bisect good 앵커는 "착수 직전 실측 HEAD" 단일 SHA 로 고정한다. 분석 시점 라벨 `2126e11`·검증 시점 `1992b54`·tdd.md `9b939d5` 가 혼재했으나 수치(174 pass/12 files/20 snap/typecheck0)는 유효하고 **SHA 라벨만 stale** 이었다. 착수 직전 `tasks.json baseline.head` 에 1회 확정 기입하고 본 README·_panel 전체가 동일 SHA 를 참조한다.
- **bisect run 게이트 = 경로인자형 명령(BLK-2)**: 게이트는 패키지 스크립트(P1-01 머지 전엔 부재)가 아닌 baseline 전 구간에서 동작하는 경로인자형으로 고정한다. 패키지 스크립트는 편의용일 뿐 게이트 SSoT 가 아니다.
- 회귀(테스트 fail·스냅샷 불일치·typecheck 증분>0) 머지 후 감지 시:
  1. `git bisect start` → `git bisect bad`(현재) → `git bisect good <확정 baseline SHA>` (보드 진행 로그에 기록).
  2. 게이트 스크립트화해 `git bisect run`:
     - 테스트 회귀: `bun test packages/web/` exit 코드
     - 타입 회귀: `tsc --noEmit -p packages/web/tsconfig.json` 또는 `bun run --cwd packages/web typecheck` (exit 0 = good)
     - 스냅샷 회귀: bun test 출력에서 snapshot 불일치 검출
  3. 원인 커밋 특정 후 `git bisect reset` → 해당 커밋만 revert 또는 fix-forward(테스트 우선).
- **작은 커밋이 bisect 해상도** — task 내부도 서브컴포넌트/사이트 단위로 쪼갠다. 거대 단일 커밋은 bisect 무력화.
- **Tidy First 커밋 분리**: 구조 변경(`refactor:`)과 동작 변경(`feat:`)을 절대 같은 커밋에 섞지 않음 → bisect 가 "구조 이동" vs "흐름 역전" 중 어느 커밋인지 즉시 격리.

## 4. 회귀 0 검증 게이트 (절대 조건)

**게이트 통과 못 하면 머지하지 않는다.** 매 머지 직전 + 매 머지 직후 전체 재실행.

1. **타입 게이트** — `bun run --cwd packages/web typecheck` 에러 **증분 0** (baseline 0). P1~P4 는 strict:false+checkJs baseline 유지, P5-02 에서만 strict:true 승격. CI `web-typecheck` blocking 으로 PR 단위 자동 강제.
2. **동작 게이트** — `bun test packages/web/` **baseline 174 case pass 유지 + 신규 fail 0**. 신규 컴포넌트/훅은 대응 테스트 동반(통과 수는 증가하되 fail 0 불변). **신계약 분리 카운트**: useSSE·LeftPanel 언마운트 cleanup 등 원본 미보장 신규 Red 의 통과 증가는 "회귀"가 아니다 — 별도 카운트로 추적해 거짓 회귀 경보 방지(GAP-3).
3. **스냅샷 게이트** — `renderers.test.ts.snap` **20 snapshot 1:1 일치**. 의도 변경 시에만 갱신 + **커밋 메시지에 사유 명시**. 무단 갱신 금지. 러너 전환(Vitest) 시 직렬화 규칙 차이로 20개가 한 번에 깨지므로(BLK-5), 전환은 P1-06 안에서 1회 재생성 + diff 휴먼 검증으로 처리(러너 교체 커밋이 bisect 를 오염하지 않도록 P1 에 격리).
4. **거짓 통과 검증** (빌드 도구 교체로 검사 누락 위험↑):
   - 신규 .ts/.tsx 가 typecheck 대상에 실제 포함됐는지 의심 시 의도적 타입에러 일시 주입 → tsc 가 잡는지 확인 후 즉시 복원.
   - 러너 정합 후: 12파일/174 통과가 baseline 과 일치하는지 확인(0건 실행인데 0 fail 이면 거짓 통과).
   - **D형 정규화 헬퍼 자체 검증(BLK-5)**: React 렌더는 class→className·자기닫힘·속성순서가 Vanilla 와 미세 상이 → 정규화 헬퍼 필수이나, 정규화가 실회귀를 삼키면 위양성. P2-04 에서 의도적 셀렉터 변형(data-session-id 제거 등)을 주입해 정규화가 그 회귀를 잡는지 확인 후 복원.
- **IDE diagnostic 은 노이즈**: Vite 도입·deps 추가 직후 IDE 의 `Cannot find module` 등은 TS server 재인덱싱 과도기. `tsc`/test CLI 출력만 진실.

## 5. 머지 순서 (worktree → main 위상정렬)

선형 히스토리 유지. 매 머지 후 전체 게이트 재실행. 공유 자원 변경 트랙은 가장 깨끗한 것부터 순차.

```
1. P1-01 buildchain        ── 모든 것의 blocker. Vite 환경에서 174 pass/20 snap/typecheck 0 재현 + 빈 src/ check-architecture.sh 가동 확인.
2. P1-06 러너 결정          ── 선결 게이트(P1-04 이전). 러너 단일 확정 = 스냅샷 기준선 고정.
3. P1-02·P1-03·P1-08 GAP/인벤토리 문서 ── 서빙계약·i18n·105파일 매핑+innerHTML 인벤토리.
4. P1-04 store             ── 코어 첫 통합(fan-in 다수).
5. P1-05·P1-07             ── persist·Zod 스키마.
   ───── 코어 안정 → 병렬 트랙 unblock ─────
6. 병렬 머지(깨끗한 것부터): P2-01~04 design-system+render → P2-08 components → P2-05~07 settings → P3-01 chart
7. 결합 트랙(코어 머지 후): P3-02 left-panel → P3-03 api역전 / P4-04 useSSE / P4-01~03 meta-docs / P3-05~08 session-detail / P3-09 대시보드 뷰
8. P4-05 SSE핸들러 → P4-06 router(main.js 폐기) ── 전 컴포넌트 통합 후 단독.
9. P4-08 electron dist 전환 → P4-07 entry(index.html 진입 전환 + SPA fallback).
10. P5-01 .ts전수전환 → P5-02 strict:true → P5-03 any제거
11. P5-04 memo → P5-05 가상스크롤 ── 측정 후 조건부(over-eng 가드).
12. P5-06 최종 게이트 + Gap 종합(innerHTML 0·.js 0·orphan 0).
```

**머지 규약**:
- 사전 확인: `git merge-base --is-ancestor origin/main main` 으로 머지 가능성 점검.
- 공유 자원(`tsconfig.json`)을 건드리는 task 는 P1-01·P5-02 뿐 → 두 시점에만 격리. `main.js` 는 P4-06 단일 → 충돌원 제거.
- **병렬 트랙 store 시점 일관성(CPL-2)**: 병렬 worktree 4트랙(P2-01~04 ∥ P2-05~07 ∥ P2-08 ∥ P3-01)은 각자 P1-04 store 기준으로 분기하므로, 머지 직전 **main 의 최신 store 로 rebase 후 게이트 재실행**한다. `merge-base --is-ancestor` 만으로는 store 시맨틱 변화를 못 잡는다.
- **백엔드 접근 격리(CPL-3)**: dispatch.ts SPA fallback 변경(P4-07) 등 서버 패키지 커밋은 web 트랙과 **별도 커밋 prefix/worktree** 로 격리해 백엔드 회귀와 클라이언트 회귀를 bisect 가 구분하게 한다.
- push 는 게이트 통과 + 사용자 승인 후에만.

## 6. 정적 아키텍처 게이트 정합 (architecture 패널 F1)

`packages/web/src/` 신설 순간 `check-architecture.sh` 의 KEBAB(디렉토리)가 web 에 **처음** 적용된다. web 은 현재 src/ 부재로 게이트 무적용 → **검증 이력 0**, P1-01 의 첫 `src/` 생성 커밋이 게이트의 첫 실전이다(CPL-1).
- 모든 디렉토리 **kebab-case** (PascalCase 디렉토리 1개라도 즉시 Blocker). React 컴포넌트는 **파일명만** PascalCase.
- **DEP 규칙은 정적 게이트가 보장하지 못함(BLK-4)**: "web 은 `@spyglass/types`(rank0)만 import"는 **컨벤션**이다. 현 `check-architecture.sh` 의 DEP 검사는 importer rank ≤ imported rank(정방향)만 emit 하므로, web(rank4)이 storage(1)·metrics(2)·server(3) 를 import 해도 **정방향=통과**한다. 즉 클라이언트가 server/storage 를 실수로 import 해도 게이트가 green. 따라서 이 제약은 **휴먼/리뷰 검증** 또는 check-architecture.sh 에 "web/desktop/tui 는 types 외 @spyglass import 금지" 규칙 신규 추가로만 보장된다. 현 문구가 보장 수준을 과장하지 않도록 정정.
- **pre-commit 자동 강제 부재(CPL-1)**: `.githooks/` 는 post-push·doc-sync-prompt 뿐 → check-architecture 는 **수동/CI 호출 의존**. P1-01 done_criteria 에 "빈 src/ 생성 직후 1회 실행"을 게이트 가동 확인으로 포함.
- 커밋 전: `bash .claude/skills/detect-architecture-violation/scripts/check-architecture.sh` 통과.

## 7. 미결 Gap (휴먼 검증 포인트)

`.architecture-decision.md` / `.migration-gap-report.md` 로 남기고 임의 추측 구현 금지:
1. 서빙 계약(P1-02): Vite outDir/base/locales/mimeMap/SPA-fallback ↔ dispatch.ts. 백엔드 무수정 경계 해석. 실제 패키징 전환·검증은 P4-08.
2. i18n 전역(P1-03): window.I18n 39파일, 병존 유지 vs ESM화.
3. 테스트 러너(P1-06): **✅ 해소(2026-05-31) — 단계적 전환 확정.** 보루는 bun test 유지(P1~P4 게이트), Vite 셋업 후 **P5-07** 에서 Vitest 통일(스냅샷 1회 재생성 + diff 0). D형 스냅샷·B형 fake timer 의 Vitest 전환은 P5-07 에서만 수행.
4. canvas timing(P3-01): chart.js resize/redraw 수동 verify(체크리스트 + 증거 스크린샷).
5. SPA fallback(P4-07): React Router 직접진입 404 → dispatch 1분기(서버 패키지 별도 격리).
6. 신규 계약(P3-02·P4-04): useSSE·LeftPanel 언마운트 cleanup 은 원본 미보장 → 신계약 분리 카운트.
7. **Playwright (M5) — ✅ 결정(2026-05-31): 도입 보류 확정.** 수동 verify 다수(P3-01·P4-06·P4-07·P5-04·P5-05)가 정확히 Playwright 자동화 표면. 마스터 §6 은 "결정 시에만 별도 비용 페이즈". 도입 보류/도입 go-no-go 를 본 Gap 에 명시 기록하고, 수동 verify task 들이 그 결정에 연결되도록 한다. 미도입 시 각 수동 verify 는 **사전 체크리스트 + 증거 아티팩트(스크린샷/로그)** 로 재현성을 확보(빅뱅 P4-06·P4-07 의 회귀 0 증명 수단).
8. **electron 패키징(P4-08)**: electron-builder from:../web/dist 전환 + 패키지 빌드 운영 분기 end-to-end verify.
