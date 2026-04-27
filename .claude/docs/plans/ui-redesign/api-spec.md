# UI Redesign Phase 2 — Metrics API Spec

> **목적**: 옵저빌리티 강화를 위해 새로 도입되는 시각 지표 8종의 백엔드 API 명세.
> designer는 이 문서만 보고 프론트엔드 시각화를 작성할 수 있어야 한다.
>
> **작성일**: 2026-04-23
> **담당**: data-analyst
> **읽는 사람**: ui-designer (Phase 2 시각화 구현 담당)

---

## 0. 공통 사항

### Base URL
```
http://localhost:9999
```

### 라우트 prefix
모든 신규 메트릭 엔드포인트는 `/api/metrics/*` 하위에 위치한다.
기존 `/api/dashboard`, `/api/stats/*` 응답은 변경되지 않으며, 가격 환산($) 필드는 deprecated 표시만 추가됨 (10. 가격 정책 참조).

### 공통 쿼리 파라미터

| 이름 | 값 | 의미 |
|---|---|---|
| `range` | `24h` (default) / `7d` / `30d` / `all` | 사전 정의 시간 윈도우 |
| `from` | Unix ms | 시작 타임스탬프 (range보다 우선) |
| `to`   | Unix ms | 종료 타임스탬프 (range보다 우선) |

`from` 또는 `to`가 명시되면 `range`는 무시되고 `meta.range = "custom"`이 된다.

### 공통 응답 envelope

```json
{
  "success": true,
  "data": <지표별 페이로드>,
  "meta": {
    "range": "24h",
    "from": 1776447327357,
    "to":   1777133727357,
    "generated_at": 1777133727357
  }
}
```

오류 시:
```json
{ "success": false, "error": "<message>" }
```

### 가격 단위 정책

- **모든 신규 엔드포인트는 가격($) 환산을 노출하지 않는다.**
- 토큰 단위 raw 카운트와 비율(0~1 또는 0~100)만 제공한다.
- 기존 응답의 USD 필드는 `_deprecated_cost_fields` 메타로 명시되며 designer는 사용하지 말 것.

### 시간 단위

- 모든 timestamp 필드는 Unix milliseconds (number) 또는 ISO8601 (string) 중 한 가지로 명시.
- weekday는 SQLite strftime('%w') 기준 — `0=Sun, 1=Mon, ..., 6=Sat`.
- hour는 0~23 (서버 로컬타임).

---

## 1. 모델 사용량 비율 (Donut)

### Endpoint
```
GET /api/metrics/model-usage
```

### 쿼리 파라미터
공통 파라미터(`range` / `from` / `to`).

### 응답 스키마

```typescript
interface ModelUsageItem {
  model: string;          // 예: "claude-opus-4-7"
  request_count: number;  // 윈도우 내 prompt 호출 수
  total_tokens: number;   // 윈도우 내 누적 토큰 (tokens_confidence='high'만)
  avg_tokens: number;     // 평균 토큰/요청
  percentage: number;     // request_count 기준 비율 (소수점 1자리, %)
}

interface Response {
  success: true;
  data: ModelUsageItem[];   // 내림차순 정렬 (request_count DESC)
  meta: MetricMeta;
}
```

### 응답 예시 (range=7d)

```json
{
  "success": true,
  "data": [
    { "model": "claude-opus-4-7", "request_count": 78, "total_tokens": 114055, "avg_tokens": 1462, "percentage": 97.5 },
    { "model": "claude-sonnet-4-6", "request_count": 1, "total_tokens": 225, "avg_tokens": 225, "percentage": 1.3 },
    { "model": "<synthetic>", "request_count": 1, "total_tokens": 0, "avg_tokens": 0, "percentage": 1.3 }
  ],
  "meta": { "range": "7d", "from": 1776528927357, "to": 1777133727357, "generated_at": 1777133727357 }
}
```

### 권장 시각화
도넛 차트(전체 = 100%). 각 조각: `model` 라벨 + `request_count` 숫자 + `percentage`. 서브텍스트로 `total_tokens` 표시.

---

## 2. 모델별 캐시 적중률 매트릭스

### Endpoint
```
GET /api/metrics/cache-matrix
```

### 응답 스키마

