# 대시보드 개선 계획

> 작성일: 2026-04-18  
> 목표: 미표시 데이터 항목 노출, 요청/응답 구분, 응답 시간 통계 추가, 항목 표시 일관성 확보

---

## 배경

현재 DB에 저장되지만 대시보드에서 표시되지 않는 항목:

| 필드 | 문제 |
|------|------|
| `tokens_input` / `tokens_output` | `tokens_total`만 표시, 입출력 분리 없음 |
| `duration_ms` | 플랫 뷰/최근 요청 테이블에서 미표시 |
| `sessions.ended_at` 시간값 | 활성/종료 여부만 표시, 종료 시각 없음 |
| `payload` 전체 내용 | `prompt` 타입 60자만, 다른 타입 아예 없음 |
| `source` | DB 컬럼 자체 없음 — 훅에서 보내지만 유실 |

---

## 개선 범위

### Layer 1 — DB Schema (schema v4)
`source` 컬럼 추가 (현재 훅이 전송하나 DB에 없어 유실)

### Layer 2 — API (`api.ts`)
`/api/dashboard` summary에 `avgDurationMs` 추가

### Layer 3 — Dashboard HTML (`packages/web/index.html`)
- 요약 카드 개선 (5번째: 평균 응답시간)
- 플랫 뷰 컬럼 개선
- 최근 요청 테이블 컬럼 개선
- 턴 뷰 요청/응답 구분 강화
- payload 전개 일관화

---

## 코드 분석에서 추가 발견된 불일치

| 번호 | 위치 | 문제 |
|------|------|------|
| A | `togglePromptExpand()` 747행 | `colspan="5"` 하드코딩 — 플랫 뷰(4컬럼)에서 expand 행 삐져나옴 **버그** |
| B | `promptPreview()` 725행 | `prompt` 타입만 미리보기, `tool_call`/`system` payload 표시 안 됨 |
| C | 턴 뷰 inline 코드 962행 | payload 미리보기를 `promptPreview()`와 별도로 중복 구현 (80자 vs 60자) |
| D | `renderDetailRequests()` | `duration_ms`, `model` 배지 없음 |
| E | `renderRequests()` | `duration_ms`, `model` 배지 없음 |
| F | 턴 뷰 prompt 행 979행 | `duration_ms` 자리가 빈 `<span></span>` — 의도적으로 비워둔 상태 |
| G | 턴 헤더 999-1000행 | `total_tokens`가 `meta` 문자열과 `turn-tokens`에 중복 표시 |
| H | `renderTools()` | API가 반환하는 `avg_tokens` 렌더링 안 함 |

---

## 세부 작업 목록

### T-01: DB 마이그레이션 v4 — `source` 컬럼 추가

**파일**: `packages/storage/src/schema.ts`

```sql
ALTER TABLE requests ADD COLUMN source TEXT DEFAULT 'claude-code-hook';
```

- `SCHEMA_VERSION` 4로 변경
- `MIGRATION_V4` 상수 추가
- `Request` 인터페이스에 `source?: string` 추가

**커밋**: `feat(storage): schema v4 — requests.source 컬럼 추가`

---

### T-02: collect.ts — `source` 저장

**파일**: `packages/server/src/collect.ts`

`createRequest()` 호출 시 `source: payload.source` 전달

**커밋**: `feat(collect): source 필드 DB 저장`

---

### T-03: API — 평균 응답시간 집계 추가

**파일**: `packages/server/src/api.ts`  
**파일**: `packages/storage/src/index.ts` (쿼리 추가)

`/api/dashboard` summary에 아래 필드 추가:
```ts
avgDurationMs: number   // prompt 타입 duration_ms 평균
```

쿼리:
```sql
SELECT ROUND(AVG(duration_ms)) as avg_duration_ms
FROM requests
WHERE type = 'prompt' AND duration_ms > 0
```

**커밋**: `feat(api): dashboard summary에 avgDurationMs 추가`

---

### T-04: HTML — 요약 카드 5번째 추가 (평균 응답시간)

**파일**: `packages/web/index.html`

