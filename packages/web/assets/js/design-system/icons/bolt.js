/**
 * design-system/icons/bolt.js — 번개(bolt) 아이콘
 *
 * 책임:
 *  - 번개·캐시·빠른 처리 등을 표지하는 stroke-only SVG 아이콘을 단독 모듈로 노출.
 *  - viewBox 0 0 16 16, stroke-only, currentColor, stroke-width 1.5, round cap/join.
 *
 * 흡수:
 *  - index.html L415 — 기본 뷰 Cache 컬럼 헤더의 ⚡ 글리프
 *  - index.html L518 — 상세 뷰 Cache 컬럼 헤더의 ⚡ 글리프
 *
 * 의존:
 *  - currentColor 토큰 (hex 색상 하드코딩 금지)
 *  - stroke-only currentColor 패밀리 일관성 (info.js, 기타 형제 파일과 동일 스타일)
 *
 * 디자인 패밀리:
 *  - stroke-only currentColor.
 *  - 기본 size 14 — 본문 텍스트와 광학 정렬.
 *
 * @module design-system/icons/bolt
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
 * 번개(bolt) 아이콘 — 캐시·빠른 처리 표지.
 *  - 번개 모양 단일 path (M9.5 1.5L3 9h4.5L6.5 14.5L13 7H8.5L9.5 1.5z).
 *  - 기본 size 14 — 본문 텍스트와 광학 정렬.
 * @param {{size?: number, className?: string, ariaLabel?: string}} [opts]
 */
export function svgBolt(opts = {}) {
  const { size = 14, ...rest } = opts;
  const paths = '<path d="M9.5 1.5L3 9h4.5L6.5 14.5L13 7H8.5L9.5 1.5z"/>';
  return wrapSvg(paths, { size, ...rest });
}
