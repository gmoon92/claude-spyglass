/**
 * design-system/icons/info.js — 정보(원+i) 아이콘 (D-11)
 *
 * 책임:
 *  - index.html error-banner SVG, llm-input-banner-icon 흡수 대상 SVG를 단독 모듈로 노출.
 *  - viewBox 0 0 16 16, stroke-only, currentColor, stroke-width 1.5, round cap/join.
 *
 * 사용처:
 *  - 배너/알림 영역, LLM input 뷰 배너
 *  - 이전 위치: render/icons.js (shim으로 re-export 유지)
 *
 * 디자인 패밀리:
 *  - stroke-only currentColor.
 *  - 기본 size 14 — 배너/알림 영역의 본문 텍스트와 광학 정렬.
 *
 * @module design-system/icons/info
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
 * 정보(info) 아이콘 — D-11.
 *  - circle r=6.5 + 세로 획(8,5→8,9) + 점(cx=8 cy=11.5 r=0.6 fill=currentColor).
 *  - 기본 size 14 — 배너/알림 영역의 본문 텍스트와 광학 정렬.
 * @param {{size?: number, className?: string, ariaLabel?: string}} [opts]
 */
export function svgInfo(opts: { size?: number; className?: string; ariaLabel?: string | null } = {}) {
  const { size = 14, ...rest } = opts;
  const paths =
    '<circle cx="8" cy="8" r="6.5"/>' +
    '<line x1="8" y1="5" x2="8" y2="9"/>' +
    '<circle cx="8" cy="11.5" r="0.6" fill="currentColor" stroke="none"/>';
  return wrapSvg(paths, { size, ...rest });
}
