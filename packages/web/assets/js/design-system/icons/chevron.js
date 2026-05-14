/**
 * design-system/icons/chevron.js — 꺾쇠(방향) 아이콘 (D-04)
 *
 * 책임:
 *  - btn-toggle, sidebar-edge-toggle, turn-toggle ▸, llm-input 삼각형 흡수 대상 SVG를 단독 모듈로 노출.
 *  - viewBox 0 0 12 12, stroke-only, currentColor, stroke-width 1.6, round cap/join.
 *
 * 사용처:
 *  - 토글 버튼, 사이드바 엣지 토글, 턴 카드 펼침 버튼
 *  - 이전 위치: render/icons.js (shim으로 re-export 유지)
 *
 * 디자인 패밀리:
 *  - stroke-only currentColor.
 *  - dir 옵션으로 inline style rotate — right=0deg, down=90deg, left=180deg, up=270deg.
 *  - 기본 size 12 — 토글 버튼 및 입력창 인라인 요소와 정렬.
 *
 * @module design-system/icons/chevron
 */

/**
 * 꺾쇠(chevron) 아이콘 — D-04.
 *  - 기본 방향 오른쪽: path "M4.5 2L8.5 6L4.5 10".
 *  - viewBox 0 0 12 12, stroke-width 1.6.
 *  - dir 옵션에 따라 SVG에 inline style transform: rotate(...)를 적용.
 * @param {{size?: number, dir?: 'right'|'down'|'left'|'up', className?: string, ariaLabel?: string}} [opts]
 */
export function svgChevron(opts = {}) {
  const { size = 12, dir = 'right', className = '', ariaLabel = null } = opts;
  const rotateMap = { right: 0, down: 90, left: 180, up: 270 };
  const deg = rotateMap[dir] ?? 0;
  const cls = className ? ` class="${className}"` : '';
  const aria = ariaLabel
    ? ` role="img" aria-label="${ariaLabel}"`
    : ' aria-hidden="true"';
  const style = deg !== 0 ? ` style="transform:rotate(${deg}deg)"` : '';
  const paths = '<path d="M4.5 2L8.5 6L4.5 10"/>';
  return `<svg${cls}${aria}${style} data-dir="${dir}" viewBox="0 0 12 12" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}
