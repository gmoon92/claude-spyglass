# metrics 의존성 정밀 분석 노트 (T01)

- 작성일: 2026-05-30
- 대상: `packages/server/src/metrics/` (`_shared.ts`, `router.ts`, `calculators/{anomaly,burn-rate,cache-trend,proxy-trend}.ts`)
- 상위 작업: [plan-01-server-leaf-extraction](./plan-01-server-leaf-extraction.md) T01
- 분석 방법: 전 파일 import 전수 grep + 역방향(소비처) grep. 추측 없이 `파일:라인` 근거.

> 참고: `calculators/context-saturation.ts` 파일은 존재하지 않는다. context-saturation 로직은
> `calculators/anomaly.ts`에 통합되어 있고(`detectContextSaturation` 등), 테스트만 별도 파일
> `calculators/__tests__/context-saturation.test.ts`로 분리되어 있다.

---

## (a) metrics import 방향 요약 표

| 파일 | 외부 npm / 런타임 | `@spyglass/*` 패키지 | metrics 내부 | server 코어 형제 모듈 |
| --- | --- | --- | --- | --- |
| `_shared.ts` | — | — | — | — |
| `router.ts` | `bun:sqlite`(type) | `@spyglass/storage` (10개 read 함수) | `./_shared`, `./calculators/{burn-rate,cache-trend,proxy-trend,anomaly}` | `../model-limits`, `../tool-category` |
| `calculators/anomaly.ts` | `bun:sqlite`(type) | `@spyglass/storage` (`getMaxContextProxyForSession`, `AnomalyInputRow` type) | — | `../../model-limits`, `../../anomaly-thresholds` |
| `calculators/burn-rate.ts` | `bun:sqlite`(type) | `@spyglass/storage` (`getBurnRateBuckets`) | `../_shared` | — |
| `calculators/cache-trend.ts` | `bun:sqlite`(type) | `@spyglass/storage` (`getCacheTrendBuckets`) | `../_shared` | — |
| `calculators/proxy-trend.ts` | `bun:sqlite`(type) | — (직접 SQL: `stats_proxy_hourly`) | `../_shared` | — |

근거(파일:라인):
- `router.ts:31-50` — `@spyglass/storage`, `../model-limits`, `../tool-category`, `./_shared`, `./calculators/*`
- `calculators/anomaly.ts:25-31` — `@spyglass/storage`, `../../model-limits`, `../../anomaly-thresholds`
- `calculators/burn-rate.ts:13-15`, `cache-trend.ts:12-14`, `proxy-trend.ts:12-13`
- `_shared.ts` — import 문 없음(순수 함수/타입만)

---

## (b) 역참조 유무 결론 (추출 안전성 판정)

### 판정: **추출 안전 (NO 코어 역참조, NO 순환)**

1. **server 코어 디렉토리(domain/runtime/routes/hook/settings/proxy/meta-docs/cli) 역참조: 0건.**
   - grep 결과 `metrics/`에서 위 디렉토리로의 import 0건 (확인 명령: `grep -rn "from '\.\./\(domain\|runtime\|...\)'" packages/server/src/metrics`).

2. **metrics가 의존하는 server-root 형제 모듈 3종은 모두 leaf 유틸리티다.**
   - `../model-limits` (`packages/server/src/model-limits.ts`): import는 `@spyglass/storage`만. (`model-limits.ts:38`)
   - `../tool-category` (`packages/server/src/tool-category.ts`): import 0건 (순수 상수/함수).
   - `../../anomaly-thresholds` (`packages/server/src/anomaly-thresholds.ts`): import 0건.
   - 세 모듈 모두 코어 오케스트레이션 모듈이 아니라 평면 유틸이다. 따라서 metrics 추출 시 함께(또는 사전에) 옮기면 되는 보조 의존이며, 코어로의 역참조가 아니다.

3. **순환 없음.**
   - 위 3개 유틸이 `metrics`를 import하는지 확인 → import 0건. (`anomaly-thresholds.ts:18`의 "metrics" 출현은 **주석 내 doc 참조**이며 import 아님.)
   - 따라서 metrics ↔ (model-limits / tool-category / anomaly-thresholds) 사이에 양방향 의존이 없다.

### over-eng 가드 자문 (ADR 비고)
- metrics는 형제 코어를 0번 참조하므로 추출이 간접 계층만 늘리는 것이 아니라 실제 leaf 경계를 그대로 패키지로 승격한다. → **추출 비용 < 효익. T02 진행 권장.**
- 단, T02는 `model-limits`/`tool-category`/`anomaly-thresholds` 3개 유틸을 함께 이동(또는 `@spyglass/storage` 등 공통 위치로 선반출)해야 한다. 이를 누락하면 `@spyglass/metrics → @spyglass/server` 역의존이 생긴다. **이 3종이 T02의 동반 이동 대상임을 명시한다.**

