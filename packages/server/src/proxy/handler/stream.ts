/**
 * proxy/handler — 6-A 스트리밍 응답 분기 (axis B)
 *
 * 책임:
 *  - upstream SSE 본문을 client에 즉시 stream-through로 반환.
 *  - response.clone()으로 동시에 분석: chunk 루프 + parseSSEChunk → state 누적.
 *  - 종료 시 TPS 계산 → log + diag + persist + broadcast (fire-and-forget IIFE).
 *
 * 변경 이유: 스트리밍 분기의 성능·관측 정책(TPS·TTFT·rawSse)이 비스트리밍과 다른 축.
 *
 * 주의 (보존 필수):
 *  - decoder.decode(value, { stream: true }) — 옵션 누락 시 멀티바이트 SSE 깨짐.
 *  - IIFE fire-and-forget — handleStreamResponse는 void 반환, 내부에서 await 미수행.
 *
 * 호출자: handler/index.ts
 */

import type { Database } from 'bun:sqlite';
import type { StreamState } from '../types';
import { parseSSEChunk } from '../sse-state';
import { extractResponseHeaders } from '../audit-headers';
import { logResult } from '../log-result';
import type { HandlerContext } from './_shared';
import { createInitialState } from './_shared';
import { diagOutboundStream } from './diag';
import { persistProxyRequest } from './persist';
import { broadcastBackfilledRequests, broadcastFresh } from './broadcast';

/**
 * 6-A 스트리밍 응답 분기. body는 즉시 client에 stream으로 반환하고, clone으로 분석.
 *
 * 반환: client에 그대로 돌려줄 Response (body는 원본 stream).
 * 분석/저장은 내부 fire-and-forget IIFE로 비동기 진행.
 */
export function handleStreamResponse(
  db: Database,
  ctx: HandlerContext,
  response: Response,
  responseHeaders: Headers,
  statusCode: number,
  headerReqId: string | null,
): Response {
  const { reqMeta, startMs, method, url } = ctx;
  const analyticsClone = response.clone();

  (async () => {
    const state: StreamState = createInitialState(reqMeta, headerReqId);

    let rawSseBuffer = '';
    try {
      const reader = analyticsClone.body!.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          rawSseBuffer += chunk;
          parseSSEChunk(chunk, state, startMs);
        }
      }
    } catch (err) {
      console.warn('[PROXY] Stream analytics error:', err);
    }

    const ms = Date.now() - startMs;
    // TPS 계산: lastTokenMs - firstTokenMs 윈도우에서 output_tokens 비율 (tokens per second)
    const tps = (state.firstTokenMs !== null && state.lastTokenMs !== null
      && state.lastTokenMs > state.firstTokenMs && (state.usage.output_tokens ?? 0) > 0)
      ? state.usage.output_tokens! / ((state.lastTokenMs - state.firstTokenMs) / 1000)
      : null;

    logResult({
      method, path: url.pathname, statusCode, ms, isStream: true,
      model: state.model, usage: state.usage, tps,
      stopReason: state.stopReason, ttft: state.firstTokenMs,
      errorType: state.errorType, requestPreview: reqMeta.requestPreview,
    });

    diagOutboundStream(ctx.requestId, statusCode, ms, tps, reqMeta, state, response, rawSseBuffer);

    try {
      const anthropicHeaders = extractResponseHeaders(response);
      const backfilledIds = persistProxyRequest(
        db, ctx, state, true, statusCode, ms, tps, anthropicHeaders,
      );
      // commit 후 SSE 'updated' 재브로드캐스트 (broadcast 실패는 client 응답 무관)
      broadcastBackfilledRequests(db, ctx.sessionId, backfilledIds);

      // DB 저장 성공 직후에만 캐시 무효화 + SSE 브로드캐스트.
      broadcastFresh(ctx, state, true, statusCode, ms, tps);
    } catch (err) {
      console.warn('[PROXY] DB save error:', err);
    }
  })();

  return new Response(response.body, { status: statusCode, headers: responseHeaders });
}