```typescript
interface CacheMatrixRow {
  model: string;
  total_input: number;    // 비캐시 input 토큰 합
  cache_read: number;     // 캐시 read 토큰 합 (재사용)
  cache_create: number;   // 캐시 생성 토큰 합 (1회성)
  hit_rate: number;       // cache_read / (total_input + cache_read), 0~1, 소수점 4자리
}

interface Response {
  success: true;
  data: CacheMatrixRow[];   // total_input + cache_read DESC
  meta: MetricMeta;
}
```

### 응답 예시

```json
{
  "success": true,
  "data": [
    { "model": "claude-opus-4-7",   "total_input": 223, "cache_read": 33127685, "cache_create": 180375, "hit_rate": 0.9999 },
    { "model": "claude-sonnet-4-6", "total_input": 3,   "cache_read": 67623,    "cache_create": 637,    "hit_rate": 0.9999 }
  ],
  "meta": { "range": "7d", "from": 1776528927370, "to": 1777133727370, "generated_at": 1777133727370 }
}
```

### 권장 시각화
행 = 모델, 열 = `cache_read` / `cache_create` / `total_input` (스택 막대) + `hit_rate` (백분율 텍스트).
또는 모델당 작은 가로 막대 3색 (read/create/no_cache).

### 설계 노트
- `hit_rate`는 `cache_read / (cache_read + total_input)` 정의. cache_create는 분모/분자 모두 미포함 (Anthropic 기준).
- `no_cache_rate = total_input / (total_input + cache_read)` 로 클라이언트 계산 가능.
- `cache_create_rate = cache_create / (total_input + cache_read + cache_create)` 별도 계산.

---

## 3. 컨텍스트 사용률 분포 히스토그램

### Endpoint
```
GET /api/metrics/context-usage
```

### 응답 스키마

```typescript
interface ContextUsageBucket {
  label: string;                    // "<50%" | "50-80%" | "80-95%" | ">95%"
  range: [number, number];          // [min, max] (max=Infinity는 JSON에서 null로 직렬화될 수 있음)
  session_count: number;
}

interface Response {
  success: true;
  data: {
    buckets: ContextUsageBucket[];        // 항상 4개 버킷 고정 순서
    total: number;                        // 분석 대상 세션 수
    model_limits: Record<string, number>; // 모델 prefix → max_tokens (designer 참고용)
  };
  meta: MetricMeta;
}
```

### 응답 예시

```json
{
  "success": true,
  "data": {
    "buckets": [
      { "label": "<50%",   "range": [0,    0.5],  "session_count": 1 },
      { "label": "50-80%", "range": [0.5,  0.8],  "session_count": 3 },
      { "label": "80-95%", "range": [0.8,  0.95], "session_count": 0 },
      { "label": ">95%",   "range": [0.95, null], "session_count": 6 }
    ],
    "total": 10,
    "model_limits": {
      "claude-opus-4":     200000,
      "claude-sonnet-4":   200000,
      "claude-haiku-4":    200000,
      "claude-3-5-sonnet": 200000,
      "claude-3-5-haiku":  200000,
      "claude-3-opus":     200000,
      "_default":          200000
    }
  },
  "meta": { "range": "7d", "from": 1776528927383, "to": 1777133727383, "generated_at": 1777133727383 }
}
```

### 권장 시각화
4-bin 히스토그램. >95% 버킷은 위험 색(빨강), 80-95%는 주의(주황). designer는 색상 매핑을 결정.

### 설계 노트
- "컨텍스트 사용률" = 세션 마지막 prompt의 (`tokens_input + cache_read + cache_creation`) ÷ 모델 max_tokens.
- 모델 한도 매핑은 **서버에서 적용**. `model_limits`는 designer가 별도 시각화에 활용할 수 있도록 함께 노출 (필수는 아님).
- `total = 0`이면 모든 버킷 `session_count = 0` — empty state 처리 필요.

---

## 4. 시간대별 활동 heatmap

### Endpoint
```
GET /api/metrics/activity-heatmap
```

### 응답 스키마

```typescript
interface Response {
  success: true;
  data: {
    cells: number[][];          // [7][24] 격자 — cells[weekday][hour] = count
    total: number;              // 윈도우 내 전체 request 수
    weekday_labels: string[];   // ["Sun", "Mon", ..., "Sat"]
  };
  meta: MetricMeta;
}
```

