# 아키텍처 안정화 — 마스터 보드

Strangler 기반 점진적 안정화 작업의 단일 추적 지점. 취약점이 추가될 때마다 같은 방법론으로 사이클을 반복한다.

- 전략 근거: [adr-strangler-stabilization](./adr-strangler-stabilization.md)
- 작업 대상 레포: `claude-spyglass` (별도 git 레포, `main`)

## 방법론 사이클 (재사용 템플릿)

각 취약점은 아래 6단계를 거친다. 단계마다 게이트를 통과해야 다음으로 진행.

1. **분석** — 영향 코드/의존성 정밀 측정. 추측 금지, `파일:라인` 근거.
2. **테스트 우선** — 대상 코드의 기존 테스트 확인 → 엣지/실패 케이스 작성 → red 확인 → 다양한 성공 TC 구축. (특성화 테스트로 현재 동작을 고정)
3. **격리** — 워크트리/브랜치에서 작업. 메인 직접 변경 금지.
4. **실행** — 동작 변경 없이 경계만 이동. 독립 커밋 단위.
5. **검증 게이트** — `bun run typecheck` + 영향 패키지 테스트 + `isolation-grep`. 전부 green이어야 통과.
6. **over-engineering 가드** — ADR 비고의 3개 자문에 답하고 기록. "유지가 낫다"면 revert.

## 검증 게이트 (공통)

```
bun run typecheck          # 타입 회귀
bun test <영향 패키지>      # 동작 회귀 (현재 70 테스트)
# CI: isolation-grep — SSoT SQL / 공유 타입 변경 자동 차단
```

롤백: 각 작업은 독립 커밋. `git revert <commit>`으로 단위 롤백.

## 사이클 #1 — server leaf 추출 + web 타입 안전

상세 계획: [plan-01-server-leaf-extraction](./plan-01-server-leaf-extraction.md)

| ID | 작업 | 의존 | 병렬 그룹 | 상태 |
| --- | --- | --- | --- | --- |
| T01 | metrics 의존성 정밀 분석 + 특성화 테스트 보강 | — | A | ✅ Done (브랜치 `stabilization/t01-metrics-tests`, +43 테스트) |
| T02 | `@spyglass/metrics` 패키지 추출 | T01 | A | ✅ **Merged to main** (선반출 `c0c26c9` + 추출 `ad5c163`) |
| T03 | proxy 의존성 정밀 분석 | — | B | ✅ Done (깨끗함 4/10 — 역참조 7건, 후순위 확정) |
| T04 | ~~`@spyglass/proxy` 패키지 추출~~ → **사이클#2로 재정의** | — | B | 🔁 Redefined (proxy는 leaf 아님 — 공유 ingestion 파이프라인 bottom-up 선행 필요. ADR 참조) |
| T05 | meta-docs 의존성 분석 + 특성화 테스트 | — | C | ✅ Done (브랜치 `stabilization/t05-metadocs-tests`, +69 테스트) |
| T06 | `@spyglass/meta-docs` 패키지 추출 | T05 | C | ✅ **Merged to main** (`fc08813`, ff 머지, 워크트리 정리됨) |
| T07 | ~~cli↔runtime config 순환 해소~~ | — | D | ✅ Closed (순환 아님 — 모듈 레벨 acyclic, 변경 불필요) |
| T08 | web `tsconfig`(checkJs) + types paths 매핑 도입 | — | E | ✅ **Merged to main** (`9671a91`, 비차단 CI, 루트 12 유지) |
| T09 | web 핵심 파일 `@ts-check` 점진 적용 (테스트 보유 11개 우선) | T08 | E | ⬜ Pending (web tsc baseline 427 → 점진 0) |

상태 범례: ⬜ Pending · 🟡 In Progress · 🧪 Test-Red · ✅ Done · ↩️ Reverted

병렬 그룹: A/B/C/D/E는 서로 독립 → 별도 워크트리에서 동시 진행 가능. 단 추출(T02/T04/T06)은 모두 `packages/` 워크스페이스 구성과 `server` import 경로를 건드리므로, **머지 시점에는 순차 통합**하여 충돌을 줄인다.