---

## (c) 추출 시 이동할 파일 / 노출 표면 목록

### 이동 대상 파일 (metrics 본체)
- `packages/server/src/metrics/_shared.ts`
- `packages/server/src/metrics/router.ts`
- `packages/server/src/metrics/calculators/anomaly.ts`
- `packages/server/src/metrics/calculators/burn-rate.ts`
- `packages/server/src/metrics/calculators/cache-trend.ts`
- `packages/server/src/metrics/calculators/proxy-trend.ts`
- `packages/server/src/metrics/calculators/__tests__/anomaly.test.ts`
- `packages/server/src/metrics/calculators/__tests__/context-saturation.test.ts`
- `packages/server/src/metrics.ts` (barrel shim — 이동 또는 재배치)

### 동반 이동(또는 선반출) 필요 — metrics 외부 의존 유틸
- `packages/server/src/model-limits.ts` — `router.ts`, `anomaly.ts`가 사용
- `packages/server/src/tool-category.ts` — `router.ts`가 사용
- `packages/server/src/anomaly-thresholds.ts` — `anomaly.ts`가 사용

> 주의: 위 3종은 metrics 외 다른 코어 모듈도 사용할 수 있으므로, "함께 metrics 패키지로 이동" vs
> "`@spyglass/types`/`@spyglass/storage` 또는 신규 공통 패키지로 선반출" 중 무엇이 역의존을 만들지
> T02에서 각 유틸의 다른 소비처를 재확인한 뒤 결정한다.

### 노출 표면 (패키지 public API로 export해야 하는 심볼)
- `metricsRouter` (router.ts) — HTTP 라우터. 소비처: `api.ts`.
- `calculators/anomaly`의 도메인 검출 심볼 — 소비처: `domain/anomaly-enricher.ts`.
  - `computeRowAnomalies`, `detectAgentSpike`, `detectAgentSpikeBatch`, `buildAgentSpikeFromBatch`,
    `isAgentSpikeParentCandidate`, `detectBloatedSys`, `detectContextSaturation`,
    `toAgentSpikeField`, `toBloatedSysField`, `toContextSaturationField`
- (간접) `_shared.ts`의 `parseTimeWindow`/`buildMeta`/`jsonResponse`/`fillHourSlots`/`TimeWindow` 등은
  현재 metrics 내부에서만 소비. 외부 노출 불필요(패키지 내부 유지 가능).

### router.ts가 쓰는 외부 심볼 (추출 시 함께 이동/해결할 경계)
- `@spyglass/storage`: `getActiveSessionCount`, `getActivityHeatmap`, `getAgentCallsPerSession`,
  `getAnomalyTimeSeriesInputs`, `getCompactionSessionCount`, `getModelCacheMatrix`,
  `getModelUsageStats`, `getSessionContextUsage`, `getToolCategoryRawCounts`, `getTurnsPerSession` (`router.ts:32-43`)
- `../model-limits`: `getModelMaxTokens`, `getAllModelLimits` (`router.ts:44`)
- `../tool-category`: `categorizeToolName`, `ALL_TOOL_CATEGORIES`, `ToolCategory`(type) (`router.ts:45`)

---

## (d) 소비처 전수 목록 (파일:라인)

| 소비처 | import 대상 | 위치 |
| --- | --- | --- |
| `packages/server/src/api.ts` | `metricsRouter` (`./metrics` barrel 경유) | `api.ts:24` (import), `api.ts:74` (호출) |
| `packages/server/src/metrics.ts` | `metricsRouter` re-export shim | `metrics.ts:11` |
| `packages/server/src/domain/anomaly-enricher.ts` | anomaly 검출 10개 심볼 (`../metrics/calculators/anomaly`) | `anomaly-enricher.ts:25-35` |

비-import 참조(주석/문서, 코드 의존 아님 — 정리 시 참고용):
- `packages/server/src/routes/stats.ts:18` — 주석: "/api/metrics/*는 metricsRouter가 담당"
- `packages/server/src/hook/persist.ts:287` — 주석: "metrics/calculators/anomaly.ts 의 WITH RECURSIVE"
- `packages/server/src/anomaly-thresholds.ts:18` — 주석: metrics/calculators/anomaly.ts doc 참조

> 결론: 코드 레벨 실제 소비처는 **api.ts(라우터) + anomaly-enricher.ts(anomaly 함수군)** 2곳뿐이며,
> `metrics.ts`는 호환 shim이다. T02에서 이 2곳을 `@spyglass/metrics`로 교체하면 충분하다.
