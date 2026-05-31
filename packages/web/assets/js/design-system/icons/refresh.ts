/**
 * design-system/icons/refresh.js — 동기화(↻) 아이콘
 *
 * 책임:
 *  - 메타 모드 좌측 thead의 [동기화] 셀에서 사용하는 refresh SVG를 단독 모듈로 노출.
 *  - viewBox 0 0 16 16, stroke-only, currentColor, stroke-width 1.5, round cap/join.
 *
 * 사용처:
 *  - meta-docs-view.js (동기화 버튼/셀)
 *  - 이전 위치: render/icons.js (shim으로 re-export 유지)
 *
 * 디자인 패밀리:
 *  - stroke-only currentColor.
 *  - is-loading 클래스에서 CSS animation spin 회전 — viewBox 중심(8,8) 기준 좌우 대칭.
 *  - 기본 size 12.
 *
 * @module design-system/icons/refresh
 */

/**
 * 공통 SVG 래퍼 — viewBox/stroke 속성을 한 곳에서 관리.
 * @param {string} paths - <path .../> 등 내부 마크업
 * @param {{size?: number, className?: string, ariaLabel?: string}} [opts]
 */
function wrapSvg(paths: string, opts: { size?: number; className?: string; ariaLabel?: string | null } = {}) {
  const { size = 12, className = '', ariaLabel = null } = opts;
  const cls = className ? ` class="${className}"` : '';
  const aria = ariaLabel
    ? ` role="img" aria-label="${ariaLabel}"`
    : ' aria-hidden="true"';
  return `<svg${cls}${aria} viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

/**
 * 동기화(refresh) 아이콘 — 좌측 thead의 [동기화] 셀에서 사용.
 *  - 두 개의 반호(arc) + 양 끝 화살표 head로 회전 의미를 명확히.
 *  - is-loading 클래스에서 CSS animation으로 spin 회전.
 * @param {{size?: number, className?: string, ariaLabel?: string}} [opts]
 */
export function svgRefresh(opts?: { size?: number; className?: string; ariaLabel?: string | null }) {
  const paths =
    '<path d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9"/>' +
    '<path d="M13.5 8a5.5 5.5 0 0 1-9.4 3.9"/>' +
    '<path d="M9.5 4.5h2.5V2"/>' +
    '<path d="M6.5 11.5H4V14"/>';
  return wrapSvg(paths, opts);
}
