/**
 * design-system/icons/search.js — 검색(돋보기) 아이콘 (D-03)
 *
 * 책임:
 *  - search-box.js의 ⌕ glyph, llm-input-view.js의 🔎 emoji 흡수 대상 SVG를 단독 모듈로 노출.
 *  - viewBox 0 0 16 16, stroke-only, currentColor, stroke-width 1.5, round cap/join.
 *
 * 사용처:
 *  - search-box.js (검색창 내부 아이콘)
 *  - llm-input-view.js (흡수 예정)
 *  - 이전 위치: render/icons.js (shim으로 re-export 유지)
 *
 * 디자인 패밀리:
 *  - stroke-only currentColor.
 *  - 기본 size 14 — 검색 입력창 내부 텍스트와 광학 정렬.
 *
 * @module design-system/icons/search
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
 * 검색(돋보기) 아이콘 — D-03.
 *  - circle r=4.5 cx=7 cy=7 + line 10.5,10.5→14,14.
 *  - 기본 size 14 — 검색 입력창 내부 텍스트와 광학 정렬.
 * @param {{size?: number, className?: string, ariaLabel?: string}} [opts]
 */
export function svgSearch(opts = {}) {
  const { size = 14, ...rest } = opts;
  const paths =
    '<circle cx="7" cy="7" r="4.5"/>' +
    '<line x1="10.5" y1="10.5" x2="14" y2="14"/>';
  return wrapSvg(paths, { size, ...rest });
}
