/**
 * proxy 모듈 — 메인 핸들러 (HTTP /v1/* 진입점)
 *
 * 책임:
 *  - /v1/* 요청을 Anthropic 또는 커스텀 upstream으로 포워딩.
 *  - 요청·응답 메타를 proxy_requests에 저장하고 SSE 브로드캐스트.
 *  - hook ↔ proxy 정확 매칭(session_id, turn_id)과 model backfill 수행.
 *  - 모든 단계의 raw 페이로드를 진단 jsonl에 기록 (사후 채널 비교 분석용).
 *
 * 데이터 흐름:
 *  client → handleProxy
 *      → parseRequestBody (request-parser)            ─ RequestMeta
 *      → extractClientHeaders (audit-headers)         ─ 클라이언트 메타
 *      → getLastTurnId (collect)                      ─ hook과 같은 turn 묶기
 *      → diagJson 'proxy-payload' phase=in            ─ 진단
 *      → buildForwardHeaders (upstream)
 *      → fetch(upstream)
 *      → 분기:
 *         (a) SSE 스트림: chunk 루프 + parseSSEChunk → state 누적
 *         (b) JSON 비스트림: bodyText 파싱 → state 일괄 채움
 *      → logResult (stdout)
 *      → diagJson 'proxy-payload' phase=out-*         ─ 진단
 *      → extractResponseHeaders (audit-headers)       ─ Anthropic 메타
 *      → createProxyRequest (DB)
 *      → backfillRequestFromProxy (hook 행 model + tokens + api_request_id 채움)
 *      → invalidateDashboardCache + broadcastNewProxyRequest
 *      → client에 응답 반환
 *
 * 외부 노출: handleProxy(req, url, db) — index.ts에서만 re-export
 * 호출자: server/src/index.ts (HTTP 라우터)
 *
 * 의존성:
 *  - @spyglass/storage : createProxyRequest
 *  - ../sse            : broadcastNewProxyRequest
 *  - ../api            : invalidateDashboardCache
 *  - ../diag-log       : diagJson
 *  - ../collect        : getLastTurnId
 *  - 동일 모듈        : upstream, request-parser, sse-state, audit-headers, log-result, backfill, types
 */

import type { Database } from 'bun:sqlite';
import {
  createProxyRequest,
  getRequestById,
  getSessionById,
  upsertSystemPrompt,
} from '@spyglass/storage';
import {
  broadcastNewProxyRequest,
  broadcastNewRequest,
  type ProxyBroadcastPayload,
} from '../sse';
import { invalidateDashboardCache } from '../api';
import { diagJson } from '../diag-log';
import { getLastTurnId } from '../hook';
import { normalizeRequest } from '../domain/request-normalizer';

