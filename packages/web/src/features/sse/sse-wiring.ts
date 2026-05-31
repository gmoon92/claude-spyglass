// features/sse/sse-wiring.ts — useSSE(P4-04) ↔ sse-store(P4-05) 결선 글루.
//
// 역할: P4-04 useSSE 가 받는 SSECallbacks 를 P4-05 sse-store 액션으로 매핑한다.
//   onNewRequest      → applyNewRequest
//   onNewProxyRequest → applyNewProxyRequest
//   onSessionUpdate   → applySessionUpdate
//
// 레이어(architecture.md §1.3): features → hooks(use-sse) + stores(sse-store) 의존은 정방향(허용).
//   stores 가 hooks/features 를 역참조하지 않도록(규칙3), 결선은 stores 가 아니라 이 features 글루에 둔다.
//   글루는 store 의 getState() 액션을 호출만 한다(컴포넌트/DOM/네트워크 무참조 — 순수 매핑).
//
// onOpen/onError: 원본 main.js 의 onOpen(fetchDashboard/fetchAllSessions/fetchRequests + DOM)·
//   onError(스크롤락 배너)는 fetch 오케스트레이션/DOM 책임이라 SSE 상태 전이가 아니다 → 본 글루에 포함하지 않는다.
//   호출처(App/effects)가 useSSE 에 onOpen/onError 를 직접 합성한다(spread). 본 글루는 3 데이터 채널만 책임.
//
// @see packages/web/src/hooks/use-sse.ts (SSECallbacks 계약, useSSE)
// @see packages/web/src/stores/sse-store.ts (applyNewRequest/applyNewProxyRequest/applySessionUpdate)

import type { SSECallbacks } from '../../hooks/use-sse';
import { useSSEStore } from '../../stores/sse-store';

/**
 * SSE 3 데이터 채널을 sse-store 액션에 결선한 SSECallbacks 를 만든다.
 *
 * 사용: `useSSE({ ...createSSEStoreCallbacks(), onOpen, onError })` — 데이터 채널은 스토어로,
 *   연결 생명주기(onOpen/onError)는 호출처가 합성. 액션은 getState()로 호출 시점에 조회하므로
 *   stale 참조가 없다(zustand 액션은 안정 신원).
 */
export function createSSEStoreCallbacks(): SSECallbacks {
  return {
    onNewRequest: (data) => useSSEStore.getState().applyNewRequest(data),
    onNewProxyRequest: (data) => useSSEStore.getState().applyNewProxyRequest(data),
    onSessionUpdate: (data) => useSSEStore.getState().applySessionUpdate(data),
  };
}
