/**
 * design-system/icons/check.js — 다중 선택 체크박스 마커 아이콘
 *
 * 책임:
 *  - AskUserQuestion 다중 선택 옵션의 ☐(미선택) / ☑(선택) 글리프를 SVG로 대체.
 *  - render/extract.js L183-184 의 글리프 텍스트를 흡수.
 *  - viewBox 0 0 16 16, stroke-only, currentColor, stroke-width 1.5, round cap/join.
 *
 * 사용처:
 *  - render/extract.js buildAskUserQuestionHtml — multiSelect=true 분기
 *
 * 디자인 패밀리:
 *  - stroke-only currentColor.
 *  - 기본 size 12 — askq-option-marker 인라인 텍스트 높이에 맞춘 크기.
 *
 * @module design-system/icons/check
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
 * 다중 선택 체크박스 마커 — AskUserQuestion ☐☑.
 *  - 미선택(selected=false): 외곽 사각 rect rx=2 만.
 *  - 선택(selected=true): 외곽 사각 + 체크 path M5 8.5L7.5 11L11.5 5.5.
 *  - 기본 size 12 — askq-option-marker 인라인 텍스트 높이에 맞춘 크기.
 * @param {{size?: number, selected?: boolean, className?: string, ariaLabel?: string}} [opts]
 */
export function svgCheck(opts: { size?: number; className?: string; ariaLabel?: string | null; selected?: boolean } = {}) {
  const { size = 12, selected = false, ...rest } = opts;
  const paths =
    '<rect x="2" y="2" width="12" height="12" rx="2"/>' +
    (selected ? '<path d="M5 8.5L7.5 11L11.5 5.5"/>' : '');
  return wrapSvg(paths, { size, ...rest });
}