import type { RequestMeta, StreamState } from './types';
import { selectUpstreamUrl, buildForwardHeaders, UPSTREAM_URL } from './upstream';
import { parseRequestBody } from './request-parser';
import { parseSSEChunk } from './sse-state';
import { extractClientHeaders, extractResponseHeaders } from './audit-headers';
import { logResult } from './log-result';
import { backfillRequestFromProxy } from './backfill';

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
function broadcastBackfilledRequests(
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
 * /v1/* 요청을 upstream으로 포워딩하고 메타를 수집·저장.
 */
export async function handleProxy(req: Request, url: URL, db: Database): Promise<Response> {
  const requestId = crypto.randomUUID();
  const startMs = Date.now();
  const method = req.method;
  const path = url.pathname + url.search;

  // 1. 요청 본문 파싱
  const bodyBuffer = req.body ? await req.arrayBuffer() : null;
  const reqMeta: RequestMeta = bodyBuffer ? parseRequestBody(bodyBuffer) : {
    model: null, messagesCount: 0, maxTokens: null,
    toolsCount: 0, requestPreview: null, isStreamReq: false,
    thinkingType: null, temperature: null, systemPreview: null,
    toolNames: null, metadataUserId: null, systemReminder: null,
  };

  // v21: 요청 본문 zstd 압축 — bodyBuffer가 없거나 0 byte면 압축 생략 (DB에는 NULL).
  let payload: Uint8Array | null = null;
  let payloadRawSize: number | null = null;
  if (bodyBuffer && bodyBuffer.byteLength > 0) {
    try {
      payload = Bun.zstdCompressSync(new Uint8Array(bodyBuffer));
      payloadRawSize = bodyBuffer.byteLength;
    } catch (err) {
      console.warn('[PROXY] Payload compression failed:', err);
    }
  }

  // 2. hook ↔ proxy 매칭 키 (v19) + 클라이언트 헤더 메타 (v20)
  const sessionId = req.headers.get('x-claude-code-session-id') || null;
  const turnId = sessionId ? getLastTurnId(db, sessionId) : null;
  const { clientUserAgent, clientApp, anthropicBeta, clientMeta } = extractClientHeaders(req);

  console.log(
    `[PROXY] → ${method} ${url.pathname}${reqMeta.model ? ` [${reqMeta.model}]` : ''}`,
  );

  // 3. 진단 jsonl: 진입 시 원문 페이로드·헤더·파싱 메타 기록
  diagInbound(req, requestId, method, url, bodyBuffer, reqMeta);

  // 4. upstream 결정 + forward 헤더 빌드
  const forwardHeaders = buildForwardHeaders(req);
  const upstreamBase = selectUpstreamUrl(reqMeta.model);
  const targetUrl = `${upstreamBase}${path}`;
  if (upstreamBase !== UPSTREAM_URL) {
    console.log(`[PROXY] Custom upstream: ${upstreamBase} (model=${reqMeta.model})`);
  }

  // 5. upstream fetch
  let response: Response;
  try {
    response = await fetch(targetUrl, {
      method,
      headers: forwardHeaders,
      body: bodyBuffer && bodyBuffer.byteLength > 0 ? bodyBuffer : null,
    });
  } catch (err) {
    console.error(`[PROXY] ✗ Connection failed to ${targetUrl}:`, err);
    return new Response(
      JSON.stringify({ error: 'proxy_connection_failed', message: String(err) }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const statusCode = response.status;
  const isStream = (response.headers.get('content-type') ?? '').includes('text/event-stream');

  // 응답 헤더 (압축 제거 — Bun이 자동 decompress 후 length 안 맞을 수 있음)
  const responseHeaders = new Headers();
  response.headers.forEach((v, k) => {
    if (k !== 'content-encoding' && k !== 'content-length') responseHeaders.set(k, v);
  });
  responseHeaders.set('Access-Control-Allow-Origin', '*');

  const headerReqId = response.headers.get('request-id')
    ?? response.headers.get('x-request-id') ?? null;

  // ===========================================================================
  // 6-A. 스트리밍 응답 — body는 즉시 client에 stream으로 반환하고, clone으로 분석
  // ===========================================================================
  if (isStream && response.body) {
    const analyticsClone = response.clone();

    (async () => {
      const state: StreamState = {
        model: reqMeta.model, apiRequestId: headerReqId,
        usage: {}, stopReason: null, responsePreview: null,
        errorType: null, errorMessage: null,
        firstTokenMs: null, lastTokenMs: null,
      };

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

      diagOutboundStream(requestId, statusCode, ms, tps, reqMeta, state, response, rawSseBuffer);

      try {
        const { anthropicOrgId, anthropicRequestId } = extractResponseHeaders(response);
        // v22: system_prompts UPSERT + proxy_requests INSERT 원자화 (ADR-005).
        // trx 내부에서 throw 시 자동 롤백 — 고아 system_prompts 행 방지.
        db.transaction(() => {
          maybeUpsertSystemPrompt(db, reqMeta, startMs);
          createProxyRequest(db, {
            id: requestId, timestamp: startMs, method, path: url.pathname,
            status_code: statusCode, response_time_ms: ms,
            model: state.model,
            tokens_input: state.usage.input_tokens ?? 0,
            tokens_output: state.usage.output_tokens ?? 0,
            cache_creation_tokens: state.usage.cache_creation_input_tokens ?? 0,
            cache_read_tokens: state.usage.cache_read_input_tokens ?? 0,
            tokens_per_second: tps, is_stream: true,
            messages_count: reqMeta.messagesCount, max_tokens: reqMeta.maxTokens,
            tools_count: reqMeta.toolsCount, request_preview: reqMeta.requestPreview,
            stop_reason: state.stopReason, response_preview: state.responsePreview,
            error_type: state.errorType, error_message: state.errorMessage,
            first_token_ms: state.firstTokenMs, api_request_id: state.apiRequestId,
            // v19: cross-link 키
            session_id: sessionId, turn_id: turnId,
            // v20: 감사 메타
            client_user_agent: clientUserAgent, client_app: clientApp, anthropic_beta: anthropicBeta,
            anthropic_org_id: anthropicOrgId, anthropic_request_id: anthropicRequestId,
            thinking_type: reqMeta.thinkingType, temperature: reqMeta.temperature,
            system_preview: reqMeta.systemPreview, system_reminder: reqMeta.systemReminder,
            tool_names: reqMeta.toolNames,
            metadata_user_id: reqMeta.metadataUserId, client_meta_json: clientMeta,
            // v21: compressed payload
            payload,
            payload_raw_size: payloadRawSize,
            payload_algo: payload ? 'zstd' : null,
            // v22: system_prompts cross-link
            system_hash: reqMeta.systemHash ?? null,
            system_byte_size: reqMeta.systemByteSize ?? null,
          });
        })();

        // hook 측 미완성 행(model NULL 또는 tokens_source='unavailable')을
        // 같은 session_id + 시간 윈도우로 일괄 채움 — model + tokens + api_request_id.
        // ADR-004: affected ID 배열을 받아 SSE 'updated' 재브로드캐스트.
        const backfilledIds = backfillRequestFromProxy(db, {
          sessionId,
          model: state.model,
          apiRequestId: state.apiRequestId,
          tokensInput: state.usage.input_tokens ?? 0,
          tokensOutput: state.usage.output_tokens ?? 0,
          cacheCreationTokens: state.usage.cache_creation_input_tokens ?? 0,
          cacheReadTokens: state.usage.cache_read_input_tokens ?? 0,
          proxyStartMs: startMs,
        });
        broadcastBackfilledRequests(db, sessionId, backfilledIds);

        // DB 저장 성공 직후에만 캐시 무효화 + SSE 브로드캐스트.
        // 별도 try/catch로 격리 — broadcast 실패가 client 응답에 영향 안 주게.
        // @see docs/plans/proxy-sse-integration/plan.md Phase A
        try {
          invalidateDashboardCache();
          const broadcastPayload: ProxyBroadcastPayload = {
            id: requestId, timestamp: startMs, method, path: url.pathname,
            status_code: statusCode, response_time_ms: ms,
            model: state.model,
            tokens_input: state.usage.input_tokens ?? 0,
            tokens_output: state.usage.output_tokens ?? 0,
            cache_creation_tokens: state.usage.cache_creation_input_tokens ?? 0,
            cache_read_tokens: state.usage.cache_read_input_tokens ?? 0,
            tokens_per_second: tps, is_stream: true,
            messages_count: reqMeta.messagesCount, max_tokens: reqMeta.maxTokens,
            tools_count: reqMeta.toolsCount, request_preview: reqMeta.requestPreview,
            stop_reason: state.stopReason, response_preview: state.responsePreview,
            error_type: state.errorType, error_message: state.errorMessage,
            first_token_ms: state.firstTokenMs, api_request_id: state.apiRequestId,
            // v22: system_prompts cross-link (본문 미동봉)
            system_hash: reqMeta.systemHash ?? null,
            system_byte_size: reqMeta.systemByteSize ?? null,
          };
          broadcastNewProxyRequest(broadcastPayload);
        } catch (err) {
          console.warn('[PROXY] Broadcast error:', err);
        }
      } catch (err) {
        console.warn('[PROXY] DB save error:', err);
      }
    })();

    return new Response(response.body, { status: statusCode, headers: responseHeaders });
  }

  // ===========================================================================
  // 6-B. 비스트리밍 JSON 응답
  // ===========================================================================
  const bodyText = await response.text();
  const ms = Date.now() - startMs;

  const state: StreamState = {
    model: reqMeta.model, apiRequestId: headerReqId,
    usage: {}, stopReason: null, responsePreview: null,
    errorType: null, errorMessage: null,
    firstTokenMs: null, lastTokenMs: null,
  };

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

  diagOutboundJson(requestId, statusCode, ms, reqMeta, state, response, bodyText);

  try {
    const { anthropicOrgId, anthropicRequestId } = extractResponseHeaders(response);
    // v22: system_prompts UPSERT + proxy_requests INSERT 원자화 (ADR-005)
    db.transaction(() => {
      maybeUpsertSystemPrompt(db, reqMeta, startMs);
      createProxyRequest(db, {
        id: requestId, timestamp: startMs, method, path: url.pathname,
        status_code: statusCode, response_time_ms: ms,
        model: state.model,
        tokens_input: state.usage.input_tokens ?? 0,
        tokens_output: state.usage.output_tokens ?? 0,
        cache_creation_tokens: state.usage.cache_creation_input_tokens ?? 0,
        cache_read_tokens: state.usage.cache_read_input_tokens ?? 0,
        tokens_per_second: null, is_stream: false,
        messages_count: reqMeta.messagesCount, max_tokens: reqMeta.maxTokens,
        tools_count: reqMeta.toolsCount, request_preview: reqMeta.requestPreview,
        stop_reason: state.stopReason, response_preview: state.responsePreview,
        error_type: state.errorType, error_message: state.errorMessage,
        first_token_ms: null, api_request_id: state.apiRequestId,
        session_id: sessionId, turn_id: turnId,
        client_user_agent: clientUserAgent, client_app: clientApp, anthropic_beta: anthropicBeta,
        anthropic_org_id: anthropicOrgId, anthropic_request_id: anthropicRequestId,
        thinking_type: reqMeta.thinkingType, temperature: reqMeta.temperature,
        system_preview: reqMeta.systemPreview, system_reminder: reqMeta.systemReminder,
        tool_names: reqMeta.toolNames,
        metadata_user_id: reqMeta.metadataUserId, client_meta_json: clientMeta,
        // v21: compressed payload
        payload,
        payload_raw_size: payloadRawSize,
        payload_algo: payload ? 'zstd' : null,
        // v22: system_prompts cross-link
        system_hash: reqMeta.systemHash ?? null,
        system_byte_size: reqMeta.systemByteSize ?? null,
      });
    })();
    // ADR-004: affected ID 배열을 받아 SSE 'updated' 재브로드캐스트.
    const backfilledIdsJson = backfillRequestFromProxy(db, {
      sessionId,
      model: state.model,
      apiRequestId: state.apiRequestId,
      tokensInput: state.usage.input_tokens ?? 0,
      tokensOutput: state.usage.output_tokens ?? 0,
      cacheCreationTokens: state.usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: state.usage.cache_read_input_tokens ?? 0,
      proxyStartMs: startMs,
    });
    broadcastBackfilledRequests(db, sessionId, backfilledIdsJson);

    // SSE 브로드캐스트 격리 — broadcast 실패가 client 응답에 영향 안 주게 (T-06 ADR-005)
    try {
      invalidateDashboardCache();
      const broadcastPayload: ProxyBroadcastPayload = {
        id: requestId, timestamp: startMs, method, path: url.pathname,
        status_code: statusCode, response_time_ms: ms,
        model: state.model,
        tokens_input: state.usage.input_tokens ?? 0,
        tokens_output: state.usage.output_tokens ?? 0,
        cache_creation_tokens: state.usage.cache_creation_input_tokens ?? 0,
        cache_read_tokens: state.usage.cache_read_input_tokens ?? 0,
        tokens_per_second: null, is_stream: false,
        messages_count: reqMeta.messagesCount, max_tokens: reqMeta.maxTokens,
        tools_count: reqMeta.toolsCount, request_preview: reqMeta.requestPreview,
        stop_reason: state.stopReason, response_preview: state.responsePreview,
        error_type: state.errorType, error_message: state.errorMessage,
        first_token_ms: null, api_request_id: state.apiRequestId,
        // v22: system_prompts cross-link (본문 미동봉)
        system_hash: reqMeta.systemHash ?? null,
        system_byte_size: reqMeta.systemByteSize ?? null,
      };
      broadcastNewProxyRequest(broadcastPayload);
    } catch (err) {
      console.warn('[PROXY] Broadcast error:', err);
    }
  } catch (err) {
    console.warn('[PROXY] DB save error:', err);
  }

  return new Response(bodyText, { status: statusCode, headers: responseHeaders });
}

// =============================================================================
// system_prompts 헬퍼 — UPSERT 호출 전 RequestMeta 4 필드 NULL 가드
// =============================================================================

/**
 * RequestMeta에 systemHash 등 4 필드가 모두 채워졌을 때만 system_prompts UPSERT 호출.
 *
 * 책임:
 *  - body.system 미존재(또는 정규화 결과 빈값) 시 UPSERT 생략 — proxy_requests.system_hash NULL 적재.
 *  - 4 필드(hash/content/byteSize/segmentCount) 중 하나라도 누락이면 일관성을 위해 전체 생략.
 *
 * 호출자: handleProxy 안의 db.transaction 클로저 (stream / non-stream 두 경로 공통)
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

// =============================================================================
// 진단 로그 헬퍼 — handleProxy를 짧게 유지하기 위해 분리
// =============================================================================

/** 요청 진입 시 원문 본문 + 헤더 + 파싱 메타를 jsonl 한 줄로 기록 */
function diagInbound(
  req: Request,
  requestId: string,
  method: string,
  url: URL,
  bodyBuffer: ArrayBuffer | null,
  reqMeta: RequestMeta,
): void {
  const hdrObj: Record<string, string> = {};
  req.headers.forEach((v, k) => { hdrObj[k] = v; });

  let bodyStr: string | null = null;
  let bodyJson: unknown = null;
  if (bodyBuffer && bodyBuffer.byteLength > 0) {
    try {
      bodyStr = new TextDecoder().decode(bodyBuffer);
      try { bodyJson = JSON.parse(bodyStr); } catch { /* JSON 아니면 raw 문자열만 */ }
    } catch (err) {
      bodyStr = `<decode error: ${(err as Error).message}>`;
    }
  }

  diagJson('proxy-payload', {
    phase: 'in',
    requestId,
    method,
    path: url.pathname,
    search: url.search || null,
    bytes: bodyBuffer?.byteLength ?? 0,
    headers: hdrObj,
    body: bodyJson ?? bodyStr,
    parsedMeta: {
      model: reqMeta.model,
      messagesCount: reqMeta.messagesCount,
      maxTokens: reqMeta.maxTokens,
      toolsCount: reqMeta.toolsCount,
      isStreamReq: reqMeta.isStreamReq,
    },
  });
}

/**
 * SSE 스트리밍 응답 종료 시 진단 jsonl 기록.
 * rawSse는 사이즈 비대 원인 — 기본 미저장. SPYGLASS_DIAG_RAW_SSE=1일 때만 200KB까지 저장.
 */
function diagOutboundStream(
  requestId: string,
  statusCode: number,
  ms: number,
  tps: number | null,
  reqMeta: RequestMeta,
  state: StreamState,
  response: Response,
  rawSseBuffer: string,
): void {
  const respHdrObj: Record<string, string> = {};
  response.headers.forEach((v, k) => { respHdrObj[k] = v; });

  diagJson('proxy-payload', {
    phase: 'out-stream',
    requestId,
    statusCode,
    ms,
    ttft: state.firstTokenMs,
    tps,
    reqModel: reqMeta.model,
    streamModel: state.model,
    savedModel: state.model,
    usage: state.usage,
    stopReason: state.stopReason,
    apiRequestId: state.apiRequestId,
    errorType: state.errorType,
    errorMessage: state.errorMessage,
    responsePreview: state.responsePreview,
    responseHeaders: respHdrObj,
    rawSseLength: rawSseBuffer.length,
    ...(process.env.SPYGLASS_DIAG_RAW_SSE === '1'
      ? { rawSse: rawSseBuffer.slice(0, 200_000) }
      : {}),
  });
}

/** 비스트리밍 JSON 응답 종료 시 진단 jsonl 기록 (응답 본문 raw 포함) */
function diagOutboundJson(
  requestId: string,
  statusCode: number,
  ms: number,
  reqMeta: RequestMeta,
  state: StreamState,
  response: Response,
  bodyText: string,
): void {
  const respHdrObj: Record<string, string> = {};
  response.headers.forEach((v, k) => { respHdrObj[k] = v; });
  let respBodyJson: unknown = null;
  try { respBodyJson = JSON.parse(bodyText); } catch { /* keep raw */ }

  diagJson('proxy-payload', {
    phase: 'out-json',
    requestId,
    statusCode,
    ms,
    reqModel: reqMeta.model,
    jsonModel: state.model,
    savedModel: state.model,
    usage: state.usage,
    stopReason: state.stopReason,
    apiRequestId: state.apiRequestId,
    errorType: state.errorType,
    errorMessage: state.errorMessage,
    responseHeaders: respHdrObj,
    responseBody: respBodyJson ?? bodyText,
  });
}
