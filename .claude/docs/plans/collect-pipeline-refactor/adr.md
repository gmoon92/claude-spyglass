# collect-pipeline-refactor ADR

## ADR-001: 데이터 정제 로직을 훅 스크립트에서 서버로 이전

### 상태
**결정됨** (2026-04-19)

### 배경

현재 훅 스크립트(bash)가 Claude Code 훅 이벤트를 받아 다음 정제 작업을 수행한다:

- `extract_usage_from_transcript()` — transcript JSONL 파싱으로 토큰 추출
- `extract_model()` — transcript 마지막 assistant 메시지에서 모델명 추출
- `extract_tool_detail()` — 도구별 파라미터 요약 (file_path, command 등)
- `classify_request_type()` — hook_event_name → prompt/tool_call/system 분류
- timing 파일 관리 — `~/.spyglass/timing/{session_id}` 파일로 duration_ms 계산

이 구조는 다음 문제를 야기한다:

1. **원장 보존 불완전**: UserPromptSubmit/PostToolUse의 raw payload가 hook-raw.jsonl에 기록되지 않음. SessionStart/Stop만 기록됨.
2. **토큰 수집 불량**: output_tokens, cache_tokens가 항상 0. 환경변수(`CLAUDE_API_USAGE_*`)가 Claude Code에 존재하지 않음이 소스 검증으로 확인됨. transcript 파싱이 유일한 해결책이나 tool_call에서는 미적용.
3. **테스트 어려움**: bash + python3 인라인 정제 로직은 단위 테스트가 사실상 불가.
4. **model 수집 불완전**: `prompt` 타입에만 model 추출 → tool_call(Skill, Agent 포함)은 model=NULL.
5. **timing 키 충돌 위험**: `session_id`를 timing 파일명으로 사용 → 병렬 도구 실행 시 파일 덮어쓰기 발생 가능.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| **A. 현행 유지** | bash에서 정제 계속 담당 | 변경 없음 | 원장 누락, 토큰 0, 테스트 불가 |
| **B. 일부 이전** | token 추출만 서버로 이전 | 점진적 변경 | 정제 로직이 두 곳에 분산, 복잡도 증가 |
| **C. 전체 이전** (채택) | 훅은 raw 전달 전용, 서버가 정제 전담 | 단일 책임, TypeScript 테스트 가능 | 서버 재시작 시 in-flight 타이밍 유실 |

### 결정

**옵션 C 채택**: 훅 스크립트는 raw stdin payload를 그대로 `/collect`로 전달하고 `hook-raw.jsonl`에 기록하는 역할만 담당. 서버(collect.ts)가 정제 로직을 전담한다.

**세부 결정 사항:**

1. **CollectPayload 인터페이스 교체**: 가공된 필드 집합 → Claude Code raw hook payload 구조(`ClaudeHookPayload`)로 교체
2. **transcript 파싱 TypeScript 이전**: `fs.readFileSync` + JSONL 파싱으로 token/model 추출
3. **timing Map 방식 채택**: `~/.spyglass/timing/` 파일 → 서버 인메모리 `Map<tool_use_id, startTs>`
4. **hook-raw.jsonl 전수 기록**: UserPromptSubmit/PostToolUse 포함 전 이벤트 기록

### 이유

1. **curl은 이미 백그라운드 (`&`)**: 서버 처리 시간이 Claude Code를 블로킹하지 않음. 정제를 서버로 옮겨도 UX 영향 없음.
2. **서버도 로컬 프로세스**: transcript_path 파일이 로컬 파일시스템에 있고, 서버도 같은 머신에서 실행됨. 파일 접근에 제약 없음.
3. **단일 책임 원칙**: 훅 = 이벤트 수집·전달, 서버 = 비즈니스 로직·저장. Spring Controller 패턴과 동일.
4. **tool_use_id 기반 timing**: 기존 session_id 파일 방식보다 병렬 도구 실행 시 정확. tool_use_id는 Claude Code가 보장하는 고유값.
5. **원장 보존 완성**: hook-raw.jsonl에 전 이벤트 기록 → 데이터 파이프라인 장애 시 재처리 근거 확보.

### 트레이드오프 수용

| 트레이드오프 | 수용 이유 |
|-------------|----------|
| 서버 재시작 시 in-flight duration_ms=0 | 기존 파일 방식도 서버 재시작과 무관하게 PreToolUse 이전 재시작 시 동일 문제 발생. 개선되지 않으나 악화도 없음. |
| transcript 파일 의존성 명시화 | 이미 bash에서 의존하던 것을 TypeScript로 이전한 것. 의존 자체는 동일. |
| hook-raw.jsonl 파일 크기 증가 | UserPromptSubmit/PostToolUse는 transcript_path 포함 수KB 크기. 로테이션 정책은 별도 feature(데이터 삭제 정책)에서 처리. |

---

## ADR-002: duration_ms 타이밍을 파일 기반에서 인메모리 Map으로 교체

### 상태
**결정됨** (2026-04-19)

### 배경

현재 PreToolUse → PostToolUse 간 duration_ms 측정 방식:
```
PreToolUse  → ~/.spyglass/timing/{session_id} 파일에 timestamp 저장
PostToolUse → 파일 읽어 (now - start) 계산 후 파일 삭제
```

문제:
- **session_id 키 충돌**: 도구 병렬 실행 시 동일 session_id로 파일이 덮어써져 duration 오측
- **파일 I/O 부하**: PreToolUse마다 파일 생성, PostToolUse마다 파일 읽기·삭제
- **정제 로직이 서버로 이전되면**: 파일 경로 접근 권한 설정 불필요해짐

### 결정

서버 인메모리 `Map<string, number>`으로 교체.
- 키: `tool_use_id` (Claude Code 훅 payload의 고유 식별자)
- 값: PreToolUse 수신 timestamp (ms)

```typescript
// collect.ts
const toolTimingMap = new Map<string, number>();

// PreToolUse 처리 시
toolTimingMap.set(tool_use_id, Date.now());

// PostToolUse 처리 시
const startTs = toolTimingMap.get(tool_use_id);
const duration_ms = startTs ? Date.now() - startTs : 0;
toolTimingMap.delete(tool_use_id);
```

### 이유

1. `tool_use_id`는 Claude Code가 Pre/Post 쌍으로 보장하는 고유 ID → 병렬 실행 시에도 충돌 없음
2. 파일 I/O 제거 → 간결함
3. 정제 로직 서버 이전(ADR-001)과 자연스럽게 통합
