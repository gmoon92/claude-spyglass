# requests 테이블

개별 API 요청 및 도구 호출 정보를 저장하는 핵심 테이블입니다.

## 개요

| 항목 | 내용 |
|------|------|
| 목적 | 개별 요청/도구 호출 상세 기록 |
| 레코드 수 | 3,527개 (현재 기준) |
| 요청 타입 분포 | tool_call(97.1%), prompt(3.0%) |

## 컬럼 정의

### 기본 컬럼 (v1)

| 컬럼명 | 타입 | 제약조건 | 설명 |
|--------|------|----------|------|
| `id` | TEXT | PRIMARY KEY | 요청 고유 ID (`p-{timestamp}-{random}` 또는 `t-{timestamp}-{random}`) |
| `session_id` | TEXT | NOT NULL, FK | 세션 참조 (sessions.id) |
| `timestamp` | INTEGER | NOT NULL | 요청 발생 시간 (Unix timestamp, milliseconds) |
| `type` | TEXT | NOT NULL, CHECK | 요청 타입 (`prompt`, `tool_call`, `system`) |
| `tool_name` | TEXT | NULL | 도구명 (tool_call인 경우) |
| `model` | TEXT | NULL | 사용된 AI 모델명 |
| `tokens_input` | INTEGER | DEFAULT 0 | 입력 토큰 수 |
| `tokens_output` | INTEGER | DEFAULT 0 | 출력 토큰 수 |
| `tokens_total` | INTEGER | DEFAULT 0 | 총 토큰 수 (input + output) |
| `duration_ms` | INTEGER | DEFAULT 0 | 실행 시간 (밀리초) |
| `payload` | TEXT | NULL | 원본 훅 페이로드 (JSON 문자열) |
| `created_at` | INTEGER | DEFAULT | 레코드 생성 시간 |

### 추가 컬럼 (마이그레이션)

| 컬럼명 | 타입 | 기본값 | 추가 버전 | 설명 |
|--------|------|--------|-----------|------|
| `tool_detail` | TEXT | NULL | v2 | 도구 상세 정보 |
| `turn_id` | TEXT | NULL | v3 | 턴 그룹핑 ID (`{session_id}-T{N}`) |
| `source` | TEXT | NULL | v4 | 데이터 출처 |
| `cache_creation_tokens` | INTEGER | 0 | v5 | 캐시 생성 토큰 |
| `cache_read_tokens` | INTEGER | 0 | v5 | 캐시 읽기 토큰 |
| `preview` | TEXT | NULL | v7 | 프롬프트 내용 미리보기 |
| `tool_use_id` | TEXT | NULL | v8 | Pre/Post 툴 페어링 키 |
| `event_type` | TEXT | NULL | v8 | 이벤트 서브타입 (`pre_tool`, `tool`) |

## 인덱스

| 인덱스명 | 컬럼 | 용도 |
|----------|------|------|
| `idx_requests_session` | `session_id, timestamp DESC` | 세션별 요청 조회 |
| `idx_requests_type` | `type, timestamp DESC` | 타입별 요청 조회 |
| `idx_requests_tokens` | `tokens_total DESC` | 토큰 사용량 상위 조회 |
| `idx_requests_turn` | `turn_id` | 턴 기반 그룹핑 |
| `idx_requests_session_type` | `session_id, type` | 세션+타입 복합 조회 |
| `idx_requests_tool_use_id` | `tool_use_id` (부분) | Pre/Post 툴 매칭 |

## 외래키

```sql
FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
```

## 도구별 통계 (Top 10)

| 도구명 | 사용 횟수 | 설명 |
|--------|----------|------|
| Bash | 1,521 | 명령어 실행 |
| Read | 859 | 파일 읽기 |
| Edit | 401 | 파일 수정 |
| Write | 136 | 파일 쓰기 |
| Grep | 124 | 검색 |
| Glob | 110 | 파일 패턴 매칭 |
| mcp__sequential-thinking | 67 | 순차적 사고 |
| Agent | 60 | 서브에이전트 호출 |
| Skill | 44 | 스킬 호출 |
| ToolSearch | 33 | 도구 검색 |

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
```

## 참고사항

- `duration_ms`는 `PreToolUse`와 `PostToolUse` 사이의 경과 시간
- `tool_use_id`로 Pre/Post 쌍을 매칭 (v8부터)
- `event_type='pre_tool'`인 레코드는 실제 도구 실행 전 타이밍용
