/**
 * features/session-detail/system-reminder-popover.ts — 팝오버 좌표 계산 SSoT (P3-07 / P5 React화)
 *
 * 원본: assets/js/session-detail/system-reminder-popover.js#positionPopover:210.
 *
 * P5 정공법(SystemReminderChip.tsx 로 상태기계 흡수):
 *  - open/close/toggle 상태기계(`createPopoverController`)와 전역 닫기 훅(`useSystemReminderPopover`)은
 *    **폐기**됐다. 팝오버 open/close 는 SystemReminderChip 의 `useState`, portal 은 `createPortal`,
 *    aria-expanded·hidden 은 JSX 속성 바인딩, 전역 닫기 위임은 컴포넌트 자체 useEffect 로 이관됨.
 *  - 본 모듈은 **순수 좌표 수학만** 남긴다(`computePopoverPosition`). 측정값(getBoundingClientRect)은
 *    호출처(컴포넌트 ref)가 제공하고, 본 함수는 viewport clamp 산식만 책임진다 — 산식 SSoT 단일화.
 *
 * @module features/session-detail/system-reminder-popover
 */

const GAP = 4;
const SAFE = 8;

/** positionPopover 입력 — 칩 rect 의 필요한 필드만. */
export interface ChipRect {
  left: number;
  bottom: number;
}

/** 팝오버 좌표(viewport 기준 fixed). */
export interface PopoverPosition {
  top: number;
  left: number;
}

/**
 * 팝오버 좌표 계산(positionPopover:210 SSoT, 순수 수학).
 *  - 기본: 칩 좌측 정렬(left = chipRect.left), 칩 아래(top = chipRect.bottom + GAP).
 *  - 우측 넘침: left + width > viewportWidth - SAFE → 우측끝 - SAFE.
 *  - 좌측 넘침: 보정 결과 < SAFE → SAFE 로 clamp.
 *  - 하단 넘침은 보정하지 않는다(칩 위 뒤집기 UX 회귀가 더 큼).
 */
export function computePopoverPosition(
  chipRect: ChipRect,
  popoverWidth: number,
  viewportWidth: number,
): PopoverPosition {
  let left = chipRect.left;
  if (left + popoverWidth > viewportWidth - SAFE) {
    left = viewportWidth - popoverWidth - SAFE;
  }
  if (left < SAFE) left = SAFE;
  const top = chipRect.bottom + GAP;
  return { top, left };
}
