# Plan 01 — server leaf 추출 + web 타입 안전

마스터 보드: [README](./README.md) · 근거: [ADR](./adr-strangler-stabilization.md)

## 목표

- `server`에서 형제 의존 0인 leaf 모듈(metrics/proxy/meta-docs)을 워크스페이스 패키지로 추출하여 코어를 오케스트레이션에 집중시킨다.
- `web`에 빌드리스를 유지한 채 컴파일 타임 타입 검증을 도입한다.
- 동작·이벤트 흐름·DB는 변경하지 않는다 (additive only).

## 공통 규칙

- 작업은 워크트리/브랜치에서. 메인 직접 변경 금지.
- 리팩토링 전 대상 코드의 동작을 고정하는 **특성화 테스트(characterization test)**를 먼저 확보한다. 테스트 없는 함수는 추출 금지.
- 각 태스크 = 독립 커밋 = 독립 롤백 단위.
- 게이트: `bun run typecheck` + 영향 패키지 테스트 + isolation-grep 전부 green.

## 측정된 사실 (T01·T03·T05 분석 산출 — 표면 grep 단정 교정본)

> ⚠️ 초기 가정 "metrics·proxy·meta-docs → 형제 0 (leaf 확정)"은 **표면 디렉토리 grep의 한계**였다. 동반 유틸·배럴 경유까지 추적한 결과는 아래와 같다.

- **meta-docs (깨끗함 9/10)**: 코어 역참조 0, 순환 0, storage-graph 결합 0, 동반 이동/선반출 **없음**. 외부 의존 `@spyglass/storage` 단 하나. 소비처 `routes/meta-docs`·`runtime/lifecycle`·**`events.ts`**(3곳). → **추출 1순위.** 단 모듈 단위 특성화 테스트 전무(추출 전 차단 게이트).
- **metrics (깨끗함 7/10)**: 코어 역참조 0. 그러나 동반 유틸 중 `model-limits`(소비처 `routes/sessions`)·`anomaly-thresholds`(소비처 `cli/analyze`)가 코어와 **공유** → 깨끗한 추출엔 storage 선반출 동반. `tool-category`만 metrics 전용. 테스트는 T01에서 +43 보강 완료. 소비처 `domain/anomaly-enricher`·`api.ts`(2곳). → **2순위** (선반출 결정 후).
- **proxy (깨끗함 4/10)**: 코어 역참조 **7건**(broadcast→`sse`/`api`배럴/`domain`, inbound→`hook`배럴/`turn`, stream→`runtime/in-flight`, diag→`diag-log`). `anomaly-enricher`를 통해 metrics와 교차 의존 → metrics 추출에 종속. 소비처 `runtime/dispatch`·`cli/analyze`(2곳, **settings 아님**). 테스트 공백: audit-headers·upstream·handler. → **후순위** (배럴→직접경로 교정 + 선반출 + 테스트 보강 후).
- ~~순환: cli↔runtime 1건~~ → **착시 교정(T07)**: `runtime/config.ts`는 storage만 의존하는 leaf, cli→runtime은 `cli/open.ts → runtime/config` 단방향뿐. 그래프는 `daemon→open→config→storage` DAG로 **모듈 레벨 사이클 0**. 초기 "1건"은 디렉토리 레벨 grep 착시(ESM은 모듈 단위 초기화). T07은 변경 불필요로 종결.
- metrics 테스트 공백(T01에서 해소): `burn-rate`·`cache-trend`·`proxy-trend`·`router` → +43 특성화 테스트 작성 완료.

---

## T01 — metrics 의존성 정밀 분석 + 특성화 테스트 보강 〔그룹 A〕

- 선행: 없음
- 절차
  1. `metrics/` 전 파일의 import를 전수 분석. 특히 `metrics`가 `domain`·`storage` 외 server 코어를 역참조하는지 확인(역참조 있으면 추출 차단 사유 → plan에 기록).
  2. `router.ts`가 어떤 외부 심볼을 쓰는지 확인(추출 시 함께 이동할 표면 확정).
  3. 테스트 없는 `burn-rate`·`cache-trend`·`proxy-trend`·`router`에 대해 현재 출력을 고정하는 특성화 테스트 작성. 엣지(빈 입력·경계값·null) 실패 케이스 먼저(red) → 구현 기준 성공 케이스 다양화.
- 게이트: 신규 테스트가 현재 코드에서 green. 커버리지가 추출 표면을 덮는지 확인.
- 산출: `metrics-dependency-note.md`(역참조 유무 결론) + 신규 테스트 파일.
- over-eng 가드: 역참조가 많아 추출 비용이 효익을 넘으면 T02를 보류하고 사유 기록.

## T02 — `@spyglass/metrics` 패키지 추출 〔그룹 A, 선행 T01〕

- 절차
  1. `packages/metrics` scaffold (`package.json` name `@spyglass/metrics`, `tsconfig`, deps: storage·types).
  2. `metrics/` 파일 이동. import 경로 갱신.
  3. 소비처(`domain/anomaly-enricher`, `routes/api`)를 `@spyglass/metrics`로 교체. `server`에 `@spyglass/metrics` workspace dep 추가.
  4. 게이트 실행.
