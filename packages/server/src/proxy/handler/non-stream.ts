/**
 * proxy/handler — 6-B 비스트리밍 JSON 응답 분기 (axis C)
 *
 * 책임:
 *  - upstream 응답 body를 한 번에 text로 읽어 JSON 파싱.
 *  - state(model, apiRequestId, usage, stopReason, content preview, error) 일괄 채움.
 *  - log + diag + persist + broadcast 후 client에 같은 bodyText 반환.
 *
 * 변경 이유: 비스트리밍은 TPS/TTFT 개념이 없고 응답 본문 분석 방식이 SSE와 직교.
 *
 * 호출자: handler/index.ts
 */

import type { Database } from 'bun:sqlite';
import type { StreamState } from '../types';
import { extractResponseHeaders } from '../audit-headers';
import { logResult } from '../log-result';
import type { HandlerContext } from './_shared';
import { createInitialState } from './_shared';
import { diagOutboundJson } from './diag';
import { persistProxyRequest } from './persist';
import { broadcastBackfilledRequests, broadcastFresh } from './broadcast';

/**
 * 6-B 비스트리밍 JSON 응답 분기. bodyText 파싱 → state 채움 → persist + broadcast.
 *
 * 반환: client에 돌려줄 Response (bodyText 그대로).
 */
export async function handleJsonResponse(
  db: Database,
  ctx: HandlerContext,
  response: Response,
  responseHeaders: Headers,
  statusCode: number,
  headerReqId: string | null,
): Promise<Response> {
  const { reqMeta, startMs, method, url } = ctx;
  const bodyText = await response.text();
  const ms = Date.now() - startMs;

  const state: StreamState = createInitialState(reqMeta, headerReqId);

  try {
    const json = JSON.parse(bodyText) as Record<string, unknown>;
    state.model = (json.model as string) ?? state.model;
    state.apiRequestId = (json.id as string) ?? state.apiRequestId;
    state.stopReason = (json.stop_reason as string) ?? null;

    const u = json.usage as { input_tokens?: number; output_tokens?: number;
      cache_creation_input_tokens?: number; cache_read_input_tokens?: number } | undefined;
    if (u) state.usage = { ...u };

    // 응답 미리보기 (content[].text 결합)
    if (Array.isArray(json.content)) {
      const texts = json.content
        .filter((c: { type?: string }) => c.type === 'text')
        .map((c: { text?: string }) => c.text ?? '')
        .join('');
      state.responsePreview = texts.slice(0, 200) || null;

      // v23 (ADR-001 P1-E): tool_use 블록 캡처 — non-stream JSON 분기에서도 동일 정책.
      json.content.forEach((c: { type?: string; id?: string; name?: string }, idx: number) => {
        if (c.type === 'tool_use' && typeof c.id === 'string') {
          state.toolUses.push({
            tool_use_id: c.id,
            tool_name: typeof c.name === 'string' ? c.name : null,
            block_index: idx,
          });
        }
      });
    }

    // 에러 응답
    const err = json.error as Record<string, unknown> | undefined;
    if (err) {
      state.errorType = (err.type as string) ?? null;
      state.errorMessage = (err.message as string) ?? null;
    }
  } catch {
    // JSON 파싱 실패 — state는 기본값 유지 (raw bodyText만 진단에 남김)
  }

  logResult({
    method, path: url.pathname, statusCode, ms, isStream: false,
    model: state.model, usage: state.usage, tps: null,
    stopReason: state.stopReason, ttft: null,
    errorType: state.errorType, requestPreview: reqMeta.requestPreview,
  });

  diagOutboundJson(ctx.requestId, statusCode, ms, reqMeta, state, response, bodyText);

  try {
    const anthropicHeaders = extractResponseHeaders(response);
    const backfilledIds = persistProxyRequest(
      db, ctx, state, false, statusCode, ms, null, anthropicHeaders,
    );
    // commit 후 SSE 'updated' 재브로드캐스트
    broadcastBackfilledRequests(db, ctx.sessionId, backfilledIds);

    // SSE 브로드캐스트 격리 — broadcast 실패가 client 응답에 영향 안 주게 (T-06 ADR-005)
    broadcastFresh(ctx, state, false, statusCode, ms, null);
  } catch (err) {
    console.warn('[PROXY] DB save error:', err);
  }

  return new Response(bodyText, { status: statusCode, headers: responseHeaders });
}
