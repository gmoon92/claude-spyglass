// stores/anomaly-store.ts — 세션 단위 anomaly(bloated_sys) SSoT (Zustand)
//
// 배경(A-2 — CustomEvent 제거):
//   /api/sessions 목록 응답엔 bloated_sys 메타가 없다(서버 SSoT 는 단건 /api/sessions/:id).
//   detail-view(useSessionLoad)의 단건 fetch 결과를 다른 UI 영역(사이드바 dot 등)이 재참조하기
//   위한 캐시다. 과거에는 두 메커니즘이 얽혀 있었다:
//     1) assets/js/state/anomaly-cache.ts 모듈 Map (SSoT 캐시)
//     2) document 'session-anomalies-loaded' CustomEvent (사이드바 재렌더 신호)
//   전역 document 이벤트버스는 React 통일성을 깨므로, 둘을 본 Zustand store 로 일원화한다.
//   detail-view 가 setBloatedSysFor 로 store 를 갱신하면, store 를 구독하는 React 소비처가
//   재렌더된다(CustomEvent 신호 불필요). 비반응형 읽기(렌더 중 직접 호출)는 getBloatedSysFor 로 한다.
//
// SSoT 위치: 본 store 가 React 계층의 anomaly 캐시 단일 출처다(assets/js/state/anomaly-cache.ts 는
//   vanilla 레거시 전용으로 남되 src 는 더 이상 import 하지 않는다 — React 채널 일원화).
//
// 라이프사이클: 세션 ID 키로 누적. 명시 초기화 없음 — in-memory(휘발), 페이지 새로고침으로 리셋.
//   app-store/sse-store/version-store 와 동형(persist 비대상).

import { create } from 'zustand';
import type { BloatedSysView } from '../lib/view-types';

export interface AnomalyStoreState {
  /** 세션 id → bloated_sys 뷰(없으면 키 부재 또는 null). */
  bloatedBySession: Record<string, BloatedSysView | null>;
  /**
   * 단건 anomaly fetch 결과 기록(detail-view useSessionLoad). 입력은 서버 anomaly 응답(파싱 계약 약함) —
   * 캐시는 BloatedSysView 형태로만 저장(레거시 setBloatedSysFor 동치). 동일 값이면 set 생략(불필요 재렌더 회피).
   */
  setBloatedSysFor: (sessionId: string, bloatedSys: unknown) => void;
}

export const useAnomalyStore = create<AnomalyStoreState>((set, get) => ({
  bloatedBySession: {},
  setBloatedSysFor: (sessionId, bloatedSys) => {
    const next = (bloatedSys as BloatedSysView) || null;
    const prev = get().bloatedBySession[sessionId] ?? null;
    if (prev === next) return; // 동일 참조면 no-op(SSE 재렌더 시 idempotent)
    set((s) => ({ bloatedBySession: { ...s.bloatedBySession, [sessionId]: next } }));
  },
}));

/**
 * 비반응형 읽기 — 렌더 중 직접 호출(SessionRow 가 plain 함수/컴포넌트 양쪽으로 호출되므로 hook 불가).
 * 레거시 anomaly-cache.getBloatedSysFor(sessionId) 1:1. 반응형 구독이 필요한 소비처는 useAnomalyStore selector 사용.
 */
export function getBloatedSysFor(sessionId: string): BloatedSysView | null {
  return useAnomalyStore.getState().bloatedBySession[sessionId] ?? null;
}
