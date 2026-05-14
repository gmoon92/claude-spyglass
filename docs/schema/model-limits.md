# model_limits 테이블

Claude 모델별 context window 한도(max_tokens)를 저장하는 테이블입니다.

## 개요

| 항목 | 내용 |
|------|------|
| 목적 | 모델별 context window 한도 SSoT — 코드 하드코딩 대신 DB 데이터로 관리 |
| 관련 스키마 | `${CLAUDE_PROJECT_DIR}/packages/storage/migrations/026-model-limits-table.sql` |

## 컬럼 정의

| 컬럼명 | 타입 | 제약조건 | 설명 |
|--------|------|----------|------|
| `pattern` | TEXT | PRIMARY KEY | 모델명 포함 여부로 매칭되는 패턴 (substring match) |
| `max_tokens` | INTEGER | NOT NULL | 토큰 단위 context window 한도 |
| `notes` | TEXT | NULL | 출처·근거 메모 (GA 발표일, 메이커 발표값 등) |

## 추론 우선순위

동일 모델에 대해 여러 규칙이 경쟁할 경우 아래 순서로 결정됩니다.

| 순위 | 조건 | 결과 |
|------|------|------|
| 1 | 모델명에 `[1m]` suffix 포함 | 1,000,000 (EXTENDED) |
| 2 | `anthropic-beta` 헤더에 `context-1m-2025-08-07` 토큰 포함 | 1,000,000 (EXTENDED) |
| 3 | 이 테이블의 `pattern` 최장 매칭 | 해당 행의 `max_tokens` |
| 4 | 위 모두 미매칭 | 200,000 (폴백) |

추론 구현 → `${CLAUDE_PROJECT_DIR}/packages/server/src/model-limits.ts: getModelMaxTokens()` 참조

## 시드 데이터 (기본값)

| pattern | max_tokens | 설명 |
|---------|------------|------|
| `claude-opus-4-7` | 1,000,000 | Anthropic Opus 4.7 — GA 1M context |
| `claude-opus-4-6` | 1,000,000 | Anthropic Opus 4.6 — GA 1M context |
| `claude-sonnet-4-6` | 1,000,000 | Anthropic Sonnet 4.6 — GA 1M context |
| `claude-opus-4` | 200,000 | Anthropic Opus 4.x 표준 (GA 1M 미포함 베이스) |
| `claude-sonnet-4` | 200,000 | Anthropic Sonnet 4.x 표준 (GA 1M 미포함 베이스) |
| `claude-haiku-4` | 200,000 | Anthropic Haiku 4.x 표준 |
| `claude-3-5-sonnet` | 200,000 | Anthropic Sonnet 3.5 표준 |
| `claude-3-5-haiku` | 200,000 | Anthropic Haiku 3.5 표준 |
| `claude-3-opus` | 200,000 | Anthropic Opus 3 표준 |
| `kimi-k2` | 128,000 | Moonshot Kimi K2 — 운영자 보정 가능 |

패턴이 더 구체적(긴 것)일수록 먼저 매칭됩니다. 조회 쿼리는 `ORDER BY length(pattern) DESC`로 정렬하여 최장 우선 적용을 보장합니다.

## 갱신 방법

테이블은 서버 **프로세스 시작 시** `getAllModelLimits()` 호출로 전체 시드를 메모리에 로드합니다. 이후 요청마다 DB를 재조회하지 않고 인메모리 캐시를 사용합니다.

- **신규 모델 추가**: migration SQL 파일에 `INSERT OR IGNORE` 추가 또는 운영자가 직접 `INSERT`/`UPDATE`
- **즉시 반영**: `invalidateModelLimitsCache()` 호출 → 다음 추론부터 DB를 재조회 (일반적으로는 프로세스 재시작이 더 명확)
- **멱등 보장**: `INSERT OR IGNORE` 정책으로 마이그레이션 재실행에도 안전

쿼리 구현 → `${CLAUDE_PROJECT_DIR}/packages/storage/src/queries/model-limits.ts: getAllModelLimits()` 참조

## 관계

- 이 테이블은 다른 테이블을 참조하거나 참조받지 않습니다.
- `proxy_requests.model` 및 `proxy_requests.anthropic_beta` 값을 입력으로 받아 추론 시 사용합니다.

## 참고사항

- `pattern`은 exact match가 아닌 **substring match**입니다. `model.includes(pattern)` 방식으로 동작합니다.
- Anthropic 외 모델(Kimi 등)도 이 테이블로 관리하여 코드 변경 없이 신규 모델을 지원합니다.
- `/api/metrics/context-usage` 등 사용률 계산 정확도가 이 테이블을 통해 모델 확장과 함께 자동으로 진화합니다.
