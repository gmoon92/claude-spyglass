# ADR — Strangler 기반 점진적 아키텍처 안정화

- 상태: Proposed
- 작성일: 2026-05-30
- 범위: `@spyglass/server` 모듈 비대, `@spyglass/web` 타입 부재
- 관련 문서: [stabilization README](./README.md), [plan-01-server-leaf-extraction](./plan-01-server-leaf-extraction.md)

## 컨텍스트

외부 아키텍처 리뷰에서 두 약점이 지적됨.

1. `server` 패키지가 단일 워크스페이스에 22K LOC로 비대 (전체 코드의 약 절반). hook/proxy/metrics/meta-docs/settings/routes/runtime/cli/domain 공존.
2. `web` 패키지가 빌드 스텝 없는 Vanilla JS 18K LOC. 타입 안전성이 JSDoc 주석에만 의존, 컴파일 타임 검증 부재.

리뷰는 7단계 strangler 전략(경계 정의 → 의존성 그래프 → interface → event bus → web schema → TS 마이그레이션 → 검증 게이트)을 제안함. 이 전략의 가정을 실제 소스로 검증한 결과, 철학은 타당하나 일부 전제가 현 코드와 어긋남을 확인함.

## 검증된 전제 (소스 대조 결과)

| 리뷰 가정 | 실측 결과 | 판정 |
| --- | --- | --- |
| graph가 server에 혼재 | `storage-graph`가 이미 별도 패키지. server엔 `routes/graph.ts`(HTTP 어댑터) + `settings/graph-db-installer.ts`만 | **가정 무효** — graph 추출 불필요 |
| 순환 의존 다수 존재 가능성 높음 | 형제 디렉토리 양방향 전수조사 결과 순환은 `cli ↔ runtime` 1건. `cli`가 `runtime/config`의 상수만 참조하는 부트스트랩 순환 | **과장** — 상수 분리로 해소 |
| implicit shared mutable state 높음 | 최상위 `let`은 전부 명시적 라이프사이클(init/invalidate)을 가진 캐시·싱글톤(version cache, anomaly _cache, lifecycle server/db, dashboard cache 등) | **과장** — 숨은 결합 아님 |
| leaf 모듈 간 직접 참조가 문제 | `metrics`·`proxy`·`meta-docs`는 형제 모듈을 **0번** import하는 깨끗한 leaf. 실제 fan-out 결합은 `events.ts`(10개 경계 횡단)·`routes`(settings 5·domain 4)에 집중 | **재조준** — 결합 핫스팟은 오케스트레이터 |

## 결정

strangler 철학(외곽부터 점진 교체, 동작 유지, 단계별 검증/롤백)은 채택한다. 단 코드 현실에 맞게 다음과 같이 조정한다.

### 채택

- **leaf 패키지 추출**: `metrics` → `proxy` → `meta-docs` 순(의존 역순, 가장 작고 안전한 것부터)으로 워크스페이스 패키지 분리. 형제 의존 0이라 순환 위험 없음.
- **web checkJs**: TypeScript `checkJs`/`noEmit` 모드 + `@ts-check` 파일 단위 opt-in + `@spyglass/types` paths 매핑. 빌드리스 정체성 유지하며 타입 안전 확보.
- **테스트 우선**: 리팩토링 대상 코드에 테스트가 없으면, 추출 전 엣지/실패 케이스 포함 TC를 먼저 작성하고 red→green을 확인한 뒤 진행.
- **cli↔runtime 순환 해소**: `runtime/config` 상수를 순환 없는 위치로 분리.
- **기존 검증 게이트 재사용**: 신규 도구 도입 없이 `bun run typecheck` + 패키지 테스트(70개) + `isolation-grep` CI 게이트를 phase gate로 사용.

### 기각

- **internal event bus 도입**: `hook/dispatcher.ts`의 `REGISTRY`/`FALLBACK` strategy 라우팅이 이미 그 역할을 수행. event bus를 덧씌우면 명시적 호출이 문자열 이벤트로 바뀌어 `@spyglass/types` contract의 타입 안전성·추적성을 훼손함. 강점과 충돌.
- **graph 추출**: 이미 `storage-graph`로 분리 완료.

### 완화

- **zod 전면 런타임 검증 → 입력 경계 한정**: `@spyglass/types` contract + 계약 테스트(`sessions-turns-contract`, `read-endpoint-contract`) + isolation-grep이 이미 contract를 강제. zod 전면 도입 대신 SSE/hook **입력 경계에만** types 파생 경량 가드를 검토(필요 시).
- **DB schema 전면 동결 → additive-only**: 마이그레이션은 이 프로젝트의 안전 메커니즘(`migrator` + `_migrations` + isolation-grep). 전면 금지 대신 파괴적 변경(컬럼 삭제/타입 변경)만 금지하고 additive는 허용.
- **zero-downtime / shadow mode 제외**: 대상은 PID 싱글톤 데몬으로 도는 로컬 단일 사용자 도구. 이중 실행 shadow mode는 과잉. 데몬 재시작으로 충분.

## 결과

