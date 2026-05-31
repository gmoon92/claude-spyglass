/**
 * sse-schema.ts — SSE 이벤트 페이로드 Zod 스키마 (P1-07).
 *
 * @description
 *   EventSource 로 도착하는 SSE 3 채널 페이로드를 런타임 검증/정규화한다.
 *     - 'new_request'       : NormalizedRequest + 메타(session_total_tokens, event_phase)
 *     - 'new_proxy_request' : ProxyBroadcastPayload + source:'proxy' 마커
 *     - 'session_update'    : 세션 부분 갱신 (started/ended/token_update)
 *
 *   설계 원칙:
 *     1. SSoT 재사용 — 도메인 형태는 packages/types/src/{request,session}.ts 가 SSoT.
 *        web에 도메인 타입을 재선언하지 않는다. 본 스키마는 "wire JSON → types 형태"로
 *        검증·정규화하는 계층이며, 파일 하단의 컴파일 타임 assert(_assertX)로
 *        z.infer 결과가 @spyglass/types 인터페이스에 할당 가능함을 강제한다(드리프트 방지).
 *     2. 안전 처리(any 금지) — parseSSEData/parseSSEMessage 는 throw하지 않고
 *        { ok:true, data } | { ok:false, error } 판별 유니온을 반환한다.
 *     3. 후방호환 — 서버 필드 증가에 대비해 객체는 .passthrough() (알 수 없는 키 보존).
 *
 *   SSoT(송출 shape): packages/server/src/sse.ts
 *     - buildNewRequestEvent / ProxyBroadcastPayload / broadcastSessionUpdate
 *
 *   본 task(P1-07)는 스키마 "설계·생성"만. sse.js 결선(파싱부 교체)은 후속 P3.
 *
 * @see packages/server/src/sse.ts
 * @see packages/types/src/request.ts
 * @see packages/types/src/session.ts
 */

import { z } from 'zod';
import type {
  NormalizedRequest,
  RequestType,
  RequestSubType,
  TrustLevel,
  SessionLiveState,
} from '@spyglass/types';

// =============================================================================
// 공통 결과 타입 — 안전 파싱 판별 유니온 (throw 대신 명시 반환, any 금지)
// =============================================================================

/**
 * 안전 파싱 결과.
 *
 * tsconfig `strict:false`(strictNullChecks off) 환경에서는 boolean 리터럴 기반
 * discriminated-union 좁히기(`if (!res.ok)`)가 동작하지 않는다. 따라서 판별 유니온 대신
 * 단일 객체 형태로 두고, 호출부는 `res.ok ? res.data : fallback` 삼항으로 분기한다
 * (settings-view.js 의 `json.success ? json.data : null` 패턴과 동일).
 *
 *  - 성공: { ok:true,  data 채움, error 미설정 }
 *  - 실패: { ok:false, data 미설정, error 채움 }
 */
export type ParseResult<T> =
  | { ok: true; data: T; error?: undefined }
  | { ok: false; data?: undefined; error: string };

/** ZodError → 사람이 읽을 수 있는 단일 문자열 (로깅/폴백용). */
function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

/** safeParse 결과를 ParseResult 로 변환하는 공통 어댑터. */
function toResult<T>(parsed: z.SafeParseReturnType<unknown, T>): ParseResult<T> {
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, error: formatZodError(parsed.error) };
}

// =============================================================================
// 원자 스키마 (도메인 열거형 — types SSoT 와 동일 리터럴)
// =============================================================================

const RequestTypeSchema = z.enum(['prompt', 'tool_call', 'system', 'response']);
const RequestSubTypeSchema = z.union([
  z.enum(['agent', 'skill', 'task', 'mcp']),
  z.null(),
]);
const TrustLevelSchema = z.enum(['trusted', 'unknown', 'synthetic', 'estimated']);
const EventPhaseSchema = z.enum(['created', 'updated']);
const SessionLiveStateSchema = z.enum(['live', 'stale', 'ended']);

// =============================================================================
// new_request — NormalizedRequest + SSE 메타
// =============================================================================

/**
 * NormalizedRequest 본문 + buildNewRequestEvent 메타(session_total_tokens, event_phase).
 *
 * - 도메인 형태는 types SSoT. 여기선 wire 검증에 필요한 필드만 명시하고
 *   나머지 누적 필드(파생 anomaly 등)는 .passthrough()로 보존한다.
 * - event_phase 는 서버 default('created')와 동일하게 누락 시 채운다.
 */
