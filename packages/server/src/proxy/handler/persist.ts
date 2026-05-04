/**
 * proxy/handler — DB persistence (axis D)
 *
 * 책임:
 *  - system_prompts UPSERT(maybeUpsertSystemPrompt) + proxy_requests INSERT
 *    (createProxyRequest) + hook 측 backfillRequestFromProxy 를
 *    **단일 트랜잭션** 으로 원자화.
 *  - proxy_requests INSERT 컬럼 매핑은 buildPersistArgs 1곳에 집중 — stream/non-stream
 *    분기에서 동일 매핑이 두 번 등장하지 않게.
 *
 * 트랜잭션 경계는 이 파일 안에서만 닫힌다 — 호출자(stream/non-stream)는 await만.
 *
 * srp-redesign Phase 8: handler.ts에서 변경 이유 D(스토리지 정책) 분리.
 */

import type { Database } from 'bun:sqlite';
import {
  createProxyRequest,
  upsertSystemPrompt,
  persistProxyToolUses,
  backfillRequestApiRequestIdByToolUse,
  type CreateProxyRequestParams,
} from '@spyglass/storage';
import type { RequestMeta, StreamState } from '../types';
import { backfillRequestFromProxy } from '../backfill';
import type { HandlerContext } from './_shared';

/**
 * RequestMeta에 systemHash 등 4 필드가 모두 채워졌을 때만 system_prompts UPSERT 호출.
 *
 * 책임:
 *  - body.system 미존재(또는 정규화 결과 빈값) 시 UPSERT 생략 — proxy_requests.system_hash NULL 적재.
 *  - 4 필드(hash/content/byteSize/segmentCount) 중 하나라도 누락이면 일관성을 위해 전체 생략.
 *
 * 호출자: persistProxyRequest 안의 db.transaction 클로저 (stream / non-stream 두 경로 공통)
 * 의존성: @spyglass/storage upsertSystemPrompt
 */
function maybeUpsertSystemPrompt(db: Database, meta: RequestMeta, nowMs: number): void {
  if (!meta.systemHash || !meta.systemContent
    || typeof meta.systemByteSize !== 'number'
    || typeof meta.systemSegmentCount !== 'number') {
    return;
  }
  upsertSystemPrompt(db, {
    hash: meta.systemHash,
    content: meta.systemContent,
    byteSize: meta.systemByteSize,
    segmentCount: meta.systemSegmentCount,
    nowMs,
  });
}

/**
 * createProxyRequest INSERT 에 넘길 컬럼 매핑을 stream/non-stream 두 분기 공용으로 빌드.
 *
 * stream 전용 필드(tokens_per_second, first_token_ms)는 호출자가 결정:
 *   - stream:    tps = 계산값, firstTokenMs = state.firstTokenMs
 *   - non-stream: tps = null,   firstTokenMs = null
 */
function buildPersistArgs(
  ctx: HandlerContext,
  state: StreamState,
  isStream: boolean,
  tps: number | null,
  anthropicHeaders: { anthropicOrgId: string | null; anthropicRequestId: string | null },
): CreateProxyRequestParams {
  const { reqMeta } = ctx;
  return {
    id: ctx.requestId,
    timestamp: ctx.startMs,
    method: ctx.method,
    path: ctx.url.pathname,
    status_code: 0, // 호출자가 덮어씀 — 실제 statusCode 는 외부 변수
    response_time_ms: 0, // 호출자가 덮어씀
    model: state.model,
    tokens_input: state.usage.input_tokens ?? 0,
    tokens_output: state.usage.output_tokens ?? 0,
    cache_creation_tokens: state.usage.cache_creation_input_tokens ?? 0,
    cache_read_tokens: state.usage.cache_read_input_tokens ?? 0,
    tokens_per_second: tps,
    is_stream: isStream,
    messages_count: reqMeta.messagesCount,
    max_tokens: reqMeta.maxTokens,
    tools_count: reqMeta.toolsCount,
    request_preview: reqMeta.requestPreview,
    stop_reason: state.stopReason,
    response_preview: state.responsePreview,
    error_type: state.errorType,
    error_message: state.errorMessage,
    first_token_ms: isStream ? state.firstTokenMs : null,
    api_request_id: state.apiRequestId,
    // v19: cross-link 키
    session_id: ctx.sessionId,
    turn_id: ctx.turnId,
    // v20: 감사 메타
    client_user_agent: ctx.clientUserAgent,
    client_app: ctx.clientApp,
    anthropic_beta: ctx.anthropicBeta,
    anthropic_org_id: anthropicHeaders.anthropicOrgId,
    anthropic_request_id: anthropicHeaders.anthropicRequestId,
    thinking_type: reqMeta.thinkingType,
    temperature: reqMeta.temperature,
    system_preview: reqMeta.systemPreview,
    system_reminder: reqMeta.systemReminder,
    tool_names: reqMeta.toolNames,
    metadata_user_id: reqMeta.metadataUserId,
    client_meta_json: ctx.clientMeta,
    // v21: compressed payload
    payload: ctx.payload,
    payload_raw_size: ctx.payloadRawSize,
    payload_algo: ctx.payload ? 'zstd' : null,
    // v22: system_prompts cross-link
    system_hash: reqMeta.systemHash ?? null,
    system_byte_size: reqMeta.systemByteSize ?? null,
  };
}

