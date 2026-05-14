/**
 * design-system/icons/tool-dot.js — 일반 도구 아이콘 (◉ 글리프 대체, fish-eye)
 *
 * 책임:
 *  - 일반 도구(Bash/Read/Edit 등 비-Agent)를 표지하는 외곽 원 + 안쪽 큰 점 SVG 아이콘을 단독 모듈로 노출.
 *  - viewBox 0 0 16 16, fill + stroke 혼용, currentColor.
 *
 * 흡수:
 *  - render/badges.js toolIconHtml ◉ 글리프 (isAgent === false 분기)
 *  - render/cells.js targetInnerHtml ◉ 글리프 (role-icon, user/system/assistant 케이스)
 *
 * 의존:
 *  - currentColor 토큰 (hex 색상 하드코딩 금지)
 *  - fill + stroke 혼용 허용 (도구 표지 의미 보존)
 *
 * 디자인 패밀리:
 *  - 외곽 원 + 안쪽 큰 점 (fish-eye) — ◉ 글리프와 동일 의미.
 *  - 기본 size 12 — 도구 아이콘 텍스트와 광학 정렬.
 *
 * @module design-system/icons/tool-dot
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
 * 일반 도구 아이콘 — ◉ 글리프 대체 (fish-eye).
 *  - 외곽 원 + 안쪽 큰 점: circle r=6.5(outline) + circle r=3.5(fill).
 *  - 기본 size 12 — 도구 아이콘 텍스트와 광학 정렬.
 * @param {{size?: number, className?: string, ariaLabel?: string}} [opts]
 */
export function svgToolDot(opts = {}) {
  const { size = 12, ...rest } = opts;
  const paths =
    '<circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<circle cx="8" cy="8" r="3.5" fill="currentColor" stroke="none"/>';
  return wrapSvg(paths, { size, ...rest });
}