**추출 순서 재정렬 (T03·T05 분석 결과 반영)**: ① **meta-docs**(가장 깨끗·동반작업 0, 단 테스트 선확보) → ② **metrics**(테스트 완료, 단 storage 선반출 동반 결정 필요) → ③ **proxy**(역참조 7건·metrics 교차의존, 배럴 교정+테스트 보강 후행). web 트랙(T07~T09)은 server 추출과 독립이라 무관하게 병렬 가능.

## 발견된 백로그 (사이클#1 범위 밖 — 별도 처리)

- **web 27 fail (기존 코드 버그 2종, locale 무관)** — T08에서 clean main HEAD 재현으로 확정.
  - A. `assets/js/left-panel.js:33` top-level `document.addEventListener`가 비-DOM 테스트에서 throw → `api.js:37,39`(`VALID_PRESETS`/`_activeRange`) TDZ 연쇄 (21 fail +1 error). 브라우저 런타임은 정상, 테스트 격리 결함. 수정안: top-level side-effect 지연 등록 또는 테스트 DOM 프리로드.
  - B. `renderers.test.ts` 스냅샷 드리프트 — `ds-chip`/`role-badge` 디자인 변경 후 스냅샷 stale (9 fail). 수정안: 스냅샷 갱신.
- **proxy 추출 (사이클#2)** — 공유 ingestion 파이프라인(`normalize→enrich→sse→persist`) 경계 정의 선행 필요(ADR 참조).
- **T09 @ts-check 점진** — web tsc baseline 427(@ts-check 0 상태 약검사). `window.I18n` ambient 선언 + `HTMLElement` 캐스팅 JSDoc으로 388 TS2339 대량 소거 가능. 테스트 보유 11개 파일부터.

## 진행 로그

- 2026-05-30 — ADR·마스터 보드·1차 플랜 작성. 코드 변경 전 단계.
- 2026-05-30 — **T01 완료** (브랜치 `stabilization/t01-metrics-tests`, 커밋 미머지). 무테스트 4파일에 특성화 테스트 +43 (metrics 스위트 45→88), red→green 확인. 프로덕션 무변경.
  - **핵심 발견**: metrics는 server 코어를 0번 역참조(추출 시 순환 없음). 그러나 동반 유틸 중 `model-limits`(소비처 `routes/sessions`)·`anomaly-thresholds`(소비처 `cli/analyze`)는 **코어와 공유**되는 도메인 유틸. `tool-category`만 metrics 전용.
  - **T02 재평가 사유**: metrics를 깨끗하게 추출하려면 공유 유틸 2종을 `@spyglass/storage`로 선반출하는 작업이 동반됨(범위 확대). 코어에 남기면 metrics→server 역의존, metrics로 옮기면 routes/cli→metrics 의미 왜곡. 추출 방식 결정 후 T02 진행.
  - diagnostic 노이즈: 신규 테스트의 `bun:test`/`require` IDE 경고는 LSP 컨텍스트 차이일 뿐, `bun run typecheck`(공식 게이트)에선 신규 파일 에러 0건. 전체 12건은 baseline(request-normalizer 2 + web checkJs 갭 10 = T08/T09 영역).
- 2026-05-30 — **T03·T05 분석 완료 → 추출 1순위 재선정**. 깨끗함 비교: meta-docs 9/10(동반작업 0) > metrics 7/10(storage 선반출 동반) > proxy 4/10(역참조 7·metrics 교차의존). **1순위를 metrics → meta-docs로 변경.** proxy는 후순위.
  - plan-01 사실 오류 교정: ① "proxy → 형제 0 leaf 확정"은 틀림(실제 역참조 7건: broadcast→sse/api/domain, inbound→hook/turn 배럴, stream→runtime/in-flight, diag→diag-log). ② proxy 소비처는 settings/runtime/cli가 아니라 `runtime/dispatch`·`cli/analyze` 2곳(settings는 *훅 설치* 설정으로 무관). ③ meta-docs 소비처에 `events.ts`(SessionStart) 누락 → T06 dep 전환은 routes·runtime·**events** 3곳.
  - meta-docs 테스트 부채: 모듈 단위 특성화 테스트 전무. scanner/resolver/known-cwds/synchronizer(특히 `generateMergeVariants` 하이픈 디코딩 2^k, `addIfValid` home 경계 보안 가드)가 추출 전 차단 게이트.
- 2026-05-30 — **T05 테스트 완료** (브랜치 `stabilization/t05-metadocs-tests`). known-cwds 14 + resolver 14 + scanner 22 + synchronizer 19 = **69 테스트 green**, typecheck 0 신규 에러, 미사용 변수 3건 정리. 추출 표면(index.ts public API 10 + 타입) 커버 → **T06 추출 게이트 통과**.
  - 발견된 현재 동작(추후 검토): 미니 YAML 파서가 CRLF 입력에서 마지막 key의 trailing `\r`로 인해 마지막 key를 누락. 특성화 테스트로 현재 동작 고정. → **수정 완료**(아래 CRLF fix 로그 참조).
- 2026-05-30 — **T06 추출 완료** (워크트리 `.claude/worktrees/t06-metadocs`, 브랜치 `stabilization/t06-metadocs-extract`, 베이스 `89580d8`=T05테스트 + 추출 `fc08813`). meta-docs 본체 5 + 테스트 4 = 9파일을 `git mv`로 100% rename(로직 0줄 변경) → `@spyglass/meta-docs`. 소비처 3곳(routes/meta-docs·events·runtime/lifecycle) `@spyglass/meta-docs`로 교체, server에 dep 추가.
  - 게이트: typecheck 12=baseline(신규 0), server 312 + meta-docs 69 = 381 = baseline pass(손실 0), 회귀 0, DB 무변경. over-eng 자문 3개 긍정 → revert 불필요.
  - server에서 **962 LOC 분리**. 신 패키지 외부 의존 `@spyglass/storage` 단 하나. tsconfig 미생성(루트 단일 tsconfig가 `packages/**` 포함하는 기존 관례 따름).
  - diagnostic 노이즈: IDE가 워크트리(t06) 파일을 메인 레포(t05 체크아웃) node_modules 컨텍스트로 평가해 `@spyglass/meta-docs` 미해소 경고 → 워크트리 내 typecheck는 정상 해소. 머지 후 소멸.
  - **머지 대기**: 메인 레포는 현재 `t05` 체크아웃. T06 결과는 워크트리에만 존재.
- 2026-05-30 — **T06 main 머지 완료**. `main`에 t01(metrics 테스트)+t05(meta-docs 테스트)+t06(추출) ff 머지(선형). 워크트리 정리. 사용자 미커밋 변경(`hook-detect.ts`, at-rest 암호화 리포트 등) 보존. `bun install` 후 `@spyglass/meta-docs` 정상 해소.
  - **게이트 진실 검증**: 머지 후 IDE diagnostic이 events/lifecycle/routes/meta-docs 테스트에서 `@spyglass/storage`·`bun:sqlite`·상대모듈 대량 미해소로 떴으나, ① tsc 전체 에러 **12=baseline**(추출 관련 0) ② 해당 파일들 tsc 에러 **0건** ③ 타입에러 일시 주입 시 tsc가 정확히 감지(거짓 통과 아님). → **IDE TS server의 `bun install` 후 재인덱싱 노이즈로 확정.** TS server 재시작 시 소멸. 코드/빌드 영향 0.
  - 교훈(방법론 반영): 패키지 추출·`bun install` 직후 IDE diagnostic 폭증은 예상된 노이즈. 진실의 소스는 `bun run typecheck`(tsc)이며, baseline 대비 증분과 타입에러 주입 감지로 검증한다.
- 2026-05-30 — **T02 main 머지 완료** (선반출 `c0c26c9` + 추출 `ad5c163`, ff). prep 테스트 30 + 선반출 + 추출. `server/src/metrics`(production 1578 + 테스트) 제거, `model-limits`(추론)→`storage/domain`, `anomaly-thresholds`→`storage/queries` 선반출, `tool-category` metrics 동반. git rename 100%(router/model-limits만 import 1줄).
  - 게이트: typecheck 12=baseline, 영향 스코프(metrics+storage+domain) **408 pass/0 fail**, isolation-grep 무관(경로 한정), DB 무변경. server에서 ~4028줄 순감.
  - web 27 fail은 추출이 web 파일 0건 변경 → 인과 없음(web 자체 baseline, T08/T09 영역). model-limits.ts:65 등 IDE 타입경고도 tsc 0건(재인덱싱 노이즈).
  - **누적 성과**: server 코어에서 meta-docs(962) + metrics(1578 prod) 분리 완료. server는 routes/runtime/hook/domain/settings/proxy/cli 오케스트레이션으로 수렴.
- 2026-05-30 — **proxy(T04) 방향 재정의**. proxy 역참조 7건 중 `sse`·`request-normalizer`·`anomaly-enricher`가 hook(processor/events)·routes와 **공유하는 ingestion 파이프라인**으로 확인됨(grep 전수). → proxy는 leaf가 아니라 hook과 대칭인 수집 어댑터. leaf 추출 강행 시 hook이 proxy를 의존하는 역왜곡 발생. **T04를 사이클#1에서 Deferred, 사이클#2(ingestion 파이프라인 경계 정의, bottom-up)로 분리.** "역참조 불가피 모듈의 방향 재정의" 방법론을 ADR에 추가.
  - 사이클#2 후보(방향만, 미착수): hook·proxy·routes 공유 `normalize→enrich→sse→persist`를 도메인 코어로 경계화 → 이후 proxy/hook이 얇은 어댑터로 추출 가능. 사이클#1(web) 완료 후 착수 여부 별도 판단.
- 2026-05-30 — **사이클#1 발판 일단락**. main에 7커밋(origin보다 앞): T01/T05 테스트 + T06 meta-docs 추출 + T02 prep/선반출/추출 + T08 web tsconfig. 패키지 7→9(meta-docs·metrics 신설), server production 2540 LOC 분리(현 server/src 13,788). 최종 게이트 typecheck 12, 핵심 패키지 490 pass/0 fail, 회귀 0. 후속 백로그: T09 @ts-check(427), web 27 fail 버그, proxy 사이클#2.
- 2026-05-30 — **T08 main 머지 완료** (`9671a91`). `packages/web/{tsconfig.json,package.json}` + 비차단 CI `web-typecheck` job. `allowJs/checkJs/noEmit`, `@spyglass/types` paths 매핑. 런타임/index.html/assets 0 변경(빌드리스 유지). 루트 typecheck 12 유지(격리). web tsc baseline 427(@ts-check 0 약검사). **web 27 fail은 사용자 locale 무관 기존 코드 버그 2종으로 확정**(위 백로그). T09 차단 게이트 승격은 @ts-check 적용 후.
- 2026-05-30 — **T07 종결: 순환 아님(변경 불필요)**. `runtime/config.ts`는 `@spyglass/storage`만 의존하는 leaf, cli→runtime은 `cli/open.ts → runtime/config` 단방향 1개. 모듈 레벨 그래프는 `daemon→open→config→storage` DAG(사이클 0). 초기 "순환 1건"은 디렉토리 레벨 grep 착시(ESM 초기화는 모듈 단위라 무관)였음. PORT/HOST 상수 분리는 cosmetic이라 churn>가치 → 보류. **over-eng 가드가 불필요 작업을 차단한 사례.**
- 2026-05-30 — **CRLF YAML 파서 버그 fix** (브랜치 `stabilization/fix-crlf-yaml`, red→green). `parseSimpleYaml`의 라인 분할 `split(/\r?\n/)` → `split(/\r\n|\r|\n/)`로 교정. CRLF 입력에서 닫는 fence 직전 마지막 라인의 trailing `\r`이 정규식 `$` 앵커(CR 앞 미매치)를 깨 마지막 key를 통째로 누락하던 데이터 손실 버그. T05 박제 케이스를 올바른 기대값으로 교체 + 엣지 4종(혼합 개행·무종단 개행·값 trailing CR·빈 FM CRLF) 추가. scanner 73 pass/0 fail, typecheck 12 유지, LF 경로 불변(회귀 0).