- `summary-grid` 에 카드 1개 추가: **평균 응답시간**
- `grid-template-columns: repeat(4,1fr)` → `repeat(5,1fr)` (반응형 breakpoint 조정)
- `fetchDashboard()` 에서 `d.summary.avgDurationMs` 바인딩

표시 형식:
- `< 1000ms` → `{N}ms`
- `≥ 1000ms` → `{N.N}s`

**커밋**: `feat(web): 평균 응답시간 요약 카드 추가`

---

### T-05: HTML — 플랫 뷰 컬럼 개선

**파일**: `packages/web/index.html`

현재:
```
시각 | 타입 | 툴 | 토큰
```

변경:
```
시각 | 타입 | 툴 | IN | OUT | 응답시간
```

- `th`: 토큰 컬럼 → `IN` / `OUT` 2개로 분리, `응답시간` 추가
- `renderDetailRequests()`: `tokens_input`, `tokens_output`, `duration_ms` 렌더링
- `tool_call` / `system` 타입도 `duration_ms` 있으면 표시
- `colspan` 관련 코드 일괄 수정 (4 → 6)
- `promptPreview()` — `prompt` 외 타입도 payload가 있으면 미리보기 표시 (일관성)

**커밋**: `feat(web): 플랫 뷰 토큰 입출력 분리 및 응답시간 컬럼 추가`

---

### T-06: HTML — 최근 요청 테이블 컬럼 개선

**파일**: `packages/web/index.html`

현재:
```
시각 | 타입 | 툴 | 토큰 | 세션 ID
```

변경:
```
시각 | 타입 | 툴 | IN | OUT | 응답시간 | 세션 ID
```

- `renderRequests()` 수정
- `colspan` 5 → 7

**커밋**: `feat(web): 최근 요청 테이블 토큰 입출력 분리 및 응답시간 추가`

---

### T-07: HTML — 턴 뷰 요청/응답 구분 강화

**파일**: `packages/web/index.html`

**prompt 행**:
- 현재: 토큰 합계만 표시
- 변경: `IN {tokens_input}` / `OUT {tokens_output}` 분리 표시
- `duration_ms` > 0이면 응답시간 표시 (`⏱ {N}ms`)

**turn 헤더**:
- `도구 N개 · X토큰` → `도구 N개 · IN Xk / OUT Xk · ⏱ Nms`

**grid 컬럼**: `28px 1fr 60px 60px 80px` → `28px 1fr 50px 50px 70px 80px`

**커밋**: `feat(web): 턴 뷰 prompt 행 토큰 입출력·응답시간 표시 개선`

---

### T-08: HTML — 세션 상세 헤더 종료 시각 추가

**파일**: `packages/web/index.html`

`detailTokens` 옆에 종료 시각 표시:
- 활성 세션: 표시 없음
- 종료 세션: `종료: HH:MM:SS`

**커밋**: `feat(web): 세션 상세 헤더에 종료 시각 추가`

---

## 작업 순서 및 의존성

```
T-01 → T-02          (DB 먼저, collect은 컬럼 있어야 저장 가능)
T-03                 (독립)
T-04                 (T-03 완료 후 — avgDurationMs API 필요)
T-05, T-06, T-07, T-08  (독립적으로 진행 가능)
```

## 예상 영향 범위

| 파일 | 변경 유형 |
|------|----------|
| `packages/storage/src/schema.ts` | 마이그레이션 추가, 타입 수정 |
| `packages/server/src/collect.ts` | source 저장 추가 |
| `packages/server/src/api.ts` | avgDurationMs 집계 추가 |
| `packages/web/index.html` | HTML/JS 복수 위치 수정 |

## 주의 사항

- T-01 마이그레이션은 기존 DB에 소급 적용 필요 (`DEFAULT 'claude-code-hook'`)
- HTML 변경 시 `colspan` 숫자가 여러 곳에 흩어져 있으므로 누락 없이 수정
- `duration_ms = 0` 인 레코드는 미수집 상태이므로 `—` 표시 (0 그대로 노출 금지)