### 응답 예시 (range=7d)

```json
{
  "success": true,
  "data": {
    "cells": [
      [24, 84, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 78, 84, 77, 148, 84, 36, 68, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 171, 354, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    ],
    "total": 1208,
    "weekday_labels": ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  },
  "meta": { "range": "7d", "from": 1776528927395, "to": 1777133727395, "generated_at": 1777133727395 }
}
```

### 권장 시각화
GitHub 컨트리뷰션 캘린더 스타일 7×24 그리드. 셀 색상 강도 = `count / max(cells)`.

### 설계 노트
- 시간대는 서버 로컬타임 기준. UTC가 필요하면 designer 측에서 별도 클라이언트 변환.
- `total = 0`이면 모든 셀 0 — empty state 처리.

---

## 5. 세션당 turn 수 분포 + Compaction 발생률

### Endpoint
```
GET /api/metrics/turn-distribution
```

### 응답 스키마

```typescript
interface TurnBucket {
  bucket: string;       // "1-3" | "4-10" | "11-25" | "26-50" | "51+"
  session_count: number;
}

interface Response {
  success: true;
  data: {
    turn_distribution: TurnBucket[];   // 항상 5개 버킷 고정 순서
    compaction_rate: number;           // 0~1 (compacted_sessions / total_sessions)
    compacted_sessions: number;        // 분자
    total_sessions: number;            // 분모 (윈도우 내 prompt 활동 있는 세션)
  };
  meta: MetricMeta;
}
```

### 응답 예시

```json
{
  "success": true,
  "data": {
    "turn_distribution": [
      { "bucket": "1-3",   "session_count": 7 },
      { "bucket": "4-10",  "session_count": 3 },
      { "bucket": "11-25", "session_count": 1 },
      { "bucket": "26-50", "session_count": 1 },
      { "bucket": "51+",   "session_count": 0 }
    ],
    "compaction_rate": 0.1667,
    "compacted_sessions": 2,
    "total_sessions": 12
  },
  "meta": { "range": "7d", "from": 1776528951441, "to": 1777133751441, "generated_at": 1777133751441 }
}
```

### 권장 시각화
- turn_distribution: 5-bin 히스토그램.
- compaction_rate: 별도 큰 숫자 + 분수 표기 (예: "16.7% (2/12)").

### 설계 노트
- turn 수는 `requests.turn_id` distinct count (`type='prompt'` 기준).
- Compaction 발생 = `claude_events`에 PreCompact 또는 PostCompact 이벤트가 1건 이상 있는 세션.
- 분자는 "윈도우 내 활성 세션이면서 윈도우 내 compaction 이벤트가 발생한 세션"으로 한정 — 그렇지 않으면 비율이 1 초과 가능.

---

## 6. 에이전트 깊이 분포

### Endpoint
```
GET /api/metrics/agent-depth
```

### 응답 스키마

```typescript
interface DepthDistRow {
  depth: number;          // 세션당 Agent 호출 수 (0, 1, 2, ...)
  request_count: number;  // 해당 depth를 가진 세션 수
}

interface Response {
  success: true;
  data: {
    distribution: DepthDistRow[];   // depth ASC
    summary: {
      no_agent: number;       // depth=0 세션 수
      single_agent: number;   // depth=1 세션 수
      multi_agent: number;    // depth>=2 세션 수
      total: number;          // 전체 세션 수
    };
  };
  meta: MetricMeta;
}
```

### 응답 예시

```json
{
  "success": true,
  "data": {
    "distribution": [
      { "depth": 0, "request_count": 9 },
      { "depth": 1, "request_count": 1 },
      { "depth": 2, "request_count": 1 },
      { "depth": 9, "request_count": 1 }
    ],
    "summary": { "no_agent": 9, "single_agent": 1, "multi_agent": 2, "total": 12 }
  },
  "meta": { "range": "7d", "from": 1776528927428, "to": 1777133727428, "generated_at": 1777133727428 }
}
```

### 권장 시각화
- 빠른 요약: `summary` 3-바 막대 (no/single/multi).
- 상세: `distribution` 히스토그램 (x축=depth, y축=session count).

