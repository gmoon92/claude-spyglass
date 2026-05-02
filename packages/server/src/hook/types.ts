/**
 * hook 모듈 — 공용 타입 정의
 *
 * 책임:
 *  - hook → /collect 데이터 흐름에서 통과하는 모든 데이터 형상을 정의한다.
 *  - 다른 hook/* 모듈은 모두 여기서 타입만 import한다 (구현 의존 금지).
 *
 * 주요 타입:
 *  - ClaudeHookPayload      : Claude Code 훅이 stdin으로 전달하는 raw 페이로드 (원문)
 *  - NormalizedHookPayload  : Strategy 핸들러가 정제한 내부 형식 (processHookEvent의 입력)
 *  - HookProcessResult      : /collect 엔드포인트 응답 본문
 *  - TokenResult            : transcript 파싱 결과 (신뢰도 정보 포함)
 *  - TranscriptUsage        : transcript에서 추출한 token usage 묶음
 *  - SubagentChildToolCall  : 서브에이전트 transcript에서 발견한 자식 tool_use
 *
 * Deprecated alias (외부 호환):
 *  - CollectPayload = NormalizedHookPayload
 *  - CollectResult  = HookProcessResult
 *
 * 의존성:
 *  - 없음 (순수 타입 모듈, 외부 패키지 X)
 */

/**
 * Claude Code 훅이 stdin으로 전달하는 raw payload 구조.
 *
 * `hook_event_name` 기반으로 어느 필드가 채워지는지 결정된다:
 *  - UserPromptSubmit: prompt
 *  - PreToolUse / PostToolUse: tool_name, tool_input, tool_use_id
 *  - PostToolUse: tool_response, duration_ms
 *  - 서브에이전트 내부 hook: agent_id, agent_type
 */
export interface ClaudeHookPayload {
  hook_event_name: string;   // UserPromptSubmit | PreToolUse | PostToolUse | ...
  session_id: string;
  transcript_path?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  tool_use_id?: string;
  permission_mode?: string;
  agent_id?: string;
  agent_type?: string;
  // UserPromptSubmit 전용
  prompt?: string;
  // PostToolUse: Claude Code가 실측 측정한 도구 실행 시간 (ms)
  duration_ms?: number;
}

/**
 * 핸들러(Strategy)가 raw 페이로드를 정제한 표준 형식.
 *
 * 흐름: raw ClaudeHookPayload → HookEventHandler.handle() → NormalizedHookPayload → processHookEvent → DB
 * v20: hook raw 페이로드의 감사 메타(permission_mode, agent_id 등)를 함께 운반.
 */
export interface NormalizedHookPayload {
  id: string;
  session_id: string;
  project_name: string;
  timestamp: number;
  event_type: string;
  request_type: 'prompt' | 'tool_call' | 'system';
  tool_name?: string;
  tool_detail?: string;
  model?: string;
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  duration_ms?: number;
  payload?: string;
  source: string;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
  preview?: string;
  tokens_confidence?: string;
  tokens_source?: string;
  // v20: hook raw 페이로드에서 추출한 감사 메타
  permission_mode?: string | null;
  agent_id?: string | null;
  agent_type?: string | null;
  tool_interrupted?: number | null;
  tool_user_modified?: number | null;
}

/** /collect 엔드포인트 응답 본문 */
export interface HookProcessResult {
  success: boolean;
  request_id: string;
  session_id: string;
  saved: boolean;
  error?: string;
}

/**
 * @deprecated v21에서 추가된 명명 정합화. 신규 코드는 NormalizedHookPayload 사용.
 *             외부 import 호환성 유지를 위해 type alias로 export 유지.
 */
export type CollectPayload = NormalizedHookPayload;

/** @deprecated HookProcessResult 사용 권장. */
export type CollectResult = HookProcessResult;

/**
 * transcript 파싱에서 한 토큰(input/output/cache_*)에 대한 결과.
 *
 * - 성공: { value: number, confidence: 'high', source: 'transcript' }
 * - 실패: { value: null, confidence: 'error', source: 'unavailable', error: 'NOT_FOUND'|'PARSE_ERROR'|'NO_USAGE' }
 */
export interface TokenResult {
  value: number | null;
  confidence: 'high' | 'error';
  source: 'transcript' | 'unavailable';
  error?: string;
}

/** transcript에서 한 번에 추출되는 usage 묶음 + 추출된 model 이름 */
export interface TranscriptUsage {
  inputTokens: TokenResult;
  outputTokens: TokenResult;
  cacheCreationTokens: TokenResult;
  cacheReadTokens: TokenResult;
  model: string;
}

/**
 * 서브에이전트 transcript에서 발견된 도구 호출 1건.
 *
 * 메인 세션 hook은 PostToolUse 1건만 받지만, Agent tool 내부에서는 N개의 tool_use가 일어남.
 * Migration 017: parent_tool_use_id로 부모 Agent에 매핑하여 같은 turn에 묶는다.
 *
 * @see extractSubagentToolCalls (transcript.ts)
 * @see persistSubagentChildren  (persist.ts)
 */
export interface SubagentChildToolCall {
  toolUseId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  timestampMs: number;
  model: string;
  tokensInput: number;
  tokensOutput: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}
