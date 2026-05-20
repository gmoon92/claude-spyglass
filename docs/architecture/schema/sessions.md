# sessions 테이블

Claude Code 세션 단위 정보를 저장하는 테이블입니다.

## 개요

| 항목 | 내용 |
|------|------|
| 목적 | Claude Code 세션 단위 추적 |
| 관련 스키마 | `${CLAUDE_PROJECT_DIR}/packages/storage/src/schema.ts` |

## 컬럼 정의

| 컬럼명 | 타입 | 제약조건 | 설명 |
|--------|------|----------|------|
| `id` | TEXT | PRIMARY KEY | 세션 고유 ID (Claude Code에서 생성) |
| `project_name` | TEXT | NOT NULL | 프로젝트명 (cwd의 basename) |
| `started_at` | INTEGER | NOT NULL | 세션 시작 시간 (Unix timestamp, milliseconds) |
| `ended_at` | INTEGER | NULL | 세션 종료 시간 (NULL = 활성 세션) |
| `total_tokens` | INTEGER | DEFAULT 0 | 세션 누적 토큰 수 |
| `created_at` | INTEGER | DEFAULT (strftime('%s', 'now')) | 레코드 생성 시간 (Unix timestamp, seconds) |

### 런타임 derive 컬럼 (DB 컬럼 아님)

| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| `first_prompt_payload` | TEXT \| null | 세션 첫 번째 프롬프트 페이로드 — SELECT 시 서브쿼리로 산출 |
| `last_activity_at` | INTEGER \| null | 마지막 visible request의 timestamp — `MAX(r.timestamp)` LEFT JOIN으로 산출 |
| `live_state` | 'live' \| 'stale' \| 'ended' | 세션 라이브 상태 — `_shared.buildLiveStateColumn` CASE식으로 산출 |

`live_state` 정의 → `${CLAUDE_PROJECT_DIR}/packages/storage/src/queries/session/_shared.ts` 참조

## 인덱스

| 인덱스명 | 컬럼 | 용도 |
|----------|------|------|
| `idx_sessions_started_at` | `started_at DESC` | 최근 세션 조회 |
| `idx_sessions_project` | `project_name` | 프로젝트별 세션 필터링 |

## 외래키

sessions 테이블 자체에 외래키 제약은 없습니다. 하위 테이블에서 이 테이블을 참조합니다.

## 관계

- **1:N** → `requests` 테이블 (`session_id` REFERENCES sessions(id) ON DELETE CASCADE)
- **1:N** → `claude_events` 테이블 (`session_id` 참조)

## 참고사항

- 세션 종료는 `SessionEnd` 또는 `Stop` 훅 이벤트로 감지
- `total_tokens`는 `requests` 테이블 해당 세션의 토큰 합계와 동기화 필요
- "visible 세션" 판단 기준(pre_tool 제외, Agent 예외)은 `_shared.buildVisibleSessionPredicate` 참조
- LIVE 임계값(stale 보정 30분)은 `_shared.LIVE_STALE_THRESHOLD_MS` 참조
