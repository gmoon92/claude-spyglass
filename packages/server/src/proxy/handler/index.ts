/**
 * proxy 모듈 — 메인 핸들러 진입점 (HTTP /v1/* 진입점)
 *
 * 책임:
 *  - /v1/* 요청을 Anthropic 또는 커스텀 upstream으로 포워딩.
 *  - 단계별 모듈을 호출하여 데이터 흐름을 오케스트레이션.
 *  - 본 파일에는 비즈 로직을 두지 않고 단계 호출만 — SRP axis 0.
 *
 * 데이터 흐름:
 *  client → handleProxy
 *      → buildInboundContext  (inbound)   ─ HandlerContext + bodyBuffer
 *      → diagInbound          (diag)      ─ 진단 jsonl phase=in
 *      → forwardToUpstream    (inbound)   ─ fetch + 502 매핑
 *      → buildResponseHeaders (inbound)   ─ CORS + 헤더 정리
 *      → 분기:
 *         (a) SSE 스트림: handleStreamResponse (stream.ts)
 *         (b) JSON 비스트림: handleJsonResponse (non-stream.ts)
 *      각 분기 내부에서: log → diag → persist (DB tx) → broadcast
 *
 * 외부 노출: handleProxy(req, url, db) — proxy/handler.ts shim에서 re-export
 * 호출자: server/src/index.ts (HTTP 라우터, shim 경유)
 *
 * 의존성:
 *  - 같은 디렉토리: _shared, inbound, stream, non-stream, persist, broadcast, diag
 */

import type { Database } from 'bun:sqlite';
import { buildInboundContext, forwardToUpstream, buildResponseHeaders } from './inbound';
import { diagInbound } from './diag';
import { handleStreamResponse } from './stream';
import { handleJsonResponse } from './non-stream';

/**
 * /v1/* 요청을 upstream으로 포워딩하고 메타를 수집·저장.
 */
export async function handleProxy(req: Request, url: URL, db: Database): Promise<Response> {
  // 1~2. 본문 + 헤더 + 압축 + hook 매칭 키 수집
  const { ctx, bodyBuffer } = await buildInboundContext(req, url, db);

  // 3. 진단 jsonl: 진입 시 원문 페이로드·헤더·파싱 메타 기록
  diagInbound(req, ctx.requestId, ctx.method, url, bodyBuffer, ctx.reqMeta);

  // 4~5. upstream 결정 + fetch (실패 시 502 즉시 반환)
  const fwd = await forwardToUpstream(ctx, bodyBuffer);
  if ('errorResponse' in fwd) return fwd.errorResponse;
  const { response } = fwd;

  const statusCode = response.status;
  const isStream = (response.headers.get('content-type') ?? '').includes('text/event-stream');
  const responseHeaders = buildResponseHeaders(response);
  const headerReqId = response.headers.get('request-id')
    ?? response.headers.get('x-request-id') ?? null;

  // 6-A: SSE 스트리밍 — body는 즉시 client에 stream으로 반환하고, clone으로 분석
  if (isStream && response.body) {
    return handleStreamResponse(db, ctx, response, responseHeaders, statusCode, headerReqId);
  }

  // 6-B: 비스트리밍 JSON
  return handleJsonResponse(db, ctx, response, responseHeaders, statusCode, headerReqId);
}
