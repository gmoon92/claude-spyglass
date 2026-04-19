# sessions 테이블

Claude Code 세션 단위 정보를 저장하는 테이블입니다.

## 개요

| 항목 | 내용 |
|------|------|
| 목적 | Claude Code 세션 단위 추적 |
| 레코드 수 | 20개 (현재 기준) |
| 주요 프로젝트 | claude-spyglass(16), rv-iso(3) |

## 컬럼 정의

| 컬럼명 | 타입 | 제약조건 | 설명 |
|--------|------|----------|------|
| `id` | TEXT | PRIMARY KEY | 세션 고유 ID (Claude Code에서 생성) |
| `project_name` | TEXT | NOT NULL | 프로젝트명 (cwd의 basename) |
| `started_at` | INTEGER | NOT NULL | 세션 시작 시간 (Unix timestamp, milliseconds) |
| `ended_at` | INTEGER | NULL | 세션 종료 시간 (NULL = 활성 세션) |
| `total_tokens` | INTEGER | DEFAULT 0 | 세션 누적 토큰 수 |
| `created_at` | INTEGER | DEFAULT (strftime('%s', 'now')) | 레코드 생성 시간 (Unix timestamp, seconds) |

## 인덱스

| 인덱스명 | 컬럼 | 용도 |
|----------|------|------|
| `idx_sessions_started_at` | `started_at DESC` | 최근 세션 조회 |
| `idx_sessions_project` | `project_name` | 프로젝트별 세션 필터링 |

## 데이터 샘플

```sql
-- 활성 세션 조회
SELECT * FROM sessions WHERE ended_at IS NULL;

-- 프로젝트별 세션 통계
SELECT project_name, COUNT(*) as count
FROM sessions
GROUP BY project_name
ORDER BY count DESC;
```

## 관계

- **1:N** → `requests` 테이블 (`session_id` 외래키)
- **1:N** → `claude_events` 테이블 (`session_id` 참조)

## 참고사항

- 세션 종료는 `SessionEnd` 또는 `Stop` 훅 이벤트로 감지
- `total_tokens`는 `requests` 테이블의 해당 세션 토큰 합계와 동기화 필요
