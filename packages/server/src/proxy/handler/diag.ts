/**
 * proxy/handler — 진단 jsonl 헬퍼 (axis F)
 *
 * 책임:
 *  - 요청 진입(diagInbound) / 스트리밍 응답 종료(diagOutboundStream) /
 *    비스트리밍 응답 종료(diagOutboundJson) 3 phase의 jsonl 한 줄 기록을 분리.
 *  - SPYGLASS_DIAG_RAW_SSE=1 일 때만 raw SSE를 200KB까지 동봉(원형 보존).
 *
 * 변경 이유: 진단 필드 추가/제거가 비즈 로직과 무관 — 같은 파일에 두면
 *           오케스트레이션 코드가 진단 노이즈에 묻힘.
 *
 * 호출자: handler/index.ts, handler/stream.ts, handler/non-stream.ts
 */

import type { RequestMeta, StreamState } from '../types';
import { diagJson } from '../../diag-log';

/** 요청 진입 시 원문 본문 + 헤더 + 파싱 메타를 jsonl 한 줄로 기록 */
export function diagInbound(
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
export function diagOutboundStream(
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
export function diagOutboundJson(
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
