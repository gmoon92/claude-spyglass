// util/floating-position.js — anchor 기준 floating 요소 위치 계산 공유 모듈
//
// date-range-filter ADR-006: 기존 system-reminder-popover.js의 positionPopover 패턴을
// 일반화. dropdown / popover / 향후 tooltip 등 부유 컨테이너가 공유.
//
// 사용:
//   import { positionFloating, attachFloating } from './util/floating-position.js';
//   positionFloating(anchorEl, floatEl, { align: 'end', preferBelow: true });
//   const detach = attachFloating(anchorEl, floatEl, opts); // scroll/resize 자동 재계산
//   detach(); // cleanup
//
// CONTRACT: floatEl은 position:fixed + 가시 상태여야 한다 (getBoundingClientRect 의존).

const GAP = 4;
const SAFE = 8;

/**
 * @typedef {Object} PositionOpts
 * @property {'start'|'end'} [align='start']   start=anchor 좌측 정렬, end=anchor 우측 정렬
 * @property {boolean} [preferBelow=true]      true=anchor 아래 우선, 하단 넘침 시 위쪽 뒤집기
 */

/**
 * anchor 기준 float 요소 좌표를 fixed 좌표계로 설정.
 * viewport overflow 시 자동 보정 (우측 잘림 → end 정렬, 하단 잘림 → 위쪽 뒤집기).
 *
 * @param {HTMLElement} anchor
 * @param {HTMLElement} float
 * @param {PositionOpts} [opts]
 */
export function positionFloating(anchor, float, opts = {}) {
  if (!anchor || !float) return;
  const align = opts.align ?? 'start';
  const preferBelow = opts.preferBelow ?? true;

  const a = anchor.getBoundingClientRect();
  // 가시 상태 가정 — hidden 직후엔 호출자가 미리 hidden 해제 + display 노출
  const f = float.getBoundingClientRect();
  const fw = f.width;
  const fh = f.height;

  // 수평 위치
  let left = align === 'end' ? (a.right - fw) : a.left;
  // 우측 넘침 보정 — end 정렬로 재시도
  if (left + fw > window.innerWidth - SAFE) {
    left = a.right - fw;
  }
  // 그래도 좌측 넘침이면 clamp
  if (left < SAFE) left = SAFE;
  // 우측 다시 clamp (좁은 viewport에서 fw가 viewport보다 클 때 대비)
  if (left + fw > window.innerWidth - SAFE) {
    left = Math.max(SAFE, window.innerWidth - fw - SAFE);
  }

  // 수직 위치 — 기본은 아래
  let top = a.bottom + GAP;
  if (preferBelow) {
    // 하단 넘침 시 위쪽 뒤집기 (anchor 위로 띄움)
    if (top + fh > window.innerHeight - SAFE && a.top - GAP - fh >= SAFE) {
      top = a.top - GAP - fh;
    }
  } else {
    top = a.top - GAP - fh;
    if (top < SAFE) top = a.bottom + GAP;
  }

  float.style.top  = `${Math.round(top)}px`;
  float.style.left = `${Math.round(left)}px`;
}

/**
 * 열린 상태 추적 + scroll/resize 시 자동 재계산.
 * @param {HTMLElement} anchor
 * @param {HTMLElement} float
 * @param {PositionOpts} [opts]
 * @returns {() => void} detach — 호출 시 이벤트 핸들러 제거
 */
export function attachFloating(anchor, float, opts) {
  positionFloating(anchor, float, opts);
  const handler = () => positionFloating(anchor, float, opts);
  window.addEventListener('scroll', handler, true);
  window.addEventListener('resize', handler);
  return () => {
    window.removeEventListener('scroll', handler, true);
    window.removeEventListener('resize', handler);
  };
}
