// stores/version-store.ts — 버전 폴링 결과 단일 SSoT (태스크 #6 / Phase2-a)
//
// 배경(버그 #6): UpdateBadge(사이드바 footer)와 UpdateModal/DashboardWarning(AppShell 오버레이)이
//   서로 다른 위치에서 같은 버전 정보를 소비한다. 과거에는 useVersionCheck(로컬 훅)를 AppShell·
//   BrowseSidebar 두 곳에서 각각 호출 → 폴러 2개 + 상태 분리 + 배지 이중 렌더(stray)를 유발했다.
//
// 본 스토어는 단일 폴러(AppShell이 useVersionCheck 1회 호출)가 기록하는 버전 SSoT다. 배지/모달/경고는
//   위치가 달라도 이 스토어를 구독해 동일 데이터를 읽는다. 모달 open 상태도 여기 둬, 사이드바 배지가
//   AppShell의 모달을 열 수 있게 한다(위치가 분리된 트리거↔오버레이의 결합).
//
// 컴포넌트 계약 보존: UpdateBadge/UpdateModal/DashboardWarning 은 그대로 controlled(props) 컴포넌트로
//   유지하고, 부모(AppShell/사이드바)가 이 스토어를 읽어 props 로 주입한다(기존 골든 테스트 무영향).
//
// 레이어: stores(in-memory, 휘발) — app-store/sse-store 와 동형. persist 비대상(폴링으로 곧 갱신).

import { create } from 'zustand';
import type { VersionPayload, VersionViewState } from '../features/dashboard/version-check-controller';

export interface VersionStoreState {
  /** 배지 뷰모델(상태 + 버전) — UpdateBadge controlled props 소스. */
  view: VersionViewState;
  /** 최신 /api/version payload(모달 버전 비교용). */
  cache: VersionPayload | null;
  /** shallow clone 표지(DashboardWarning 결선). */
  isShallow: boolean;
  /** 업데이트 모달 open — 사이드바 배지(트리거)와 AppShell 모달(오버레이)이 위치 분리돼 스토어로 공유. */
  modalOpen: boolean;
  /** 단일 폴러(AppShell useVersionCheck)가 폴링 결과를 기록. */
  setVersion: (next: { view: VersionViewState; cache: VersionPayload | null; isShallow: boolean }) => void;
  openModal: () => void;
  closeModal: () => void;
}

export const useVersionStore = create<VersionStoreState>((set) => ({
  view: { badge: 'loading' },
  cache: null,
  isShallow: false,
  modalOpen: false,
  setVersion: ({ view, cache, isShallow }) => set({ view, cache, isShallow }),
  openModal: () => set({ modalOpen: true }),
  closeModal: () => set({ modalOpen: false }),
}));