- 롤백: 커밋 revert (파일 원위치 + dep 제거).
- over-eng 가드: 추출 후 `server` LOC 감소분과 새 패키지 경계의 이득을 README 로그에 1줄로 기록.

## T03 — proxy 의존성 정밀 분석 + 테스트 확인 〔그룹 B〕

- 선행: 없음
- 절차: `proxy/`(handler 포함) import 전수 분석. 기존 `proxy/__tests__` 커버리지 확인. 공백 시 특성화 테스트 보강(upstream 헤더 통과·secret 비저장 불변식 우선).
- 게이트: proxy 테스트 green.

## T04 — `@spyglass/proxy` 패키지 추출 〔그룹 B, 선행 T03〕

- 절차: T02와 동형. 소비처 `settings`·`runtime`·`cli`를 dep으로 전환. `settings`는 server 코어에 잔존하되 `@spyglass/proxy` 참조.
- 주의: `audit-headers`의 "secret 비저장" 불변식이 추출 후에도 유지되는지 테스트로 재확인.

## T05 — meta-docs 의존성 정밀 분석 + 테스트 확인 〔그룹 C〕

- 선행: 없음
- 절차: `meta-docs/` import 전수 분석. `meta_documents`/그래프 unified-flow와의 결합 확인. `synchronizer.ts`의 `lastGlobalSyncAt` 전역 상태 라이프사이클 확인. 테스트 공백 보강.

## T06 — `@spyglass/meta-docs` 패키지 추출 〔그룹 C, 선행 T05〕

- 절차: T02와 동형. 소비처 `routes`·`runtime` dep 전환. storage·storage-graph 의존 명시.

## T07 — cli↔runtime config 순환 해소 〔그룹 D〕

- 선행: 없음
- 절차: `runtime/config`의 `PORT`/`HOST` 등 상수를 순환 없는 위치로 분리(예: `config` 전용 모듈 또는 `@spyglass/types` 상수). `cli`와 `runtime` 양쪽이 그 위치를 참조하도록 변경.
- 게이트: 순환 재검사(양방향 import 0) + typecheck + 테스트.
- over-eng 가드: 단순 상수 분리로 끝낸다. 더 큰 의존성 역전(DI 컨테이너 등) 도입 금지.

## T08 — web tsconfig(checkJs) + types paths 매핑 〔그룹 E〕

- 선행: 없음
- 절차
  1. `packages/web/tsconfig.json` 생성: `allowJs`·`checkJs`·`noEmit`, `strict:false`(점진), `paths: { "@spyglass/types": [...] }`.
  2. `package.json`에 `typecheck` script 추가(없으면 web을 워크스페이스 멤버로 인식시키는 최소 구성).
  3. CI `test.yml` typecheck 매트릭스에 web 추가하되 초기엔 비차단(`continue-on-error`).
- 게이트: `tsc --noEmit`가 도구로서 동작(에러 0 강제는 T09 이후).
- 주의: 런타임 코드·`index.html` 로딩 경로 변경 금지. 산출물 0.

## T09 — web 핵심 파일 `@ts-check` 점진 적용 〔그룹 E, 선행 T08〕

- 절차: 테스트 보유 파일(state·api·sse·formatters·renderers·events·anomaly 등 11개)부터 `// @ts-check` 추가 → tsc 에러 해소(JSDoc 보강) → `@spyglass/types`로 SSE/API 응답 shape 참조.
- 게이트: 적용 파일군 tsc 에러 0. 무에러 도달 시 CI 게이트를 차단 모드로 승격.
- over-eng 가드: 18K 전체를 한 번에 강제하지 않는다. 파일 단위 opt-in으로 확산.

---

## 병렬화·통합 전략 (재정렬)

- **추출 순서: meta-docs(T06) → metrics(T02) → proxy(T04).** 깨끗함 점수 역순. 각 머지 후 전체 게이트 재실행.
  - meta-docs: 동반 작업 0이라 가장 먼저. 단 T05 특성화 테스트 선확보가 차단 게이트.
  - metrics: storage 선반출 동반 여부를 결정한 뒤 추출(`model-limits`·`anomaly-thresholds`를 storage로 내릴지).
  - proxy: metrics 추출 완료 + 배럴(api/hook)→직접경로 교정 + 공유 유틸 선반출 + audit-headers·upstream 테스트 보강 후.
- T07(순환)·T08·T09(web)는 추출과 파일 충돌이 적어 독립 워크트리·독립 머지 가능.

## 완료 정의 (DoD)

- 추출 3종 완료 후 `server` 패키지에서 metrics/proxy/meta-docs 디렉토리 부재, 동작 테스트 70+ green, typecheck green, isolation-grep 통과.
- web tsconfig 존재 + 핵심 파일군 tsc 에러 0 + CI 차단 게이트.
- 각 단계 over-eng 가드 자문이 README 로그에 기록됨.
