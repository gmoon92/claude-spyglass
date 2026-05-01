/**
 * Spyglass Proxy Handler — /v1/* → Anthropic API 포워딩
 *
 * 수집 데이터:
 *  - HTTP 레벨: 응답 시간, 상태 코드, TTFT, TPS
 *  - 요청 본문: model, messages_count, max_tokens, tools_count, request_preview
 *  - 응답 본문: stop_reason, response_preview, error_type/message, api_request_id
 *  - 토큰: input/output/cache, cost_usd
 *
 * 환경변수:
 *  - ANTHROPIC_UPSTREAM_URL: 포워딩 대상 (기본: https://api.anthropic.com)
 *  - SPYGLASS_PROXY_DEBUG: '1' 이면 헤더 상세 출력
 */

import type { Database } from 'bun:sqlite';
import { createProxyRequest } from '@spyglass/storage';
import { broadcastNewProxyRequest, type ProxyBroadcastPayload } from './sse';
import { invalidateDashboardCache } from './api';

// =============================================================================
// 설정
// =============================================================================

const UPSTREAM_URL = (process.env.ANTHROPIC_UPSTREAM_URL || 'https://api.anthropic.com').replace(/\/$/, '');
const DEBUG_VERBOSE = process.env.SPYGLASS_PROXY_DEBUG === '1';

// 모델 프리픽스 → 커스텀 upstream URL 매핑
// CUSTOM_UPSTREAMS 환경변수: "prefix1=url1,prefix2=url2" 형식
const CUSTOM_UPSTREAMS: Array<{ prefix: string; url: string }> = [
  { prefix: 'kimi-', url: (process.env.MOONSHOT_UPSTREAM_URL || 'https://api.moonshot.ai/anthropic').replace(/\/$/, '') },
  ...(process.env.CUSTOM_UPSTREAMS || '').split(',').filter(Boolean).map(entry => {
    const [prefix, url] = entry.split('=');
    return { prefix: prefix.trim(), url: url?.trim() || '' };
  }).filter(e => e.prefix && e.url),
];

function selectUpstreamUrl(model: string | null): string {
  if (model) {
    for (const { prefix, url } of CUSTOM_UPSTREAMS) {
      if (model.startsWith(prefix)) return url;
    }
  }
  return UPSTREAM_URL;
}

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding', 'upgrade', 'host',
]);

// =============================================================================
// 요청 본문 파싱
// =============================================================================

interface RequestMeta {
  model: string | null;
  messagesCount: number;
  maxTokens: number | null;
  toolsCount: number;
  requestPreview: string | null;
  isStreamReq: boolean;
}

function parseRequestBody(buffer: ArrayBuffer): RequestMeta {
  const meta: RequestMeta = {
    model: null, messagesCount: 0, maxTokens: null,
    toolsCount: 0, requestPreview: null, isStreamReq: false,
  };
  if (!buffer || buffer.byteLength === 0) return meta;

  try {
    const body = JSON.parse(new TextDecoder().decode(buffer));
    meta.model = typeof body.model === 'string' ? body.model : null;
    meta.maxTokens = typeof body.max_tokens === 'number' ? body.max_tokens : null;
    meta.isStreamReq = body.stream === true;

    if (Array.isArray(body.messages)) {
      meta.messagesCount = body.messages.length;
      // 마지막 user 메시지를 preview로 저장
      const lastUser = [...body.messages].reverse().find((m: { role?: string }) => m.role === 'user');
      if (lastUser) {
        const content = lastUser.content;
        const text = typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content
                .filter((c: { type?: string }) => c.type === 'text')
                .map((c: { text?: string }) => c.text ?? '')
                .join(' ')
            : '';
        meta.requestPreview = text.slice(0, 200) || null;
      }
    }

    if (Array.isArray(body.tools)) {
      meta.toolsCount = body.tools.length;
    }
  } catch {
    // 파싱 실패 무시
  }

  return meta;
}

// =============================================================================
// SSE 파싱 — Anthropic 스트리밍 응답에서 usage + 메타데이터 추출
// =============================================================================

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface StreamState {
  model: string | null;
  apiRequestId: string | null;
  usage: AnthropicUsage;
  stopReason: string | null;
  responsePreview: string | null;
  errorType: string | null;
  errorMessage: string | null;
  firstTokenMs: number | null;
  lastTokenMs: number | null;
}