### 설계 노트
- "에이전트 깊이" = 세션 내 `tool_name='Agent'` 호출 수 (CLAUDE.md 명시).
- `depth=0` 세션은 Agent를 호출하지 않은 세션.

---

## 7. Tool 카테고리 분포

### Endpoint
```
GET /api/metrics/tool-categories
```

### 응답 스키마

```typescript
type ToolCategory = "FileOps" | "Search" | "Bash" | "MCP" | "Agent" | "Other";

interface CategoryRow {
  category: ToolCategory;
  request_count: number;
  percentage: number;     // 소수점 1자리, %
}

interface Response {
  success: true;
  data: CategoryRow[];   // ALL_TOOL_CATEGORIES 고정 순서, 0건 카테고리도 포함
  meta: MetricMeta;
}
```

### 응답 예시

```json
{
  "success": true,
  "data": [
    { "category": "FileOps", "request_count": 500, "percentage": 44.6 },
    { "category": "Search",  "request_count": 0,   "percentage": 0 },
    { "category": "Bash",    "request_count": 373, "percentage": 33.3 },
    { "category": "MCP",     "request_count": 42,  "percentage": 3.7 },
    { "category": "Agent",   "request_count": 168, "percentage": 15 },
    { "category": "Other",   "request_count": 38,  "percentage": 3.4 }
  ],
  "meta": { "range": "7d", "from": 1776528927440, "to": 1777133727440, "generated_at": 1777133727440 }
}
```

### 카테고리 매핑 (서버 측 `tool-category.ts`)

| Category | 포함 tool_name |
|---|---|
| FileOps | Read, Write, Edit, NotebookEdit, MultiEdit |
| Search  | Grep, Glob, WebSearch, WebFetch |
| Bash    | Bash, BashOutput, KillShell, KillBash |
| MCP     | `mcp__*` prefix |
| Agent   | Agent, Task, TaskCreate, TaskUpdate, TaskList, TaskOutput, TaskCompleted, TaskCreated, TaskStop, `Task*` prefix |
| Other   | 그 외 (Skill, ToolSearch, LSP, SendMessage, AskUserQuestion 등) |

### 권장 시각화
가로 막대 차트 또는 도넛 차트. 6개 카테고리 색상 매핑은 designer 결정.

---

## 8. Anomaly 시계열

### Endpoint
```
GET /api/metrics/anomalies-timeseries
```

### 추가 쿼리 파라미터

| 이름 | 값 | 의미 |
|---|---|---|
| `bucket` | `hour` (default) / `day` | 집계 시간 단위 |

### 응답 스키마

```typescript
interface AnomalyPoint {
  timestamp: string;   // ISO8601 (UTC), 버킷 시작 시각
  spike: number;       // 해당 버킷 내 spike anomaly 수
  loop: number;        // 해당 버킷 내 loop anomaly 수
  slow: number;        // 해당 버킷 내 slow anomaly 수
}

interface Response {
  success: true;
  data: AnomalyPoint[];   // timestamp ASC
  meta: MetricMeta;
}
```

### 응답 예시 (bucket=day)

```json
{
  "success": true,
  "data": [
    { "timestamp": "2026-04-24T00:00:00.000Z", "spike": 0, "loop": 311, "slow": 18 },
    { "timestamp": "2026-04-25T00:00:00.000Z", "spike": 0, "loop": 287, "slow": 35 }
  ],
  "meta": { "range": "7d", "from": 1776528951469, "to": 1777133751469, "generated_at": 1777133751469 }
}
```

### Anomaly 정의 (서버에서 동일 적용)

`packages/web/assets/js/anomaly.js`의 `detectAnomalies` 알고리즘을 서버에 이식.

| Anomaly | 정의 |
|---|---|
| **spike** | 동일 세션의 prompt `tokens_input` 평균의 200% 초과 (세션 내 prompt 2건 이상 시 비교) |
| **loop**  | 동일 `turn_id` 내에서 `tool_name`이 연속 3회 이상 반복 |
| **slow**  | tool_call의 `duration_ms`가 윈도우 전체 P95 초과 |

### 권장 시각화
- 라인 차트 3개 시리즈 (spike/loop/slow).
- 또는 누적 막대 차트 (시간 버킷별 합산).

