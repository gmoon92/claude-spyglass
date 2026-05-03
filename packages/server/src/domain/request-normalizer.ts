/**
 * Request 정규화 도메인 계층 (SSoT)
 *
 * @description
 *   raw `Request` row → API/SSE 응답용 `NormalizedRequest`로 변환하는 단일 함수.
 *   3개 클라이언트 뷰(전체 피드 / 세션 flat / 세션 turn)가 동일한 정규화 결과를
 *   입력받게 하여 model 폴백·sub_type 결정·신뢰도 분류 책임 분산을 제거한다.
 *
 * @see ADR-001: 정규화 계층 위치 — server/domain
 * @see ADR-005: 클라 행 렌더 통합 — 정규화 결과를 셀 빌더로 위임
 *
 * 책임:
 *   1. model 폴백 — turn 컨텍스트가 있으면 같은 turn의 prompt model로 채움 (response가 NULL일 때)
 *   2. sub_type 결정 — tool_name + tool_detail로 'agent' / 'skill' / 'task' / 'mcp' 분류
 *   3. trust_level 분류 — tokens_confidence + model 존재 여부로 'trusted' / 'unknown' / 'synthetic'
 *   4. raw 필드 보존 — UI가 raw 데이터를 직접 참조할 여지를 남김 (cache_*, event_type, tokens_source 등)
 *
 * 비책임 (SSoT 분리 원칙):
 *   - DB 저장 / 쿼리 → packages/storage
 *   - SSE 송출 → packages/server/src/sse.ts
 *   - HTML 렌더 → packages/web/assets/js/renderers.js
 *
 * 호출자:
 *   - packages/server/src/api.ts — API 응답 직전 매핑
 *   - packages/server/src/sse.ts — SSE 브로드캐스트 직전 매핑
 *   - packages/server/src/proxy/handler.ts — backfill 후 갱신 알림 시
 *

 * 의존성:
 *   - @spyglass/storage: Request raw 타입
 *   - @spyglass/types: 공유 데이터 contract (NormalizedRequest, RequestSubType, TrustLevel, EventPhase, NormalizedTurnItem)
 *
 * srp-redesign ADR-006: 데이터 contract는 @spyglass/types 패키지에 모이고,
 *   server는 그 타입을 import + re-export하여 외부 시그니처(`from './domain/request-normalizer'`) 호환 유지.
 *   "NormalizedRequest 필드 추가" = 변경 이유 단일 → packages/types에서만 수정.
 */

import type { Request, TurnItem } from '@spyglass/storage';

// 공유 contract import (런타임 코드 0줄, 타입 선언만)
import type {
  EventPhase as SharedEventPhase,
  NormalizedRequest as SharedNormalizedRequest,
  NormalizedTurnItem as SharedNormalizedTurnItem,
  RequestSubType as SharedRequestSubType,
  TrustLevel as SharedTrustLevel,
} from '@spyglass/types';

// =============================================================================
// 타입 re-export (외부 import 호환 유지)
// =============================================================================

/**
 * 행 sub_type — UI 표시 분류용. @see @spyglass/types/RequestSubType
 */
export type RequestSubType = SharedRequestSubType;

/**
 * 행 신뢰도 — UI dim 처리/확신도 표시용. @see @spyglass/types/TrustLevel
 */
export type TrustLevel = SharedTrustLevel;

/**
 * `event_phase` — SSE 페이로드 discriminator. @see @spyglass/types/EventPhase
 */
export type EventPhase = SharedEventPhase;

/**
 * 정규화된 Request — 클라이언트 공통 입력 모델. @see @spyglass/types/NormalizedRequest
 *
 * server는 이 타입을 직접 정의하지 않고 @spyglass/types에서 re-export.
 * "NormalizedRequest 필드 추가"는 packages/types/src/request.ts 한 곳만 수정 = SRP 준수.
 */
export type NormalizedRequest = SharedNormalizedRequest;

/**
 * Turn 응답 안의 단위 항목 (ADR-006). @see @spyglass/types/NormalizedTurnItem
 */
export type NormalizedTurnItem = SharedNormalizedTurnItem;

