# collect-pipeline-refactor Tasks

> Feature: collect-pipeline-refactor
> 시작일: 2026-04-19
> 상태: 진행 중

## Tasks

### 1단계: 서버 정제 레이어 구현 (collect.ts)

- [x] `ClaudeHookPayload` 인터페이스 정의 (raw hook payload 구조 타입화)
- [x] `parseTranscript(path)` 함수 구현 — inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, model 반환
- [x] `extractToolDetail(toolName, toolInput)` 함수 구현 — Read/Edit/Write/Bash/Glob/Grep/Skill/Agent/WebFetch/WebSearch 처리
- [x] `classifyRequestType(hookEventName)` 함수 구현 — hook_event_name → prompt/tool_call/system
- [x] `toolTimingMap` 인메모리 Map 구현 — tool_use_id 키, PreToolUse/PostToolUse duration_ms 계산
- [x] `rawCollectHandler()` 구현 — raw payload 수신 → 정제 → 기존 handleCollect() 저장 로직 호출
- [x] 수신 로그 추가 — `[RECV] {hook_event_name} session={session_id}`

### 2단계: 훅 스크립트 단순화

- [x] `hook-raw.jsonl` 전수 기록 추가 — UserPromptSubmit/PostToolUse 포함 전 이벤트
- [x] 정제 함수 제거 — `extract_usage_from_transcript`, `extract_model`, `extract_tool_detail`, `classify_request_type`, `extract_tool_name`, `extract_skill_name`, `extract_subagent_type`
- [x] timing 파일 로직 제거 — `~/.spyglass/timing/` 생성·읽기·삭제 코드
- [x] main() 흐름 단순화 — raw payload를 `/collect`로 그대로 전달
- [x] UserPromptSubmit/PreToolUse/PostToolUse → `/collect`, 나머지 → `/events` 라우팅 유지

### 3단계: 서버 라우터 연결

- [x] `index.ts`에서 `/collect` 핸들러를 `rawCollectHandler`로 교체
- [x] `ClaudeHookPayload` 타입 정의 추가 (CollectPayload는 내부 인터페이스로 유지)

### 4단계: 검증

- [x] 실제 Claude Code 세션 실행 — DB output_tokens, cache_tokens 정상값 확인
- [x] tool_call 레코드 model 컬럼 값 확인
- [x] duration_ms tool_use_id 기반 정확도 확인
- [x] hook-raw.jsonl에 UserPromptSubmit/PostToolUse raw 포함 확인
- [x] 서버 수신 로그 출력 확인
- [x] turn_id 부여, pre/post merge, SSE 브로드캐스트 정상 동작 확인

## 완료 기준

- [x] 훅 스크립트에 정제 로직 없음 (raw 전달 + jsonl 기록만)
- [x] hook-raw.jsonl에 전 이벤트 raw payload 기록
- [x] output_tokens, cache_tokens DB 정상값 저장
- [x] tool_call 레코드 model 값 저장
- [x] duration_ms tool_use_id 기반 측정
- [x] 서버 수신 로그 출력
- [x] 기존 기능(turn_id, pre/post merge, SSE) 회귀 없음
