/**
 * design-system/icons/diamond.js — 다이아몬드(채움) 아이콘 (D-29 옵션 B)
 *
 * 책임:
 *  - 어시스턴트 응답 표지(◆ 글리프 대체) SVG 아이콘을 단독 모듈로 노출.
 *  - fill 전용(stroke-only 패밀리와 달리 fill="currentColor") — 다이아몬드 ◆ 글리프의
 *    의미(채워진 마름모, 어시스턴트 응답 구분자)를 픽셀 수준에서 보존한다.
 *  - viewBox 0 0 16 16, fill-only, currentColor.
 *
 * 흡수:
 *  - session-detail/turn-views.js : compressFlowWithResponses 안의 response-chip ◆ 글리프
 *  - session-detail/turn-rows.js  : responseMarkerHtml ◆ 글리프
 *
 * 의존:
 *  - currentColor 토큰 (hex 색상 하드코딩 금지)
 *  - fill 전용 — stroke 속성 없음 (stroke-only 형제 파일과 의도적으로 분리)
 *
 * 디자인 패밀리:
 *  - fill-only currentColor (예외: 대부분 형제 파일은 stroke-only지만 다이아몬드는 fill).
 *  - 기본 size 10 — response-chip / turn-row 마커의 기존 글리프 사이즈와 광학 정렬.
 *
 * @module design-system/icons/diamond
 */

/**
 * 다이아몬드(diamond) 아이콘 — 어시스턴트 응답 표지.
 *  - M8 1L15 8L8 15L1 8z (45° 회전 정사각형, 마름모).
 *  - fill="currentColor" — stroke 없이 단색 채움.
 *  - 기본 size 10 — response-chip / turn-row 마커의 기존 ◆ 글리프와 시각 일치.
 * @param {{size?: number, className?: string, ariaLabel?: string}} [opts]
 */
export function svgDiamond(opts: { size?: number; className?: string; ariaLabel?: string | null } = {}) {
  const { size = 10, className = '', ariaLabel = null } = opts;
  const cls  = className ? ` class="${className}"` : '';
  const aria = ariaLabel
    ? ` role="img" aria-label="${ariaLabel}"`
    : ' aria-hidden="true"';
  const paths = '<path d="M8 1L15 8L8 15L1 8z" fill="currentColor"/>';
  return `<svg${cls}${aria} viewBox="0 0 16 16" width="${size}" height="${size}" fill="none">${paths}</svg>`;
}