/**
 * 정규화 컨텍스트.
 * - `turnPromptModel`: 같은 turn의 prompt model (turn 응답에서 사용).
 *                      전체 피드처럼 turn 컨텍스트가 없으면 undefined.
 */
export interface NormalizeContext {
  turnPromptModel?: string | null;
}

// =============================================================================
// 정규화 함수 (SSoT)
// =============================================================================

/**
 * raw Request row → NormalizedRequest 변환.
 *
 * pure function. 외부 상태 변경 없음.
 *
 * @param raw — storage가 반환한 그대로의 행
 * @param ctx — turn 컨텍스트 등 (옵션)
 * @returns 정규화된 행
 */
export function normalizeRequest(
  raw: Request,
  ctx: NormalizeContext = {},
): NormalizedRequest {
  const fallbackModel = deriveModel(raw, ctx);

  return {
    ...raw,
    sub_type: deriveSubType(raw),
    trust_level: deriveTrustLevel(raw, fallbackModel.value),
    model: fallbackModel.value,
    model_fallback_applied: fallbackModel.appliedFallback,
  };
}

/**
 * 여러 행을 한 번에 정규화.
 * 전체 피드처럼 turn 컨텍스트가 없는 경우, 같은 `turn_id`의 prompt model을 즉석으로 매핑하여
 * tool_call/response의 model 폴백을 자동 적용한다 (응답 직전 1-pass).
 */
export function normalizeRequests(rows: Request[]): NormalizedRequest[] {
  const promptModelByTurn = buildPromptModelMap(rows);
  return rows.map((r) =>
    normalizeRequest(r, {
      turnPromptModel: r.turn_id ? promptModelByTurn.get(r.turn_id) ?? null : null,
    }),
  );
}

/**
 * 같은 turn_id의 prompt model을 1-pass로 매핑 (폴백 후보 빌드용).
 */
function buildPromptModelMap(rows: Request[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.type === 'prompt' && r.turn_id && r.model) {
      map.set(r.turn_id, r.model);
    }
  }
  return map;
}

// =============================================================================
// Turn 정규화 (ADR-006: 인터리빙 책임 서버 이관)
// =============================================================================

/**
 * 정규화된 Turn 응답 — `prompt`/`tool_calls`/`responses` 필드는 호환 유지하되,
 * 클라이언트가 단일 진입점으로 렌더할 수 있도록 시간순 인터리빙된 `items[]`를 함께 제공.
 *
 * `items`는 `kind: 'tool' | 'response'` discriminator로 클라이언트가 한 함수로 행을 그릴 수 있게 한다.
 * `prompt`는 turn 헤더 카드 영역에 별도로 표시되므로 items에 포함하지 않는다.
 */
export interface NormalizedTurn extends TurnItem {
  items: NormalizedTurnItem[];
}

/**
 * raw TurnItem[] → NormalizedTurn[].
 *
 * 각 turn 안의 prompt/tool_calls/responses를 raw `Request` shape으로 캐스팅한 뒤
 * `normalizeRequest`로 폴백 적용하고, tool/response를 timestamp 오름차순으로 인터리빙해 `items`에 채운다.
 *
 * @param turns — getTurnsBySession 결과
 * @param sessionId — 라우트에서 알고 있는 session_id (TurnItem에는 없음)
 */
export function normalizeTurns(turns: TurnItem[], sessionId: string): NormalizedTurn[] {
  return turns.map((t) => normalizeTurn(t, sessionId));
}

function normalizeTurn(turn: TurnItem, sessionId: string): NormalizedTurn {
  const turnPromptModel = turn.prompt?.model ?? null;
  const ctx = { turnPromptModel };

  const tools: NormalizedTurnItem[] = (turn.tool_calls ?? []).map((tc) => ({
    kind: 'tool' as const,
    request: normalizeRequest(toolCallToRequest(tc, sessionId, turn.turn_id), ctx),
  }));

  const responses: NormalizedTurnItem[] = (turn.responses ?? []).map((r) => ({
    kind: 'response' as const,
    request: normalizeRequest(responseToRequest(r, sessionId, turn.turn_id), ctx),
  }));

  // timestamp 오름차순 인터리빙 (안정 정렬: kind tie-break 없음, 동시 timestamp는 입력 순서 유지)
  const items = [...tools, ...responses].sort(
    (a, b) => a.request.timestamp - b.request.timestamp,
  );

  return { ...turn, items };
}

