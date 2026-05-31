/**
 * design-system/icons/trash.js — 휴지통(삭제) 아이콘
 *
 * 책임:
 *  - 메타 모드 '삭제된 정의 포함' 토글에서 사용하는 휴지통 SVG를 단독 모듈로 노출.
 *  - viewBox 0 0 16 16, stroke-only, currentColor, stroke-width 1.5, round cap/join.
 *
 * 사용처:
 *  - meta-docs-view.js (deleted_at 필터 토글 레이블)
 *  - 이전 위치: render/icons.js (shim으로 re-export 유지)
 *
 * 디자인 패밀리:
 *  - stroke-only currentColor — 호출 측 CSS `color:` 가 톤을 결정.
 *  - 기본 size 12 — 필터 바 텍스트와 광학 정렬.
 *
 * @module design-system/icons/trash
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
 * 휴지통(삭제) 아이콘 — '삭제된 정의 포함' 토글에서 사용.
 *  - 본체 사다리꼴(path1) + 뚜껑 가로선(path2) + 손잡이(path3) + 슬릿 2개(path4).
 *  - 사용자 피드백: 단순 emoji는 톤이 떠보이므로 line-icon 패밀리에 합류.
 * @param {{size?: number, className?: string, ariaLabel?: string}} [opts]
 */
export function svgTrash(opts?: { size?: number; className?: string; ariaLabel?: string | null }) {
  const paths =
    '<path d="M3 4.5l1 9a1.2 1.2 0 0 0 1.2 1H10.8a1.2 1.2 0 0 0 1.2-1l1-9"/>' +
    '<path d="M2 4.5h12"/>' +
    '<path d="M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5"/>' +
    '<path d="M6.5 7.5v4M9.5 7.5v4"/>';
  return wrapSvg(paths, opts);
}
