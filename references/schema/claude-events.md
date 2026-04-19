# claude_events 테이블

Raw 훅 이벤트 페이로드를 그대로 저장하는 테이블입니다.

## 개요

| 항목 | 내용 |
|------|------|
| 목적 | Claude Code 훅의 원본 페이로드 보관 |
| 레코드 수 | 157개 (현재 기준) |
| 추가 버전 | v6 |

## 컬럼 정의

| 컬럼명 | 타입 | 제약조건 | 설명 |
|--------|------|----------|------|
| `id` | INTEGER | PRIMARY KEY, AUTOINCREMENT | 내부 ID |
| `event_id` | TEXT | NOT NULL, UNIQUE | 이벤트 고유 ID |
| `event_type` | TEXT | NOT NULL | 훅 이벤트명 |
| `session_id` | TEXT | NOT NULL | 세션 ID |
| `transcript_path` | TEXT | NULL | 트랜스크립트 파일 경로 |
| `cwd` | TEXT | NULL | 작업 디렉토리 |
| `agent_id` | TEXT | NULL | 에이전트 ID |
| `agent_type` | TEXT | NULL | 에이전트 타입 |
| `timestamp` | INTEGER | NOT NULL | 이벤트 발생 시간 (Unix timestamp) |
| `payload` | TEXT | NOT NULL, DEFAULT '{}' | 전체 훅 페이로드 (JSON) |
| `schema_version` | INTEGER | DEFAULT 1 | 페이로드 스키마 버전 |

## 인덱스

| 인덱스명 | 컬럼 | 용도 |
|----------|------|------|
| `idx_events_session_time` | `session_id, timestamp` | 세션별 시간순 조회 |
| `idx_events_type_time` | `event_type, timestamp` | 타입별 시간순 조회 |

## 이벤트 타입 분포

| 이벤트 타입 | 개수 | 설명 |
|------------|------|------|
| Stop | 108 | 세션 중단 |
| SessionStart | 26 | 세션 시작 |
| SessionEnd | 22 | 세션 종료 |
| PreToolUse | 1 | 도구 사용 시작 (참고용) |

## 수집되는 이벤트

### UserPromptSubmit
- `/collect` 엔드포인트로 직접 처리
- `requests` 테이블에 저장됨

### PreToolUse
- 타이밍 파일에만 기록 (`~/.spyglass/timing/{session_id}`)
- DB에는 저장되지 않음 (의도적)
- 예외: 1개의 PreToolUse가 `claude_events`에 기록됨

### PostToolUse
- `/collect` 엔드포인트로 처리
- `requests` 테이블에 저장됨

### SessionStart / SessionEnd / Stop
- `/events` 엔드포인트로 처리
- `claude_events` 테이블에 저장됨

## 데이터 샘플 쿼리

```sql
-- 특정 세션의 모든 이벤트 조회
SELECT * FROM claude_events
WHERE session_id = ?
ORDER BY timestamp;

-- 이벤트 타입별 통계
SELECT event_type, COUNT(*) as count
FROM claude_events
GROUP BY event_type
ORDER BY count DESC;

-- 최근 raw 이벤트 조회
SELECT event_type, timestamp, json_extract(payload, '$.hook_event_name') as hook
FROM claude_events
ORDER BY timestamp DESC
LIMIT 10;
```

## 참고사항

- `payload` 컬럼에 전체 훅 페이로드가 JSON 문자열로 저장됨
- 데이터 구조 분석 및 디버깅용으로 주로 사용
- `requests` 테이블로 정제되지 않는 이벤트 보관
