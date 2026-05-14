# claude_events 테이블

Raw 훅 이벤트 페이로드를 그대로 저장하는 테이블입니다.

## 개요

| 항목 | 내용 |
|------|------|
| 목적 | Claude Code 훅의 원본 페이로드 보관 |

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
| `timestamp` | INTEGER | NOT NULL | 이벤트 발생 시간 (Unix ms) |
| `payload` | TEXT | NOT NULL, DEFAULT '{}' | 전체 훅 페이로드 (JSON) |
| `schema_version` | INTEGER | DEFAULT 1 | 페이로드 스키마 버전 |
| `permission_mode` | TEXT | NULL | Claude 권한 모드 (SessionStart 등) |
| `source` | TEXT | NULL | 이벤트 발생 출처 |
| `end_reason` | TEXT | NULL | 종료 원인 (`reason` 필드를 매핑; SQL 예약어 회피) |
| `model` | TEXT | NULL | 사용 모델명 |
| `stop_hook_active` | INTEGER | NULL | stop_hook 활성 여부 (0/1) |
| `task_id` | TEXT | NULL | 태스크/tool_use ID |
| `task_subject` | TEXT | NULL | 태스크 제목·설명 |
| `notification_type` | TEXT | NULL | 알림 이벤트 타입 |

## 인덱스

| 인덱스명 | 컬럼 | 용도 |
|----------|------|------|
| `idx_events_session_time` | `session_id, timestamp` | 세션별 시간순 조회 |
| `idx_events_type_time` | `event_type, timestamp` | 타입별 시간순 조회 |

## 수집되는 이벤트

와일드카드 훅에서 `/events` 엔드포인트로 전달된 모든 페이로드가 이 테이블에 저장됩니다.

### claude_events 테이블에 저장되는 이벤트

| 이벤트 타입 | 설명 |
|------------|------|
| `SessionStart` | 세션 시작. 저장 후 `sessions` 테이블 reactivate 및 SSE 브로드캐스트 |
| `SessionEnd` | 세션 종료. 저장 후 `sessions` 테이블 ended_at 갱신 및 SSE 브로드캐스트 |
| `Stop` | 응답 완료. 저장 후 `last_assistant_message`를 `requests` 테이블에 `response` 타입으로 추가 저장 |
| `SubagentStop` | 서브에이전트 응답 완료 |
| `Notification` | 알림 이벤트 (`notification_type` 컬럼에 세부 타입 저장) |
| `PreToolUse` | 도구 사용 시작 (와일드카드 훅 경유 시 저장됨) |
| `PostToolUse` | 도구 사용 완료 (와일드카드 훅 경유 시 저장됨) |

### 다른 테이블에 저장되는 이벤트 (claude_events 미포함)

| 이벤트 타입 | 저장 위치 | 설명 |
|------------|-----------|------|
| `UserPromptSubmit` | `requests` | `/collect` 엔드포인트 처리 |
| `PostToolUse` | `requests` | `/collect` 엔드포인트 처리 (타이밍 포함) |

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
