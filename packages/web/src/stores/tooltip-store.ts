// stores/tooltip-store.ts — 차트 데이터 포인트 호버 상태 SSoT (Zustand)
//
// 배경(A-2 — point-hover CustomEvent 제거 / B-1 — Portal 툴팁):
//   과거 차트(ContextChart/Chart)는 데이터 포인트 호버 시 document 'ctx-point-hover' /
//   'timeline-point-hover' CustomEvent 를 발행하고, use-tooltip 이 document 에서 구독했다.
//   전역 document 이벤트버스는 React 통일성을 깨므로, 본 store 로 일원화한다:
//     차트(발행자) → store.setPointHover(detail) / clearPointHover()
//     React 툴팁 컴포넌트(소비자) → useTooltipStore 구독 → createPortal 로 렌더
//   "차트=발행 / 툴팁=표시" 단일책임 분리는 그대로 유지하되 채널만 React store 로 바꾼다.
//
// 라이프사이클: in-memory(휘발). app-store/sse-store/version-store/anomaly-store 와 동형(persist 비대상).

import { create } from 'zustand';
import type { CtxPointHoverDetail } from '../features/dashboard/context-chart-data';
import type { TimelineHoverDetail } from '../components/Chart';

/**
 * 활성 포인트 호버 — kind 로 분기.
 *  - 'ctx': 누적 토큰 차트(ContextChart) 수치 툴팁
 *  - 'timeline': 전체 요청 타임라인(Chart) "시각 · N건" 툴팁
 * null = 호버 없음(설명 툴팁이 복원될 수 있는 상태).
 */
export type PointHover =
  | { kind: 'ctx'; detail: CtxPointHoverDetail }
  | { kind: 'timeline'; detail: TimelineHoverDetail }
  | null;

export interface TooltipStoreState {
  /** 현재 활성 포인트 호버(없으면 null). */
  pointHover: PointHover;
  /** 차트가 호버 진입/이동 시 호출(레거시 ctx-point-hover/timeline-point-hover dispatch 동치). */
  setPointHover: (hover: PointHover) => void;
  /** 차트가 호버 이탈 시 호출(레거시 detail=null dispatch 동치). */
  clearPointHover: () => void;
}

export const useTooltipStore = create<TooltipStoreState>((set) => ({
  pointHover: null,
  setPointHover: (hover) => set({ pointHover: hover }),
  clearPointHover: () => set({ pointHover: null }),
}));
