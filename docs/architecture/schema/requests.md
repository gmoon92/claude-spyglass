# requests 테이블

개별 API 요청 및 도구 호출 정보를 저장하는 핵심 테이블입니다.

## 개요

| 항목 | 내용 |
|------|------|
| 목적 | 개별 요청/도구 호출 상세 기록 |

## 컬럼 정의

| 컬럼명 | 타입 | 제약조건 | 설명 |
|--------|------|----------|------|
| `id` | TEXT | PRIMARY KEY | 요청 고유 ID (`p-{timestamp}-{random}` 또는 `t-{timestamp}-{random}`) |
| `session_id` | TEXT | NOT NULL, FK | 세션 참조 (sessions.id) |
| `timestamp` | INTEGER | NOT NULL | 요청 발생 시간 (Unix timestamp, milliseconds) |
| `type` | TEXT | NOT NULL, CHECK | 요청 타입 (`prompt`, `tool_call`, `system`, `response`) |
| `tool_name` | TEXT | NULL | 도구명 (tool_call인 경우) |
| `tool_detail` | TEXT | NULL | 도구 상세 정보 (Skill 이름, Agent 설명, Bash 커맨드 등) |
| `turn_id` | TEXT | NULL | 턴 그룹핑 ID (`{session_id}-T{N}`) |
| `model` | TEXT | NULL | 사용된 AI 모델명 |
| `tokens_input` | INTEGER | DEFAULT 0 | 입력 토큰 수 |
| `tokens_output` | INTEGER | DEFAULT 0 | 출력 토큰 수 |
| `tokens_total` | INTEGER | DEFAULT 0 | 총 토큰 수 (input + output) |
| `duration_ms` | INTEGER | DEFAULT 0 | 실행 시간 (밀리초) |
| `payload` | BLOB/TEXT | NULL | 원본 훅 페이로드 (JSON 문자열 또는 zstd 압축 BLOB) |
| `payload_raw_size` | INTEGER | NULL | 압축 전 페이로드 원본 크기 (bytes) |
| `payload_algo` | TEXT | DEFAULT 'zstd' | 페이로드 압축 알고리즘 |
| `source` | TEXT | NULL | 데이터 출처 (예: `subagent-transcript`) |
| `cache_creation_tokens` | INTEGER | DEFAULT 0 | 캐시 생성 토큰 수 |
| `cache_read_tokens` | INTEGER | DEFAULT 0 | 캐시 읽기 토큰 수 |
| `preview` | TEXT | NULL | 프롬프트 내용 미리보기 |
| `tool_use_id` | TEXT | NULL | Pre/Post 툴 페어링 키 |
| `event_type` | TEXT | NULL | 이벤트 서브타입 (`pre_tool`, `tool`) |
| `tokens_confidence` | TEXT | DEFAULT 'high' | 토큰 신뢰도 (`high`, `error`) |
| `tokens_source` | TEXT | DEFAULT 'transcript' | 토큰 출처 (`transcript`, `unavailable`) |
| `parent_tool_use_id` | TEXT | NULL | 부모 Agent의 `tool_use_id` (서브에이전트 자식 행 연결용) |
| `api_request_id` | TEXT | NULL | Anthropic API 응답 ID — proxy_requests 역참조 키 |
| `permission_mode` | TEXT | NULL | Claude Code 권한 모드 (예: `bypassPermissions`, `plan`) |
| `agent_id` | TEXT | NULL | 서브에이전트 ID |
| `agent_type` | TEXT | NULL | 서브에이전트 타입 |
| `tool_interrupted` | INTEGER | NULL | 도구 실행 중 인터럽트 발생 여부 (0/1) |
| `tool_user_modified` | INTEGER | NULL | 사용자 수정 여부 (0/1) |
| `slash_command` | TEXT | NULL | UserPromptSubmit에서 추출한 슬래시 커맨드 이름 (선행 `/` 제거) |
| `created_at` | INTEGER | DEFAULT | 레코드 생성 시간 (Unix timestamp, seconds) |

## type CHECK 제약

```sql
CHECK (type IN ('prompt', 'tool_call', 'system', 'response'))
```

- `prompt` : 사용자 입력 (UserPromptSubmit 훅)
- `tool_call` : 도구 호출 (PreToolUse / PostToolUse 훅)
- `system` : 시스템 이벤트 (SessionStart, Notification 등)
- `response` : Claude 응답 (Stop 훅의 last_assistant_message)

## 인덱스