- server 코어는 오케스트레이션(routes/runtime/hook/domain/settings)에 집중, 재사용 가능한 계산/수집 로직은 독립 패키지로 분리됨.
- web은 런타임 변경 0, 빌드 산출물 0으로 타입 회귀 방어를 얻음.
- 각 추출은 독립 커밋 = 독립 롤백 단위. 과도하다고 판단되면 단위별 revert 가능.

## 역참조 불가피 모듈의 방향 재정의 (T03 proxy에서 도출)

leaf 추출(의존 역순, top-down)은 "형제를 import하지 않는 모듈"을 전제한다. 그러나 역참조가 있는 모듈을 만나면 강행하지 말고, 역참조를 **3종으로 분류**한 뒤 종류별로 방향을 바꾼다.

| 역참조 종류 | 식별 | 방향 |
| --- | --- | --- |
| **배럴 노이즈** | 실제 심볼은 leaf 정의처를 갖는데 무거운 배럴(index/api)을 경유해 import | import 경로를 직접 정의처로 교정 → 결합 소멸 후 추출 |
| **순수 leaf util** | import 0 또는 표준 런타임만 의존하는 작은 유틸 | 공유 위치(storage/공통)로 이동 |
| **공유 도메인 코어** | 여러 모듈이 함께 소비하는 파이프라인/도메인 로직 | **추출 대상을 바꾼다 — 막힌 모듈이 아니라 공유 코어를 먼저 추출**(top-down → bottom-up 전환). 그러면 막힌 모듈이 코어에만 의존하는 얇은 어댑터가 되어 자연히 leaf화 |
| **진짜 순환** | 양방향 의존 | 물리 분리 **보류**. 인터페이스/배럴로 논리 경계만. "추출 안 함"도 정당한 결론 |

**원칙**: leaf 추출이 막히는 것은 실패가 아니라 "그 모듈이 leaf가 아니라는 신호"다. 솔직히 분류하고, 공유 코어를 먼저 빼거나(bottom-up) 보류한다. 강행해서 간접 계층/역왜곡을 만들지 않는다.

### 적용 사례 — proxy (T04)

proxy 역참조 7건 분류: 배럴(`api`,`hook`) + 순수 leaf util(`in-flight`,`diag-log`) + **공유 도메인 코어(`sse`,`request-normalizer`,`anomaly-enricher`)**. 마지막이 핵심 — `normalize→enrich→sse→persist`는 proxy 전용이 아니라 hook(processor/events)·proxy·routes가 공유하는 **ingestion 파이프라인**이다. 따라서 proxy는 leaf가 아니라 **hook과 대칭인 수집 어댑터**다. proxy를 빼려면 공유 파이프라인을 먼저 도메인 코어로 정리해야 하며(bottom-up), 이는 hook까지 영향을 주는 큰 작업이라 **사이클#1(leaf 추출)에서 분리해 별도 사이클#2로 재정의**한다. T04는 사이클#1에서 Deferred.

#### 사이클#2 분석(C2-1) 결과 — bottom-up 가설 기각, 물리 추출 불필요

위 "공유 코어를 먼저 빼면 proxy가 leaf화된다"는 bottom-up 가설을 C2-1에서 전수 검증한 결과 **전제가 어긋났다**:

1. **파이프라인이 이미 코어 역참조 0의 깨끗한 DAG** — normalizer/enricher/sse 모두 `routes|runtime|api`를 0번 import. 추출해도 줄일 결합이 없다(이미 0).
2. **단일 응집 패키지가 성립하지 않음** — 처리(normalizer+enricher)·전송(sse, connections Set 소유 transport)·write(hook/persist, hook 내부 강결합)는 3개의 다른 관심사. 묶으면 잡탕 패키지.
3. **빼도 proxy는 leaf화 안 됨** — `proxy/broadcast`는 파이프라인 외에 `api`(dashboard 캐시)·`runtime/in-flight`·`hook/turn`에 여전히 묶임. 파이프라인 추출은 7건 중 3건만 해소. proxy 추출이라는 원래 동기 미달성(ROI 음수).

→ **새 결론 카테고리: "충분히 분리됨 + 응집 단위 부재 + 추출해도 목표 미달 → 추출 불필요".** "역참조 불가피 → bottom-up 추출"이 항상 답은 아니다. 공유 코어가 이미 깨끗하면 추출조차 불필요하다(T07 "순환 아님"과 같은 결의 "이미 분리됨"). **proxy는 hook 대칭 수집 어댑터로 server에 영구 잔존 확정.** 사이클#2는 물리 추출 없이 종결하거나, 경량 경계 정리(sse의 `NormalizedRequest` 타입을 `@spyglass/types`로 이관 → sse 코어 type 의존 0)로 축소한다.

## 비고 — over-engineering 가드

각 단계 완료 후 다음을 자문하고 문서에 기록한다.

- 이 변경이 실제 결합/위험을 줄였는가, 아니면 간접 계층만 추가했는가?
- 분리된 경계가 향후 변경을 더 쉽게 하는가, 아니면 파일만 이동했는가?
- 기존 동작·테스트·이벤트 흐름이 100% 동일한가?

"이전 상태 유지가 낫다"는 결론이 나오면 해당 단계를 revert하고 그 판단을 plan에 남긴다.
