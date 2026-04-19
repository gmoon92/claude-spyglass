# 데이터베이스 스키마 문서

Claude Spyglass SQLite 데이터베이스 스키마 설명서입니다.

## 개요

| 항목 | 내용 |
|------|------|
| DB 파일 | `~/.spyglass/spyglass.db` |
| 엔진 | SQLite (WAL 모드) |
| 스키마 버전 | v9 |
| 테이블 수 | 3개 |

## 테이블 목록

| 테이블명 | 레코드 수 | 설명 | 문서 |
|----------|----------|------|------|
| `sessions` | 20 | 세션 단위 정보 | [sessions.md](./sessions.md) |
| `requests` | 3,527 | 요청/도구 호출 상세 | [requests.md](./requests.md) |
| `claude_events` | 157 | Raw 훅 이벤트 | [claude-events.md](./claude-events.md) |

## ERD

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│    sessions     │         │    requests     │         │ claude_events   │
├─────────────────┤         ├─────────────────┤         ├─────────────────┤
│ PK id           │◄────────┤ FK session_id   │         │ PK id           │
│    project_name │         │    type         │         │    event_id     │
│    started_at   │         │    tool_name    │         │    event_type   │
│    ended_at     │         │    tool_detail  │         │    session_id   │
│    total_tokens │         │    tokens_*     │         │    timestamp    │
│    created_at   │         │    duration_ms  │         │    payload      │
└─────────────────┘         │    payload      │         └─────────────────┘
                            │    ...          │
                            └─────────────────┘
```

## 마이그레이션 이력

| 버전 | 변경 내용 | 날짜 |
|------|-----------|------|
| v1 | 초기 스키마 (sessions, requests) | - |
| v2 | `requests.tool_detail` 컬럼 추가 | - |
| v3 | `requests.turn_id` 컬럼 + 기존 데이터 소급 적용 | - |
| v4 | `requests.source` 컬럼 추가 | - |
| v5 | `requests.cache_*_tokens` 컬럼 추가 | - |
| v6 | `claude_events` 테이블 신규 추가 | - |
| v7 | `requests.preview` 컬럼 추가 | - |
| v8 | `requests.tool_use_id`, `event_type` 추가 | - |
| v9 | Skill/Agent `tool_detail` 개선 | 2025-04-19 |

## 설정 (PRAGMA)

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -64000;  -- 64MB
PRAGMA foreign_keys = ON;
PRAGMA user_version = 9;
```

## 주요 쿼리 패턴

### 활성 세션 조회
```sql
SELECT * FROM sessions WHERE ended_at IS NULL;
```

### 세션별 요청 통계
```sql
SELECT
  s.id,
  s.project_name,
  COUNT(r.id) as request_count,
  SUM(r.tokens_total) as total_tokens
FROM sessions s
LEFT JOIN requests r ON s.id = r.session_id
GROUP BY s.id;
```

### 도구별 사용 통계
```sql
SELECT
  tool_name,
  COUNT(*) as count,
  SUM(tokens_total) as total_tokens,
  AVG(duration_ms) as avg_duration
FROM requests
WHERE tool_name IS NOT NULL
GROUP BY tool_name
ORDER BY count DESC;
```

### 턴별 토큰 사용량
```sql
SELECT
  turn_id,
  COUNT(*) as requests,
  SUM(tokens_total) as tokens,
  GROUP_CONCAT(DISTINCT tool_name) as tools
FROM requests
WHERE session_id = ?
GROUP BY turn_id
ORDER BY turn_id;
```

## 파일 위치

- 스키마 정의: `packages/storage/src/schema.ts`
- 연결 관리: `packages/storage/src/connection.ts`
- 쿼리 함수: `packages/storage/src/queries/*.ts`
