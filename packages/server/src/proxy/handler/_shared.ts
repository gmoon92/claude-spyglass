/**
 * proxy/handler — 공용 컨텍스트 타입 + 초기 state 생성기
 *
 * 책임:
 *  - handleProxy 진입 시 한 번 모아두는 요청 메타 묶음(HandlerContext) 정의.
 *  - StreamState의 기본값 생성기(createInitialState) 1곳 집중.
 *
 * srp-redesign Phase 8 분해의 axis 0 — 다른 분기 파일들이 import하는 공통.
 *
 * 외부 노출: 같은 handler/ 디렉토리 내부에서만 import.
 */

import type { RequestMeta, StreamState } from '../types';

/**
 * handleProxy 진입 직후 한 번 수집하여 stream/non-stream 분기에 전달.
 *
 * 변경 이유: 새 메타 추가(예: v23 client_*) 시 이 한 인터페이스만 갱신하면
 * inbound→stream/non-stream→persist→broadcast 흐름의 시그니처가 일관 갱신됨.
 */
export interface HandlerContext {
  /** crypto.randomUUID() 1회 — proxy_requests.id 와 동일 */
  requestId: string;
  /** Date.now() — 응답 시간 측정 + DB timestamp */
  startMs: number;
  /** HTTP method (forward용) */
  method: string;
  /** url.pathname + url.search (forward용) */
  path: string;
  /** url 객체 — pathname을 DB·diag·broadcast에 사용 */
  url: URL;
  /** 원본 Request — diag/inbound에서 헤더 dump 용 */
  req: Request;
  /** 본문 파싱 결과 (model, messagesCount 등) */
  reqMeta: RequestMeta;
  /** zstd 압축된 요청 본문 — 비어있거나 압축 실패 시 null */
  payload: Uint8Array | null;
  /** 압축 전 byte 크기 — DB에 raw size 적재 */
  payloadRawSize: number | null;
  /** v19 hook ↔ proxy 매칭 키 */
  sessionId: string | null;
  /** v19 같은 turn 묶음 키 */
  turnId: string | null;
  /** v20 클라이언트 user-agent */
  clientUserAgent: string | null;
  /** v20 클라이언트 앱 이름 */
  clientApp: string | null;
  /** v20 anthropic-beta 헤더 */
  anthropicBeta: string | null;
  /** v20 클라이언트 메타 JSON */
  clientMeta: string | null;
}

/** 분기 진입 시 StreamState 기본값 — stream/non-stream 공통. */
export function createInitialState(
  reqMeta: RequestMeta,
  headerReqId: string | null,
): StreamState {
  return {
    model: reqMeta.model,
    apiRequestId: headerReqId,
    usage: {},
    stopReason: null,
    responsePreview: null,
    errorType: null,
    errorMessage: null,
    firstTokenMs: null,
    lastTokenMs: null,
  };
}
