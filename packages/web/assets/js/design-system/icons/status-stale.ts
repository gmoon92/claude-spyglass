/**
 * design-system/icons/status-stale.js — 세션 stale 상태 아이콘 (◐ 글리프 대체)
 *
 * 책임:
 *  - SessionEnd 누락으로 stale 판정된 세션을 표지하는 반쪽 채워진 원 SVG 아이콘을 단독 모듈로 노출.
 *  - viewBox 0 0 16 16, fill + stroke 혼용, currentColor.
 *
 * 흡수:
 *  - render/rows.js makeSessionRow ◐ 글리프 (liveState === 'stale' 분기)
 *
 * 의존:
 *  - currentColor 토큰 (hex 색상 하드코딩 금지)
 *  - fill + stroke 혼용 허용 (상태 의미 보존)
 *
 * 디자인 패밀리:
 *  - 외곽선 원 + 우측 반쪽 채움 — ◐ 글리프와 동일 의미.
 *  - 기본 size 12 — 세션 행 상태 표지와 광학 정렬.
 *
 * @module design-system/icons/status-stale
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
 * 세션 stale 상태 아이콘 — ◐ 글리프 대체.
 *  - 외곽선 원 + 오른쪽 반원 채움: circle(outline) + path(반원 fill).
 *  - 기본 size 12 — 세션 행 상태 표지와 광학 정렬.
 * @param {{size?: number, className?: string, ariaLabel?: string}} [opts]
 */
export function svgStatusStale(opts: { size?: number; className?: string; ariaLabel?: string | null } = {}) {
  const { size = 12, ...rest } = opts;
  const paths =
    '<circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<path d="M8 3 A5 5 0 0 1 8 13 Z" fill="currentColor" stroke="none"/>';
  return wrapSvg(paths, { size, ...rest });
}