/**
 * ADR-004 (log-view-unification): system_prompts UPSERT + proxy_requests INSERT
 *   + backfillRequestFromProxy를 **단일 트랜잭션**으로 원자화.
 *   - 트랜잭션 내부에서 throw 시 자동 롤백 → proxy_requests INSERT 후 backfill만
 *     실패해 부분 일관 상태가 되는 race를 차단.
 *   - SSE 브로드캐스트는 commit 후 별도 호출(broadcast.ts) — 본 파일 책임 외.
 *
 * 반환: backfilledIds — broadcast 단계에서 'updated' 재송출에 사용.
 */
export function persistProxyRequest(
  db: Database,
  ctx: HandlerContext,
  state: StreamState,
  isStream: boolean,
  statusCode: number,
  responseTimeMs: number,
  tps: number | null,
  anthropicHeaders: { anthropicOrgId: string | null; anthropicRequestId: string | null },
): string[] {
  let backfilledIds: string[] = [];
  db.transaction(() => {
    maybeUpsertSystemPrompt(db, ctx.reqMeta, ctx.startMs);
    const args = buildPersistArgs(ctx, state, isStream, tps, anthropicHeaders);
    args.status_code = statusCode;
    args.response_time_ms = responseTimeMs;
    createProxyRequest(db, args);

    // v23 (ADR-001 P1-E): 응답 안의 tool_use 블록 메타를 proxy_tool_uses에 일괄 기록.
    // 이후 hook의 PostToolUse가 tool_use_id로 정확한 api_request_id를 역조회 가능.
    if (state.apiRequestId && state.toolUses.length > 0) {
      persistProxyToolUses(db, state.apiRequestId, state.toolUses);

      // ADR-001 P1-E race-fix: hook PostToolUse가 proxy commit과 동일 시각에 도착하면
      // hook의 resolveApiRequestId 시점에 proxy_tool_uses 행이 아직 commit 전이라 NULL을
      // 받게 된다. proxy commit 트랜잭션 마지막에 UPDATE로 backfill하여 영구 NULL 회귀 차단.
      for (const t of state.toolUses) {
        backfillRequestApiRequestIdByToolUse(db, t.tool_use_id, state.apiRequestId);
      }
    }

    // hook 측 미완성 행(model NULL 또는 tokens_source='unavailable')을
    // 같은 session_id + 시간 윈도우로 일괄 채움 — 같은 트랜잭션 내에서 원자 처리.
    backfilledIds = backfillRequestFromProxy(db, {
      sessionId: ctx.sessionId,
      model: state.model,
      apiRequestId: state.apiRequestId,
      tokensInput: state.usage.input_tokens ?? 0,
      tokensOutput: state.usage.output_tokens ?? 0,
      cacheCreationTokens: state.usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: state.usage.cache_read_input_tokens ?? 0,
      proxyStartMs: ctx.startMs,
    });
  })();
  return backfilledIds;
}