| 인덱스명 | 컬럼 | 조건 | 용도 |
|----------|------|------|------|
| `idx_requests_session` | `session_id, timestamp DESC` | — | 세션별 요청 조회 |
| `idx_requests_type` | `type, timestamp DESC` | — | 타입별 요청 조회 |
| `idx_requests_tokens` | `tokens_total DESC` | — | 토큰 사용량 상위 조회 |
| `idx_requests_session_type` | `session_id, type` | — | 세션+타입 복합 조회 |
| `idx_requests_timestamp` | `timestamp DESC` | — | 시간 범위 조회 |
| `idx_requests_turn` | `turn_id` | — | 턴 기반 그룹핑 |
| `idx_requests_tool_use_id` | `tool_use_id` | — | Pre/Post 툴 매칭 |
| `idx_requests_parent_tool_use_id` | `parent_tool_use_id` | NOT NULL | 서브에이전트 자식 조회 |
| `idx_requests_api_request_id` | `api_request_id` | NOT NULL | proxy_requests 역참조 |
| `idx_requests_agent_id` | `agent_id` | NOT NULL | 에이전트 ID 조회 |
| `idx_requests_permission_mode` | `permission_mode` | NOT NULL | 권한 모드 분석 |
| `idx_requests_slash` | `slash_command` | NOT NULL | 슬래시 커맨드 집계 |
| `idx_requests_meta_doc` | `tool_name, tool_detail` | tool_name IN ('Agent','Skill') | Behavior Definitions 매칭 |
| `idx_requests_type_event_ts` | `type, event_type, timestamp DESC` | — | 집계·통계 쿼리 최적화 |
| `idx_requests_tool_duration_partial` | `duration_ms ASC` | type='tool_call' AND event_type='tool' AND duration_ms>0 | P95 지연 계산 |
| `idx_requests_session_type_ts_asc` | `session_id, type, timestamp ASC` | — | 세션 첫 prompt 시각 조회 |
| `idx_requests_session_timestamp` | `session_id, timestamp DESC` | — | anomaly 검출 세션 단위 범위 스캔 |

## 외래키

```sql
FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
```

## tool_detail 포맷

### Skill
```
{skill-name}
-- 예: backend-workflow, data-analyst, ui-designer
```

### Agent
```
{description}
-- 예: "행위이력 저장/조회 계획 초안 작성"
```

### Bash
```
{command} (80자 truncate)
```

### Read/Edit/Write
```
{file_path}
```

### Grep/Glob
```
{pattern} [in {path}]
```

## 데이터 샘플 쿼리

```sql
-- 특정 세션의 모든 요청 조회
SELECT * FROM requests
WHERE session_id = ?
ORDER BY timestamp DESC;

-- 토큰 사용량 상위 요청
SELECT tool_name, tokens_total, tool_detail
FROM requests
ORDER BY tokens_total DESC
LIMIT 10;

-- 도구별 사용 통계
SELECT tool_name, COUNT(*) as count, SUM(tokens_total) as total_tokens
FROM requests
WHERE tool_name IS NOT NULL
GROUP BY tool_name
ORDER BY count DESC;

-- 턴별 요청 그룹핑
SELECT turn_id, COUNT(*) as request_count, SUM(tokens_total) as tokens
FROM requests
WHERE session_id = ?
GROUP BY turn_id
ORDER BY turn_id;

-- 서브에이전트 자식 호출 조회
SELECT * FROM requests
WHERE parent_tool_use_id = ?
ORDER BY timestamp ASC;

-- 슬래시 커맨드 집계
SELECT slash_command, COUNT(*) as count
FROM requests
WHERE slash_command IS NOT NULL
GROUP BY slash_command
ORDER BY count DESC;
```

## 참고사항

- `duration_ms`는 `PreToolUse`와 `PostToolUse` 사이의 경과 시간
- `tool_use_id`로 Pre/Post 쌍을 매칭 — `event_type='pre_tool'`인 레코드는 실제 도구 실행 전 타이밍용
- `event_type='pre_tool'` 행은 UI 노출 시 기본 제외 (단, `tool_name='Agent'`는 예외 허용) — `read.ts: ACTIVE_REQUEST_FILTER_SQL` 참조
- `parent_tool_use_id`는 서브에이전트(Task) 내부 도구 호출을 부모 Agent 행과 연결하는 외래키 역할
- `api_request_id`는 Anthropic API 응답의 외부 ID — `proxy_requests` 테이블과 cross-link 키
- `payload`는 zstd 압축 BLOB 또는 원문 JSON TEXT — `payload_algo` 컬럼으로 구분
- `slash_command`는 `<command-name>` 태그에서 추출, 선행 `/`는 제거하여 저장
