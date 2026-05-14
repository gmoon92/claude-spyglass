/**
 * design-system/icons/error.js — 오류(원+X) 아이콘 (D-11)
 *
 * 책임:
 *  - badges.css .badge-error ✗ glyph, state.css .state-error-icon 흡수 대상 SVG를 단독 모듈로 노출.
 *  - viewBox 0 0 16 16, stroke-only, currentColor, stroke-width 1.5, round cap/join.
 *
 * 사용처:
 *  - 배지 오류 상태, 상태 표시 영역
 *  - 이전 위치: render/icons.js (shim으로 re-export 유지)
 *
 * 디자인 패밀리:
 *  - stroke-only currentColor.
 *  - 기본 size 14 — 배지 및 상태 표시 영역의 텍스트 높이에 맞춘 크기.
 *
 * @module design-system/icons/error
 */

/**
 * 공통 SVG 래퍼 — viewBox/stroke 속성을 한 곳에서 관리.
 * @param {string} paths - <path .../> 등 내부 마크업
 * @param {{size?: number, className?: string, ariaLabel?: string}} [opts]
 */
function wrapSvg(paths, opts = {}) {
  const { size = 12, className = '', ariaLabel = null } = opts;
  const cls = className ? ` class="${className}"` : '';
  const aria = ariaLabel
    ? ` role="img" aria-label="${ariaLabel}"`
    : ' aria-hidden="true"';
  return `<svg${cls}${aria} viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

/**
 * 오류(error) 아이콘 — D-11.
 *  - circle r=6.5 cx=8 cy=8 + X 대각선 두 줄.
 *  - 기본 size 14 — 배지 및 상태 표시 영역의 텍스트 높이에 맞춘 크기.
 * @param {{size?: number, className?: string, ariaLabel?: string}} [opts]
 */
export function svgError(opts = {}) {
  const { size = 14, ...rest } = opts;
  const paths =
    '<circle cx="8" cy="8" r="6.5"/>' +
    '<line x1="5.5" y1="5.5" x2="10.5" y2="10.5"/>' +
    '<line x1="10.5" y1="5.5" x2="5.5" y2="10.5"/>';
  return wrapSvg(paths, { size, ...rest });
}
