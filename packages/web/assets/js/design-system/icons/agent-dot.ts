/**
 * design-system/icons/agent-dot.js — Agent/Task 도구 아이콘 (◎ 글리프 대체, bullseye)
 *
 * 책임:
 *  - Agent / Task 도구를 표지하는 이중 원(bullseye) SVG 아이콘을 단독 모듈로 노출.
 *  - viewBox 0 0 16 16, stroke-only, currentColor.
 *
 * 디자인 의도 (왜 bullseye인가):
 *  - 동심원 두 개 = "위임/대리(proxy)" 뉘앙스 — Agent가 또 다른 컨텍스트에 호출을 위임하는
 *    의미 구조를 시각화. Skill(단일 호출, fish-eye)과 의도적으로 분리.
 *  - 2026-05-22 분리: 이전엔 Skill도 같은 아이콘을 받았으나, turn-spine에서 두 분류를
 *    분간할 수 없다는 사용자 피드백에 따라 Skill → [[skill-dot]](fish-eye)으로 이관.
 *
 * 흡수:
 *  - render/badges.js toolIconHtml — Agent / Task 분기 (Skill은 [[skill-dot]]로 라우팅)
 *  - meta-docs-view.js metaDocTypeBadge ◎ 글리프 (toolIconHtml('Agent') 하드코딩 호출)
 *
 * 의존:
 *  - currentColor 토큰 (hex 색상 하드코딩 금지)
 *  - stroke-only currentColor 패밀리 일관성
 *
 * 디자인 패밀리:
 *  - 이중 원 (bullseye) — ◎ 글리프와 동일 의미.
 *  - 기본 size 12 — 도구 아이콘 텍스트와 광학 정렬.
 *
 * 관련 모듈:
 *  - [[skill-dot]] Skill용 fish-eye 아이콘 (시각 구분 짝)
 *  - [[tool-dot]]  일반 도구용 fish-eye 아이콘
 *
 * @module design-system/icons/agent-dot
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
 * Agent/Skill 도구 아이콘 — ◎ 글리프 대체 (bullseye).
 *  - 이중 원(stroke-only): 바깥 circle r=6.5 + 안쪽 circle r=3.
 *  - 기본 size 12 — 도구 아이콘 텍스트와 광학 정렬.
 * @param {{size?: number, className?: string, ariaLabel?: string}} [opts]
 */
export function svgAgentDot(opts: { size?: number; className?: string; ariaLabel?: string | null } = {}) {
  const { size = 12, ...rest } = opts;
  const paths =
    '<circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/>';
  return wrapSvg(paths, { size, ...rest });
}
