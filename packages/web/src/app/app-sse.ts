// app/app-sse.ts — 최상위 SSE 콜백 합성 (P4-06)
//
// 원본: main.js startSSE(:357-441) 가 connectSSE 에 3 데이터 채널 + onOpen/onError 를 한 객체로 넘겼다.
//   React 전환에서 데이터 채널은 sse-store 결선(P4-05 createSSEStoreCallbacks)이 SSoT 이고,
//   연결 생명주기(onOpen/onError)는 App/effects 가 합성한다(sse-wiring.ts 헤더 §onOpen/onError 계약).
//
// 본 팩토리는 그 합성을 한 곳에 모은 순수 함수다 — useSSE(P4-04) 에 주입할 SSECallbacks 를 만든다.
//   useSSE 의 useEffect 안에서만 EventSource 가 생성되므로(SSR effect 미발화), 본 팩토리 자체는
//   EventSource/DOM 을 만들지 않는다 → SSR/노드 환경에서 콜백 결선만 단위 검증 가능.
//
// 레이어(architecture.md §1.3): app → features(sse-wiring) → stores(sse-store) 정방향.
//   데이터 채널 재구현 금지 — createSSEStoreCallbacks 를 그대로 spread 한다(SSoT).

import type { SSECallbacks } from '../hooks/use-sse';
import { createSSEStoreCallbacks } from '../features/sse';

/** App 이 주입하는 연결 생명주기 핸들러(선택). 데이터 채널은 sse-store 가 SSoT. */
export interface AppSSELifecycle {
  /** 연결 성립(EventSource onopen) — main.js onOpen 의 fetch 오케스트레이션 자리(호출처 주입). */
  onOpen?: () => void;
  /** 연결 오류(EventSource onerror) — main.js onError 의 스크롤락/연결상태 자리(호출처 주입). */
  onError?: () => void;
}

/**
 * useSSE 주입용 SSECallbacks 합성:
 *   - 데이터 3채널(new_request/new_proxy_request/session_update) → sse-store 액션(createSSEStoreCallbacks).
 *   - onOpen/onError → 호출처 주입(미지정 시 undefined — useSSE 가 안전 호출).
 */
export function buildAppSSECallbacks(lifecycle: AppSSELifecycle): SSECallbacks {
  return {
    ...createSSEStoreCallbacks(),
    onOpen: lifecycle.onOpen,
    onError: lifecycle.onError,
  };
}