export const NewRequestEventSchema = z
  .object({
    // ── RequestRow 필수 ──
    id: z.string(),
    session_id: z.string(),
    timestamp: z.number(),
    type: RequestTypeSchema,
    tokens_input: z.number(),
    tokens_output: z.number(),
    tokens_total: z.number(),
    duration_ms: z.number(),
    // ── NormalizedRequest 파생 ──
    sub_type: RequestSubTypeSchema,
    trust_level: TrustLevelSchema,
    model: z.string().nullable(),
    model_fallback_applied: z.boolean(),
    // ── SSE 메타 (buildNewRequestEvent) ──
    session_total_tokens: z.number(),
    event_phase: EventPhaseSchema.default('created'),
  })
  .passthrough();

export type NewRequestEvent = z.infer<typeof NewRequestEventSchema>;

// =============================================================================
// new_proxy_request — ProxyBroadcastPayload + source 마커
// =============================================================================

/** broadcastNewProxyRequest 가 data에 싣는 shape (sse.ts ProxyBroadcastPayload 1:1). */
export const NewProxyRequestEventSchema = z
  .object({
    source: z.literal('proxy'),
    id: z.string(),
    timestamp: z.number(),
    method: z.string(),
    path: z.string(),
    status_code: z.number().nullable(),
    response_time_ms: z.number().nullable(),
    model: z.string().nullable(),
    tokens_input: z.number(),
    tokens_output: z.number(),
    cache_creation_tokens: z.number(),
    cache_read_tokens: z.number(),
    tokens_per_second: z.number().nullable(),
    is_stream: z.boolean(),
    messages_count: z.number(),
    max_tokens: z.number().nullable(),
    tools_count: z.number(),
    request_preview: z.string().nullable(),
    stop_reason: z.string().nullable(),
    response_preview: z.string().nullable(),
    error_type: z.string().nullable(),
    error_message: z.string().nullable(),
    first_token_ms: z.number().nullable(),
    api_request_id: z.string().nullable(),
    // v22 (system-prompt-exposure ADR-005) — 선택 필드
    system_hash: z.string().nullable().optional(),
    system_byte_size: z.number().nullable().optional(),
  })
  .passthrough();

export type NewProxyRequestEvent = z.infer<typeof NewProxyRequestEventSchema>;

// =============================================================================
// session_update — 세션 부분 갱신 (broadcastSessionUpdate)
// =============================================================================

/** session_id만 필수, 나머지는 모두 optional (서버 broadcastSessionUpdate 시그니처 1:1). */
export const SessionUpdateEventSchema = z
  .object({
    session_id: z.string(),
    total_tokens: z.number().optional(),
    request_count: z.number().optional(),
    action: z.enum(['started', 'ended', 'token_update']).optional(),
    started_at: z.number().optional(),
    ended_at: z.number().nullable().optional(),
    project_name: z.string().optional(),
    live_state: SessionLiveStateSchema.optional(),
  })
  .passthrough();

export type SessionUpdateEvent = z.infer<typeof SessionUpdateEventSchema>;

// =============================================================================
// 이벤트 타입 → 스키마 레지스트리
// =============================================================================

/** sse.js 가 addEventListener 하는 3 채널. */
export type KnownSSEEventType =
  | 'new_request'
  | 'new_proxy_request'
  | 'session_update';

const SSE_SCHEMAS = {
  new_request: NewRequestEventSchema,
  new_proxy_request: NewProxyRequestEventSchema,
  session_update: SessionUpdateEventSchema,
} as const;

/** 이벤트 타입별 파싱 결과 데이터 타입 매핑. */
export interface SSEDataByType {
  new_request: NewRequestEvent;
  new_proxy_request: NewProxyRequestEvent;
  session_update: SessionUpdateEvent;
}

// =============================================================================
// 안전 파싱 API — throw 금지, ParseResult 반환
// =============================================================================

/**
 * 이미 파싱된 data 객체를 이벤트 타입에 맞춰 검증한다.
 *
 * @param type 이벤트 타입 (런타임 미지 타입도 안전하게 ok=false 폴백)
 * @param data MessageEvent.data 를 JSON.parse 한 envelope의 `data` 필드(또는 직접 객체)
 */
export function parseSSEData<T extends KnownSSEEventType>(
  type: T,
  data: unknown,
): ParseResult<SSEDataByType[T]>;
export function parseSSEData(
  type: string,
  data: unknown,
): ParseResult<SSEDataByType[KnownSSEEventType]>;
export function parseSSEData(
  type: string,
  data: unknown,
): ParseResult<SSEDataByType[KnownSSEEventType]> {
  const schema = (SSE_SCHEMAS as Record<string, z.ZodTypeAny>)[type];
  if (!schema) {
    return { ok: false, error: `unknown SSE event type: ${type}` };
  }
  return toResult(
    schema.safeParse(data) as z.SafeParseReturnType<
      unknown,
      SSEDataByType[KnownSSEEventType]
    >,
  );
}

