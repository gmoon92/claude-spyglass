/**
 * design-system/icons/status-ended.js — 세션 정상 종료 상태 아이콘 (○ 글리프 대체)
 *
 * 책임:
 *  - 정상 종료된 세션을 표지하는 외곽선만 있는 원 SVG 아이콘을 단독 모듈로 노출.
 *  - viewBox 0 0 16 16, stroke-only, currentColor.
 *
 * 흡수:
 *  - render/rows.js makeSessionRow ○ 글리프 (liveState === 'ended' 분기)
 *
 * 의존:
 *  - currentColor 토큰 (hex 색상 하드코딩 금지)
 *  - stroke-only currentColor 패밀리 일관성
 *
 * 디자인 패밀리:
 *  - stroke-only 원 — ○ 글리프와 동일 의미.
 *  - 기본 size 12 — 세션 행 상태 표지와 광학 정렬.
 *
 * @module design-system/icons/status-ended
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
 * 세션 종료(ended) 상태 아이콘 — ○ 글리프 대체.
 *  - 외곽선만 있는 원: <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor"/>.
 *  - 기본 size 12 — 세션 행 상태 표지와 광학 정렬.
 * @param {{size?: number, className?: string, ariaLabel?: string}} [opts]
 */
export function svgStatusEnded(opts = {}) {
  const { size = 12, ...rest } = opts;
  const paths = '<circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/>';
  return wrapSvg(paths, { size, ...rest });
}