### 설계 노트
- 클라이언트 `anomaly.js`는 in-memory 윈도우 전용 (현재 페이지 데이터). 신규 엔드포인트는 시간 윈도우 전체에 대해 계산.
- `bucket=day`는 7d/30d 범위에서, `bucket=hour`는 24h 범위에서 권장.
- 응답 길이는 hour 기준 24~720, day 기준 1~30 — 클라이언트가 부담스럽지 않음.

---

## 9. 엔드포인트 요약 표

| # | 지표 | Endpoint | Tier | 응답 사이즈 |
|---|---|---|---|---|
| 1 | 모델 사용량 비율 | `/api/metrics/model-usage` | 1 | 작음 (모델 수만큼) |
| 2 | 모델 캐시 매트릭스 | `/api/metrics/cache-matrix` | 1 | 작음 |
| 3 | 컨텍스트 사용률 | `/api/metrics/context-usage` | 1 | 4 버킷 고정 |
| 4 | 활동 heatmap | `/api/metrics/activity-heatmap` | 2 | 7×24 = 168 셀 |
| 5 | turn + compaction | `/api/metrics/turn-distribution` | 2 | 5 버킷 고정 |
| 6 | 에이전트 깊이 | `/api/metrics/agent-depth` | 2 | 작음 |
| 7 | Tool 카테고리 | `/api/metrics/tool-categories` | 3 | 6 카테고리 고정 |
| 8 | Anomaly 시계열 | `/api/metrics/anomalies-timeseries` | 3 | 시간 버킷만큼 |

---

## 10. 가격 정책 — 옵션 2 적용 결과

신규 엔드포인트는 **가격 환산이 전혀 없음**. 토큰 절감(`cache_read`, `cache_create` 등)만 노출.

기존 엔드포인트 변경 사항:

### `/api/dashboard`
응답 `data.summary`에 `_deprecated_cost_fields: ["costUsd", "cacheSavingsUsd"]` 추가됨.
**designer 가이드**: 이 필드들은 화면에 표시하지 말 것. 토큰 단위 지표(`totalTokens`, `cacheReadTokens` 등)만 사용.

### `/api/stats/strip`
응답 `data`에 `_deprecated_cost_fields: ["cost_usd", "cache_savings_usd"]` 추가됨.
**designer 가이드**: `p95_duration_ms`, `error_rate`만 사용.

### `/api/stats/cache`
응답 `data`에 `_deprecated_cost_fields: ["costWithCache", "costWithoutCache", "savingsUsd"]` 추가됨.
**designer 가이드**: `hitRate`, `cacheReadTokens`, `cacheCreationTokens`, `savingsRate`만 사용.
`savingsRate`는 (가격이 아닌) 토큰 비율로 환산되어 있으나 정의상 가격 비율이므로, 신규 화면에서는 모델별 cache_matrix를 사용 권장.

### 향후 (별도 라운드)
USD 필드들은 다음 마이너 버전에서 응답에서 제거할 수 있음. 그 전에 designer가 모든 사용처 제거 완료 필요.

---

## 11. 캐시·성능 고려사항

- 모든 신규 엔드포인트는 SELECT 전용. 기존 인덱스(`idx_requests_session_type`, `idx_requests_type`, `idx_events_type_time`)로 충분.
- `/api/metrics/anomalies-timeseries`는 윈도우 내 모든 request rows를 가져오므로 30d 범위에서는 응답이 클 수 있음. 필요시 클라이언트에서 캐싱.
- `/api/dashboard` 30초 in-memory 캐시는 그대로 유지. 신규 엔드포인트는 캐시 미적용 (실시간성 우선).

---

## 12. 산출물 파일 목록

- `packages/storage/src/queries/metrics.ts` — 신규 SELECT 쿼리 10개 함수
- `packages/storage/src/index.ts` — re-export 추가
- `packages/server/src/metrics.ts` — `/api/metrics/*` 라우터
- `packages/server/src/model-limits.ts` — 모델 max_tokens 매핑 유틸
- `packages/server/src/tool-category.ts` — Tool 카테고리 분류 유틸
- `packages/server/src/api.ts` — metricsRouter 통합 + 가격 deprecated 필드 추가
- `.claude/docs/plans/ui-redesign/api-spec.md` — 이 문서
