/**
 * features/dashboard/infra-state.ts — 스크롤 락 배너 카운터 순수 로직 (P3-09)
 *
 * 원본: assets/js/infra.js (에러 표시·상태 배지·스크롤 락 — 외부 의존 없음).
 *  - 에러 배너/LIVE 배지/jumpToLatest 는 document 직접 변형(DOM-imperative) → React 계층은
 *    배너 가시성/카운트를 상태로 들고 렌더(P3-02 Sidebar / P4-06 라우터 계층 소유).
 *  - 본 모듈은 "새 요청 누적 카운터"의 순수 로직만 추출한다(원본 모듈 전역 _scrollLockNewCount).
 *    DOM 변형(banner.innerHTML/classList)은 호출처가 이 상태를 보고 JSX 로 렌더.
 *
 * 신규 계약: 원본은 모듈 전역 카운터를 mutate 했으나, 본 모듈은 불변 상태 + 순수 전이로 분리
 *  (스토어/컴포넌트가 상태 소유 — 전역 mutate 폐기, 테스트 결정론).
 *
 * @module features/dashboard/infra-state
 */

/** 스크롤 락 상태 — 새 요청 누적 수. */
export interface ScrollLockState {
  newCount: number;
}

export const initialScrollLock: ScrollLockState = { newCount: 0 };

/** 새 요청 1건 누적(원본 addScrollLockCount). */
export function incrementScrollLock(s: ScrollLockState): ScrollLockState {
  return { newCount: s.newCount + 1 };
}

/** 카운터 리셋(원본 resetScrollLockCount / jumpToLatest 진입 시). */
export function resetScrollLock(): ScrollLockState {
  return { newCount: 0 };
}

/** 배너 노출 여부(원본 updateScrollLockBanner: newCount>0 → visible). */
export function isScrollLockBannerVisible(s: ScrollLockState): boolean {
  return s.newCount > 0;
}
