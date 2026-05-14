/**
 * design-system/icons/radio.js — 단일 선택 라디오 마커 아이콘
 *
 * 책임:
 *  - AskUserQuestion 단일 선택 옵션의 ○(미선택) / ●(선택) 글리프를 SVG로 대체.
 *  - render/extract.js L183-184 의 글리프 텍스트를 흡수.
 *  - viewBox 0 0 16 16, stroke-only, currentColor, stroke-width 1.5.
 *
 * 사용처:
 *  - render/extract.js buildAskUserQuestionHtml — multiSelect=false 분기
 *
 * 디자인 패밀리:
 *  - stroke-only currentColor.
 *  - 기본 size 12 — askq-option-marker 인라인 텍스트 높이에 맞춘 크기.
 *
 * @module design-system/icons/radio
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
  return `<svg${cls}${aria} viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5">${paths}</svg>`;
}

/**
 * 단일 선택 라디오 마커 — AskUserQuestion ○●.
 *  - 미선택(selected=false): 외곽 원 circle r=6.5 만.
 *  - 선택(selected=true): 외곽 원 + 안쪽 채워진 원 circle r=3 fill=currentColor.
 *  - 기본 size 12 — askq-option-marker 인라인 텍스트 높이에 맞춘 크기.
 * @param {{size?: number, selected?: boolean, className?: string, ariaLabel?: string}} [opts]
 */
export function svgRadio(opts = {}) {
  const { size = 12, selected = false, ...rest } = opts;
  const paths =
    '<circle cx="8" cy="8" r="6.5"/>' +
    (selected ? '<circle cx="8" cy="8" r="3" fill="currentColor" stroke="none"/>' : '');
  return wrapSvg(paths, { size, ...rest });
}