function parseSSEChunk(text: string, state: StreamState, startMs: number): void {
  const lines = text.split('\n');
  let currentEvent = '';

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7).trim();
      continue;
    }
    if (!line.startsWith('data: ')) continue;
    const raw = line.slice(6).trim();
    if (raw === '[DONE]') continue;

    let data: Record<string, unknown>;
    try { data = JSON.parse(raw); } catch { continue; }

    switch (currentEvent) {
      case 'message_start': {
        const msg = data.message as Record<string, unknown> | undefined;
        if (!msg) break;
        state.model = (msg.model as string) ?? state.model;
        state.apiRequestId = (msg.id as string) ?? state.apiRequestId;
        const u = msg.usage as AnthropicUsage | undefined;
        if (u) {
          state.usage.input_tokens = u.input_tokens ?? 0;
          state.usage.cache_creation_input_tokens = u.cache_creation_input_tokens ?? 0;
          state.usage.cache_read_input_tokens = u.cache_read_input_tokens ?? 0;
        }
        break;
      }
      case 'content_block_start':
        if (state.firstTokenMs === null) state.firstTokenMs = Date.now() - startMs;
        break;
      case 'content_block_delta': {
        if (state.firstTokenMs === null) state.firstTokenMs = Date.now() - startMs;
        state.lastTokenMs = Date.now() - startMs;
        const delta = (data.delta as Record<string, unknown>) ?? {};
        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          if (state.responsePreview === null) state.responsePreview = '';
          if (state.responsePreview.length < 200) {
            state.responsePreview = (state.responsePreview + delta.text).slice(0, 200);
          }
        }
        break;
      }
      case 'message_delta': {
        const d = data.delta as Record<string, unknown> | undefined;
        if (d?.stop_reason) state.stopReason = d.stop_reason as string;
        const u = data.usage as AnthropicUsage | undefined;
        if (u?.output_tokens != null) {
          state.usage.output_tokens = u.output_tokens;
          state.lastTokenMs = Date.now() - startMs;
        }
        break;
      }
      case 'error': {
        const err = data.error as Record<string, unknown> | undefined;
        if (err) {
          state.errorType = (err.type as string) ?? null;
          state.errorMessage = (err.message as string) ?? null;
        }
        break;
      }
    }
  }
}

// =============================================================================
// 비용 계산
// =============================================================================

// 비용 계산은 제거됨: 정확한 가격 플랜을 알 수 없으므로 추정치는 신뢰도가 낮음.

// =============================================================================
// 디버그 출력
// =============================================================================

function logResult(p: {
  method: string; path: string; statusCode: number; ms: number;
  isStream: boolean; model: string | null; usage: AnthropicUsage;
  tps: number | null; stopReason: string | null;
  ttft: number | null; errorType: string | null; requestPreview: string | null;
}): void {
  const ok = p.statusCode >= 200 && p.statusCode < 300;
  const icon = ok ? '✓' : '✗';
  const streamLabel = p.isStream ? ' (stream)' : '';
  console.log(`[PROXY] ${icon} ${p.method} ${p.path} → ${p.statusCode} ${p.ms}ms${streamLabel}`);
  if (p.model)         console.log(`[PROXY]   model    : ${p.model}`);
  if (p.stopReason)    console.log(`[PROXY]   stop     : ${p.stopReason}`);
  if (p.errorType)     console.log(`[PROXY]   error    : ${p.errorType}`);
  console.log(
    `[PROXY]   tokens   : in=${p.usage.input_tokens ?? 0}` +
    ` out=${p.usage.output_tokens ?? 0}` +
    ` cache_create=${p.usage.cache_creation_input_tokens ?? 0}` +
    ` cache_read=${p.usage.cache_read_input_tokens ?? 0}`
  );
  if (p.ttft !== null)  console.log(`[PROXY]   ttft     : ${p.ttft}ms`);
  if (p.tps !== null)   console.log(`[PROXY]   tps      : ${p.tps.toFixed(1)} tok/s`);
  if (p.requestPreview) console.log(`[PROXY]   preview  : ${p.requestPreview.slice(0, 80)}…`);
}

// =============================================================================
// 포워딩 헤더 생성
// =============================================================================

function buildForwardHeaders(req: Request): Headers {
  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  if (DEBUG_VERBOSE) {
    const obj: Record<string, string> = {};
    headers.forEach((v, k) => { obj[k] = v; });
    console.log('[PROXY] Request headers:', obj);
  }
  return headers;
}

