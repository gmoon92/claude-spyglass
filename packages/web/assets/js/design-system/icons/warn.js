/**
 * design-system/icons/warn.js — 경고(삼각형+느낌표) 아이콘
 *
 * 책임:
 *  - 메타 카드의 deleted_at != null 상태 표시에 사용하는 경고 SVG를 단독 모듈로 노출.
 *  - viewBox 0 0 16 16, stroke-only, currentColor, stroke-width 1.5, round cap/join.
 *
 * 사용처:
 *  - meta-docs-view.js (삭제된 정의 카드 경고 배지)
 *  - 이전 위치: render/icons.js (shim으로 re-export 유지)
 *
 * 디자인 패밀리:
 *  - stroke-only currentColor — `color: var(--warn)` 적용을 호출 측에서 결정.
 *  - 기본 size 12.
 *
 * @module design-system/icons/warn
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
 * 경고(soft-deleted) 아이콘 — 메타 카드의 deleted_at != null 표시.
 *  - 삼각형(path1) + 느낌표 막대(path2) + 점(path3).
 *  - 기존 ⚠ emoji 대비 stroke-only로 가벼움.
 * @param {{size?: number, className?: string, ariaLabel?: string}} [opts]
 */
export function svgWarn(opts) {
  const paths =
    '<path d="M8 2.5L14.5 13.5H1.5L8 2.5Z"/>' +
    '<path d="M8 7v3.2"/>' +
    '<path d="M8 12.2v0.01"/>';
  return wrapSvg(paths, opts);
}
