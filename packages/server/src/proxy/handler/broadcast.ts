/**
 * proxy/handler — SSE broadcast (axis E)
 *
 * 책임:
 *  - DB commit 후 fresh proxy_requests 행을 broadcastNewProxyRequest로 송출.
 *  - backfill UPDATE 영향 행들을 'updated' phase로 재송출 (ADR-004).
 *  - 모든 broadcast 호출을 자체 try/catch 로 격리 — broadcast 실패가 client 응답에
 *    영향 주지 않도록 (T-06 ADR-005).
 *
 * 변경 이유: SSE 송출 정책(이벤트 phase, 페이로드 컬럼 추가)과 DB 정책은 다른 축.
 *           broadcast 실패 격리 정책도 한 곳에서 관리해야 누락이 없다.
 *
 * 호출자: handler/stream.ts, handler/non-stream.ts (persist 직후)
 */

import type { Database } from 'bun:sqlite';
import {
  getRequestById,
  getSessionById,
} from '@spyglass/storage';
import {
  broadcastNewProxyRequest,
  broadcastNewRequest,
  type ProxyBroadcastPayload,
} from '../../sse';
import { invalidateDashboardCache } from '../../api';
import { normalizeRequest } from '../../domain/request-normalizer';
import type { StreamState } from '../types';
import type { HandlerContext } from './_shared';

/**
 * backfill로 갱신된 행들을 SSE `event_phase: 'updated'`로 재브로드캐스트 (ADR-004).
 *
 * 이 함수는 `proxy/handler.ts`가 책임지는 흐름:
 *   1. backfill UPDATE → affected ID 배열 반환
 *   2. 각 ID로 raw row를 다시 SELECT
 *   3. NormalizedRequest로 정규화 → SSE 송출
 *
 * storage/도메인 모듈이 SSE에 의존하지 않도록 broadcast 책임은 여기서 격리.
 * broadcast 실패는 client 응답에 영향 없게 try/catch로 격리.
 */
export function broadcastBackfilledRequests(
  db: Database,
  sessionId: string | null,
  affectedIds: string[],
): void {
  if (!sessionId || affectedIds.length === 0) return;
  try {
    const session = getSessionById(db, sessionId);
    const sessionTotalTokens = session?.total_tokens ?? 0;
    for (const id of affectedIds) {
      const rawRow = getRequestById(db, id);
      if (!rawRow) continue;
      const normalized = normalizeRequest(rawRow);
      broadcastNewRequest(normalized, {
        session_total_tokens: sessionTotalTokens,
        event_phase: 'updated',
      });
    }
  } catch (err) {
    console.warn('[PROXY] backfill broadcast error:', err);
  }
}

/**
 * 새로 INSERT된 proxy_requests 행을 SSE로 송출하기 위한 페이로드 빌더.
 *
 * stream/non-stream 두 분기에서 같은 컬럼 매핑이 두 번 등장하지 않도록 1곳에 집중.
 * stream 전용 필드(tokens_per_second, first_token_ms)는 호출자가 결정.
 */
function buildBroadcastPayload(
  ctx: HandlerContext,
  state: StreamState,
  isStream: boolean,
  statusCode: number,
  responseTimeMs: number,
  tps: number | null,
): ProxyBroadcastPayload {
  const { reqMeta } = ctx;
  return {
    id: ctx.requestId,
    timestamp: ctx.startMs,
    method: ctx.method,
    path: ctx.url.pathname,
    status_code: statusCode,
    response_time_ms: responseTimeMs,
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
    // v22: system_prompts cross-link (본문 미동봉)
    system_hash: reqMeta.systemHash ?? null,
    system_byte_size: reqMeta.systemByteSize ?? null,
  };
}

/**
 * DB commit 직후 캐시 무효화 + fresh broadcast 송출.
 *
 * 자체 try/catch로 broadcast 실패가 client 응답에 영향 안 가게 격리 (T-06 ADR-005).
 * @see docs/plans/proxy-sse-integration/plan.md Phase A
 */
export function broadcastFresh(
  ctx: HandlerContext,
  state: StreamState,
  isStream: boolean,
  statusCode: number,
  responseTimeMs: number,
  tps: number | null,
): void {
  try {
    invalidateDashboardCache();
    const payload = buildBroadcastPayload(ctx, state, isStream, statusCode, responseTimeMs, tps);
    broadcastNewProxyRequest(payload);
  } catch (err) {
    console.warn('[PROXY] Broadcast error:', err);
  }
}
