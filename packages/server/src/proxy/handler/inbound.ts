/**
 * proxy/handler — inbound 단계 (axis A)
 *
 * 책임:
 *  - body buffer 추출 + zstd 압축 (DB 적재용 payload 생성).
 *  - hook 매칭 키(session_id, turn_id) + 클라이언트 헤더 메타 수집 — HandlerContext 한 객체로.
 *  - upstream 결정 + forward 헤더 빌드 + fetch 실행. 502 매핑.
 *
 * 변경 이유: 요청 진입 정책(헤더 수집·압축·라우팅)과 응답 처리 분기는 다른 축.
 *
 * 호출자: handler/index.ts (handleProxy 진입점)
 */

import type { Database } from 'bun:sqlite';
import type { RequestMeta } from '../types';
import { selectUpstreamUrl, buildForwardHeaders, UPSTREAM_URL } from '../upstream';
import { parseRequestBody } from '../request-parser';
import { extractClientHeaders } from '../audit-headers';
import { getLastTurnId } from '../../hook';
import type { HandlerContext } from './_shared';

const EMPTY_REQ_META: RequestMeta = {
  model: null, messagesCount: 0, maxTokens: null,
  toolsCount: 0, requestPreview: null, isStreamReq: false,
  thinkingType: null, temperature: null, systemPreview: null,
  toolNames: null, metadataUserId: null, systemReminder: null,
};

/**
 * 요청 본문 추출 + RequestMeta 파싱 + zstd 압축 + hook 매칭 키 + 클라이언트 헤더.
 * 결과를 한 HandlerContext 묶음으로 반환 (이후 단계 공통 입력).
 */
export async function buildInboundContext(
  req: Request,
  url: URL,
  db: Database,
): Promise<{ ctx: HandlerContext; bodyBuffer: ArrayBuffer | null }> {
  const requestId = crypto.randomUUID();
  const startMs = Date.now();
  const method = req.method;
  const path = url.pathname + url.search;

  // 1. 요청 본문 파싱
  const bodyBuffer = req.body ? await req.arrayBuffer() : null;
  const reqMeta: RequestMeta = bodyBuffer ? parseRequestBody(bodyBuffer) : { ...EMPTY_REQ_META };

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

  return {
    bodyBuffer,
    ctx: {
      requestId, startMs, method, path, url, req,
      reqMeta, payload, payloadRawSize,
      sessionId, turnId,
      clientUserAgent, clientApp, anthropicBeta, clientMeta,
    },
  };
}

/**
 * upstream URL 결정 + forward 헤더 + fetch 실행.
 * 연결 실패 시 502 응답 객체를 반환 (호출자가 그대로 client에 반환).
 */
export async function forwardToUpstream(
  ctx: HandlerContext,
  bodyBuffer: ArrayBuffer | null,
): Promise<{ response: Response } | { errorResponse: Response }> {
  const { method, reqMeta, path, req } = ctx;

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
    return {
      errorResponse: new Response(
        JSON.stringify({ error: 'proxy_connection_failed', message: String(err) }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      ),
    };
  }

  return { response };
}

/**
 * upstream Response 헤더에서 client에 전달할 헤더 세트를 빌드.
 * - content-encoding/content-length 제거 (Bun 자동 decompress 후 length 안 맞을 수 있음)
 * - CORS Access-Control-Allow-Origin: * 추가
 */
export function buildResponseHeaders(response: Response): Headers {
  const responseHeaders = new Headers();
  response.headers.forEach((v, k) => {
    if (k !== 'content-encoding' && k !== 'content-length') responseHeaders.set(k, v);
  });
  responseHeaders.set('Access-Control-Allow-Origin', '*');
  return responseHeaders;
}