// =============================================================================
// 메인 핸들러
// =============================================================================

export async function handleProxy(req: Request, url: URL, db: Database): Promise<Response> {
  const requestId = crypto.randomUUID();
  const startMs = Date.now();
  const method = req.method;
  const path = url.pathname + url.search;

  // 요청 본문 버퍼링 + 파싱
  const bodyBuffer = req.body ? await req.arrayBuffer() : null;
  const reqMeta = bodyBuffer ? parseRequestBody(bodyBuffer) : {
    model: null, messagesCount: 0, maxTokens: null,
    toolsCount: 0, requestPreview: null, isStreamReq: false,
  };

  console.log(`[PROXY] → ${method} ${url.pathname}${reqMeta.model ? ` [${reqMeta.model}]` : ''}`);

  const forwardHeaders = buildForwardHeaders(req);
  const upstreamBase = selectUpstreamUrl(reqMeta.model);
  const targetUrl = `${upstreamBase}${path}`;
  if (upstreamBase !== UPSTREAM_URL) {
    console.log(`[PROXY] Custom upstream: ${upstreamBase} (model=${reqMeta.model})`);
  }

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
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const statusCode = response.status;
  const isStream = (response.headers.get('content-type') ?? '').includes('text/event-stream');

  // 응답 헤더 (압축 제거)
  const responseHeaders = new Headers();
  response.headers.forEach((v, k) => {
    if (k !== 'content-encoding' && k !== 'content-length') responseHeaders.set(k, v);
  });
  responseHeaders.set('Access-Control-Allow-Origin', '*');

  // Anthropic request ID는 응답 헤더에도 있음
  const headerReqId = response.headers.get('request-id') ?? response.headers.get('x-request-id') ?? null;

  // ==========================================================================
  // 스트리밍 응답
  // ==========================================================================
  if (isStream && response.body) {
    const analyticsClone = response.clone();

    (async () => {
      const state: StreamState = {
        model: reqMeta.model, apiRequestId: headerReqId,
        usage: {}, stopReason: null, responsePreview: null,
        errorType: null, errorMessage: null,
        firstTokenMs: null, lastTokenMs: null,
      };

      try {
        const reader = analyticsClone.body!.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) parseSSEChunk(decoder.decode(value, { stream: true }), state, startMs);
        }
      } catch (err) {
        console.warn('[PROXY] Stream analytics error:', err);
      }

      const ms = Date.now() - startMs;
      const tps = (state.firstTokenMs !== null && state.lastTokenMs !== null
        && state.lastTokenMs > state.firstTokenMs && (state.usage.output_tokens ?? 0) > 0)
        ? (state.usage.output_tokens!) / ((state.lastTokenMs - state.firstTokenMs) / 1000)
        : null;
      logResult({
        method, path: url.pathname, statusCode, ms, isStream: true,
        model: state.model, usage: state.usage, tps,
        stopReason: state.stopReason, ttft: state.firstTokenMs,
        errorType: state.errorType, requestPreview: reqMeta.requestPreview,
      });

      try {
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
        });
        // DB 저장 성공 직후에만 캐시 무효화 + SSE 브로드캐스트
        // @see docs/plans/proxy-sse-integration/plan.md Phase A
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
        };
        broadcastNewProxyRequest(broadcastPayload);
      } catch (err) {
        console.warn('[PROXY] DB save error:', err);
      }
    })();

    return new Response(response.body, { status: statusCode, headers: responseHeaders });
  }

  // ==========================================================================
  // 비스트리밍 응답
  // ==========================================================================
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

    const u = json.usage as AnthropicUsage | undefined;
    if (u) state.usage = { ...u };

    // 응답 미리보기 (content 배열)
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
    // 파싱 실패 무시
  }

  logResult({
    method, path: url.pathname, statusCode, ms, isStream: false,
    model: state.model, usage: state.usage, tps: null,
    stopReason: state.stopReason, ttft: null,
    errorType: state.errorType, requestPreview: reqMeta.requestPreview,
  });

  try {
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
    });
    // DB 저장 성공 직후에만 캐시 무효화 + SSE 브로드캐스트
    // @see docs/plans/proxy-sse-integration/plan.md Phase A
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
    };
    broadcastNewProxyRequest(broadcastPayload);
  } catch (err) {
    console.warn('[PROXY] DB save error:', err);
  }

  return new Response(bodyText, { status: statusCode, headers: responseHeaders });
}