/** TurnToolCall(slim shape) → raw Request 호환 객체로 캐스팅 (정규화 입력용) */
function toolCallToRequest(
  tc: NonNullable<TurnItem['tool_calls']>[number],
  sessionId: string,
  turnId: string,
): Request {
  return {
    id: tc.id,
    session_id: sessionId,
    timestamp: tc.timestamp,
    type: 'tool_call',
    tool_name: tc.tool_name ?? undefined,
    tool_detail: tc.tool_detail ?? undefined,
    turn_id: turnId,
    model: tc.model ?? undefined,
    tokens_input: tc.tokens_input,
    tokens_output: tc.tokens_output,
    tokens_total: tc.tokens_total,
    duration_ms: tc.duration_ms,
    payload: tc.payload ?? undefined,
    event_type: tc.event_type,
    parent_tool_use_id: tc.parent_tool_use_id,
    tokens_confidence: tc.tokens_confidence ?? undefined,
  };
}

/** TurnResponse(slim shape) → raw Request 호환 객체로 캐스팅 (정규화 입력용) */
function responseToRequest(
  r: NonNullable<TurnItem['responses']>[number],
  sessionId: string,
  turnId: string,
): Request {
  return {
    id: r.id,
    session_id: sessionId,
    timestamp: r.timestamp,
    type: 'response',
    turn_id: turnId,
    model: r.model ?? undefined,
    tokens_input: r.tokens_input,
    tokens_output: r.tokens_output,
    tokens_total: r.tokens_total,
    duration_ms: 0,
    payload: r.payload ?? undefined,
    preview: r.preview,
    tokens_confidence: r.tokens_confidence ?? undefined,
  };
}

// =============================================================================
// 파생 규칙 (private)
// =============================================================================

/**
 * model 폴백 규칙.
 * 우선순위: raw.model > ctx.turnPromptModel > null.
 * raw가 비어있어 폴백이 적용됐는지를 함께 반환한다(관측/테스트용).
 */
function deriveModel(
  raw: Request,
  ctx: NormalizeContext,
): { value: string | null; appliedFallback: boolean } {
  if (raw.model && raw.model.length > 0) {
    return { value: raw.model, appliedFallback: false };
  }
  const fallback = ctx.turnPromptModel ?? null;
  return { value: fallback, appliedFallback: fallback !== null };
}

/**
 * sub_type 결정.
 * tool_name이 가장 강한 신호. tool_detail은 보조 (현재는 사용하지 않지만 향후 확장 여지).
 */
function deriveSubType(raw: Request): RequestSubType {
  const name = raw.tool_name ?? '';
  if (name === 'Agent') return 'agent';
  if (name === 'Skill') return 'skill';
  if (name === 'Task') return 'task';
  if (name.startsWith('mcp__')) return 'mcp';
  return null;
}

/**
 * trust_level 분류.
 * 우선순위: synthetic > estimated > unknown > trusted.
 *
 *  - synthetic : model 값이 '<synthetic>'으로 시작 → SDK가 사용자 의도 외 합성한 호출
 *  - estimated : tokens_source === 'proxy' → transcript 파싱 실패로 proxy로 보충된 행
 *  - unknown   : model이 폴백 적용됐거나 NULL, 혹은 tokens_source === 'unavailable'
 *  - trusted   : 그 외 모두
 */
function deriveTrustLevel(raw: Request, finalModel: string | null): TrustLevel {
  const m = (raw.model ?? '').toLowerCase();
  if (m.startsWith('<synthetic>')) return 'synthetic';
  if (raw.tokens_source === 'proxy') return 'estimated';
  if (!finalModel || raw.tokens_source === 'unavailable') return 'unknown';
  if (raw.tokens_confidence && raw.tokens_confidence !== 'high') return 'unknown';
  return 'trusted';
}
