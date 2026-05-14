/**
 * design-system/icons/agent-dot.js — Agent/Skill 도구 아이콘 (◎ 글리프 대체, bullseye)
 *
 * 책임:
 *  - Agent/Skill/Task 도구를 표지하는 이중 원(bullseye) SVG 아이콘을 단독 모듈로 노출.
 *  - viewBox 0 0 16 16, stroke-only, currentColor.
 *
 * 흡수:
 *  - render/badges.js toolIconHtml ◎ 글리프 (isAgent === true 분기)
 *  - meta-docs-view.js metaDocTypeBadge ◎ 글리프 (toolIconHtml('Agent') 호출 경유)
 *
 * 의존:
 *  - currentColor 토큰 (hex 색상 하드코딩 금지)
 *  - stroke-only currentColor 패밀리 일관성
 *
 * 디자인 패밀리:
 *  - 이중 원 (bullseye) — ◎ 글리프와 동일 의미.
 *  - 기본 size 12 — 도구 아이콘 텍스트와 광학 정렬.
 *
 * @module design-system/icons/agent-dot
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
 * Agent/Skill 도구 아이콘 — ◎ 글리프 대체 (bullseye).
 *  - 이중 원(stroke-only): 바깥 circle r=6.5 + 안쪽 circle r=3.
 *  - 기본 size 12 — 도구 아이콘 텍스트와 광학 정렬.
 * @param {{size?: number, className?: string, ariaLabel?: string}} [opts]
 */
export function svgAgentDot(opts = {}) {
  const { size = 12, ...rest } = opts;
  const paths =
    '<circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/>';
  return wrapSvg(paths, { size, ...rest });
}
