/**
 * 정규화된 Request 모델 — server/TUI/web 공통 데이터 contract.
 *
 * @description
 *   런타임 코드 0줄. TS 타입 선언만 모은 공유 슬롯 (ADR-006, srp-redesign).
 *
 *   목적:
 *   - server `domain/request-normalizer.ts`가 정의하던 NormalizedRequest 타입을 이곳으로 이전.
 *   - TUI `types.ts`의 `Request` 타입(주석에 "Mirrors server response shapes; keep in sync"
 *     명시)이 이 타입을 직접 참조하여 server-TUI 동기화 부담 해소.
 *   - 웹은 JS라 런타임은 무관하지만 JSDoc `@typedef` import로 IDE 힌트 가능.
 *
 *   변경 이유 단일성 (사용자 SRP 정의):
 *   - "NormalizedRequest 필드 추가" = 단일 변경 사유 → 이 파일만 수정하면 server·TUI 양쪽 자동 반영.
 *   - 이전: server 정의 + TUI 복제 → 한 변경에 2곳 동시 수정.
 *
 * @see .claude/docs/plans/srp-redesign/adr.md#ADR-006
 */

// =============================================================================
// raw Request row (storage 스키마와 1:1 — DB column = TS 필드)
// =============================================================================

/**
 * 요청 타입 열거형.
 * - 'prompt'    : 사용자 입력 (UserPromptSubmit 훅)
 * - 'tool_call' : 도구 호출 (PreToolUse / PostToolUse 훅)
 * - 'system'    : 시스템 이벤트 (SessionStart, Notification 등)
 * - 'response'  : Claude 응답 (Stop 훅의 last_assistant_message)
 */
export type RequestType = 'prompt' | 'tool_call' | 'system' | 'response';

/**
 * Request raw row (DB column 1:1 매핑).
 *
 * 30개 필드 누적은 v22 마이그레이션까지의 진화 결과 (ADR-001 SRP 적용 시 위반 아님 —
 * "행 1건"이라는 단일 변경 단위에 모이는 것이 자연스러움).
 */
export interface RequestRow {
  id: string;
  session_id: string;
  timestamp: number;
  type: RequestType;
  tool_name?: string;
  tool_detail?: string;
  turn_id?: string;
  model?: string;
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  duration_ms: number;
  payload?: string;
  source?: string | null;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
  preview?: string | null;
  tool_use_id?: string | null;
  event_type?: string | null;
  tokens_confidence?: string;
  tokens_source?: string;
  parent_tool_use_id?: string | null;
  /** v19: Anthropic API 응답 ID — proxy_requests와 cross-link 키 */
  api_request_id?: string | null;
  /** v20: hook raw 페이로드 감사 메타 */
  permission_mode?: string | null;
  agent_id?: string | null;
  agent_type?: string | null;
  tool_interrupted?: number | null;
  tool_user_modified?: number | null;
  created_at?: number;
}

// =============================================================================
// 정규화 파생 타입 (server/domain/request-normalizer.ts에서 사용)
// =============================================================================

/**
 * 행 sub_type — UI 표시 분류용.
 * `null`은 일반 prompt/tool_call/response/system.
 *
 * 매핑 규칙(`deriveSubType` in request-normalizer.ts):
 *  - tool_name === 'Agent'           → 'agent'
 *  - tool_name === 'Skill'           → 'skill'
 *  - tool_name === 'Task'            → 'task'
 *  - tool_name?.startsWith('mcp__')  → 'mcp'
 *  - 그 외                            → null
 */
export type RequestSubType = 'agent' | 'skill' | 'task' | 'mcp' | null;

/**
 * 행 신뢰도 — UI dim/뱃지 처리용.
 *  - 'trusted'   : 정상 데이터 (tokens_confidence='high' && model 존재)
 *  - 'unknown'   : model NULL이거나 tokens_source='unavailable'
 *  - 'synthetic' : SDK가 합성한 model (예: '<synthetic>'으로 시작) — 사용자 의도 외 호출
 *  - 'estimated' : tokens_source='proxy'로 보충된 행 (transcript 추출 실패 시)
 */
export type TrustLevel = 'trusted' | 'unknown' | 'synthetic' | 'estimated';

/**
 * `event_phase` — SSE 페이로드 discriminator (ADR-002 log-view-unification).
 *  - 'created' : 첫 INSERT (또는 pre_tool→tool 병합 첫 노출)
 *  - 'updated' : 기존 행이 backfill/UPDATE로 갱신됨 → 클라가 in-place 갱신
 */
export type EventPhase = 'created' | 'updated';

/**
 * 정규화된 Request — 클라이언트 공통 입력 모델.
 *
 * raw `RequestRow`의 모든 필드를 보존하면서, 도메인 규칙으로 파생된 필드를 추가한다.
 * 클라이언트는 이 구조만 보면 model 폴백·sub_type 분기·신뢰도 분류를 다시 할 필요가 없다.
 */
export interface NormalizedRequest extends Omit<RequestRow, 'model'> {
  /** UI 표시용 sub_type. `null`은 일반 행. */
  sub_type: RequestSubType;

  /** 행 신뢰도 분류 (UI dim/뱃지용). */
  trust_level: TrustLevel;

  /**
   * 정규화된 model.
   *
   * raw의 `model`(string | undefined)을 turn 컨텍스트로 폴백 적용한 결과.
   *  - response 행: rawResp.model ?? same_turn.prompt.model ?? null
   *  - tool_call 행: raw.model ?? same_turn.prompt.model ?? null
   *  - prompt/system: raw.model 그대로 (없으면 null)
   *
   * raw가 비어있어 폴백으로 채워졌으면 `model_fallback_applied: true`.
   */
  model: string | null;

  /** 폴백으로 model이 채워졌는지 여부 (관측·테스트용). */
  model_fallback_applied: boolean;
}