/** SSE wire envelope `{ type, timestamp, data }` 의 느슨한 스키마. */
const SSEEnvelopeSchema = z
  .object({
    type: z.string().optional(),
    timestamp: z.number().optional(),
    data: z.unknown(),
  })
  .passthrough();

/**
 * EventSource MessageEvent 의 raw payload(JSON 문자열 또는 이미 파싱된 객체)를
 * 안전하게 파싱한다. JSON 파싱 실패·data 누락·스키마 위반 모두 throw 없이 ok=false 폴백.
 *
 * @param type 기대 이벤트 타입
 * @param raw  MessageEvent.data (string) 또는 테스트용 이미-파싱 객체
 */
export function parseSSEMessage<T extends KnownSSEEventType>(
  type: T,
  raw: unknown,
): ParseResult<SSEDataByType[T]>;
export function parseSSEMessage(
  type: string,
  raw: unknown,
): ParseResult<SSEDataByType[KnownSSEEventType]>;
export function parseSSEMessage(
  type: string,
  raw: unknown,
): ParseResult<SSEDataByType[KnownSSEEventType]> {
  let envelopeInput: unknown = raw;
  if (typeof raw === 'string') {
    try {
      envelopeInput = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'invalid JSON in SSE message' };
    }
  }

  const env = SSEEnvelopeSchema.safeParse(envelopeInput);
  if (!env.success) {
    return { ok: false, error: `invalid SSE envelope: ${formatZodError(env.error)}` };
  }
  if (env.data.data === undefined || env.data.data === null) {
    return { ok: false, error: 'SSE envelope missing data field' };
  }
  return parseSSEData(type, env.data.data);
}

// =============================================================================
// 컴파일 타임 SSoT 가드 — z.infer 결과가 @spyglass/types 에 할당 가능한지 강제
// (런타임 코드 0줄. 드리프트 발생 시 typecheck 실패로 즉시 검출.)
// =============================================================================

/** U 가 T 에 할당 가능할 때만 통과(아니면 typecheck 실패). 가드 전용 — 런타임 0줄. */
type _AssertAssignable<T, U extends T> = U;

// 의미 있는 SSoT 방향: 스키마 output 의 핵심 필드가 NormalizedRequest 의 동일 필드에
// 할당 가능해야 한다(파싱 결과를 NormalizedRequest 기대 코드로 흘릴 수 있어야 함).
// .passthrough() 의 index signature 영향을 배제하기 위해 핵심 필드만 골라 비교한다.
type _NewReqCoreKeys =
  | 'id' | 'session_id' | 'timestamp' | 'type'
  | 'tokens_input' | 'tokens_output' | 'tokens_total' | 'duration_ms'
  | 'sub_type' | 'trust_level' | 'model' | 'model_fallback_applied';
type _NewReqCore = Required<Pick<NewRequestEvent, _NewReqCoreKeys>>;
type _NormReqCore = Required<Pick<NormalizedRequest, _NewReqCoreKeys>>;
// 스키마 output(_NewReqCore) → 도메인(_NormReqCore) 할당 가능 = 드리프트 없음.
type _AssertNewReqToNorm = _AssertAssignable<_NormReqCore, _NewReqCore>;

// 열거형 리터럴이 types SSoT 와 동일 집합인지(양방향).
type _AssertReqTypeFwd = _AssertAssignable<RequestType, z.infer<typeof RequestTypeSchema>>;
type _AssertReqTypeBwd = _AssertAssignable<z.infer<typeof RequestTypeSchema>, RequestType>;
type _AssertSubTypeFwd = _AssertAssignable<RequestSubType, z.infer<typeof RequestSubTypeSchema>>;
type _AssertSubTypeBwd = _AssertAssignable<z.infer<typeof RequestSubTypeSchema>, RequestSubType>;
type _AssertTrustFwd = _AssertAssignable<TrustLevel, z.infer<typeof TrustLevelSchema>>;
type _AssertTrustBwd = _AssertAssignable<z.infer<typeof TrustLevelSchema>, TrustLevel>;
type _AssertLiveStateFwd = _AssertAssignable<SessionLiveState, z.infer<typeof SessionLiveStateSchema>>;
type _AssertLiveStateBwd = _AssertAssignable<z.infer<typeof SessionLiveStateSchema>, SessionLiveState>;

// 미사용 타입 경고 억제(컴파일 타임 가드 전용).
export type __SSoTGuards = [
  _AssertNewReqToNorm,
  _AssertReqTypeFwd, _AssertReqTypeBwd,
  _AssertSubTypeFwd, _AssertSubTypeBwd,
  _AssertTrustFwd, _AssertTrustBwd,
  _AssertLiveStateFwd, _AssertLiveStateBwd,
];
