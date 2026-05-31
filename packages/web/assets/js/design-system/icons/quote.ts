/**
 * design-system/icons/quote.js — 인용 부호(따옴표) 아이콘
 *
 * 책임:
 *  - 턴 카드 헤더 Row 2의 사용자 프롬프트 표지 SVG를 단독 모듈로 노출.
 *  - "사용자 프롬프트 = 인용된 발화"라는 메타포로 채움형 미니 따옴표 쌍 글리프.
 *  - viewBox 0 0 12 12, fill 전용 currentColor — chip 색상을 CSS `color:`가 결정.
 *
 * 사용처:
 *  - session-detail/turn-views.js (renderTurnCards 의 .turn-card-prompt-icon)
 *
 * 디자인 패밀리:
 *  - fill-only currentColor (diamond.js와 같은 fill 패밀리).
 *  - 좌측·우측에 90° 회전된 채움형 따옴표 한 쌍 — 인용 글리프의 시각 어휘.
 *  - 기본 size 12 — 카드 헤더 prompt-row text-body(12px)와 광학 정렬.
 *
 * @module design-system/icons/quote
 */

/**
 * 따옴표(quote) 아이콘 — 사용자 프롬프트 표지.
 *  - 채움형 미니 따옴표 한 쌍 (좌측 두 점 형태). chip 색상은 currentColor 추종.
 *  - 기본 size 12.
 * @param {{size?: number, className?: string, ariaLabel?: string}} [opts]
 */
export function svgQuote(opts: { size?: number; className?: string; ariaLabel?: string | null } = {}) {
  const { size = 12, className = '', ariaLabel = null } = opts;
  const cls  = className ? ` class="${className}"` : '';
  const aria = ariaLabel
    ? ` role="img" aria-label="${ariaLabel}"`
    : ' aria-hidden="true"';
  // 좌측 따옴표 + 우측 따옴표 — 각각 위쪽 사각형 + 아래쪽 꼬리.
  // 시각적으로 "‟"에 가까운 형태로 인용 메타포 즉시 인지.
  const paths = [
    '<path d="M2 3.5 H4.2 V5.7 H3.1 L2 7.5 V3.5 Z" fill="currentColor"/>',
    '<path d="M5.8 3.5 H8 V5.7 H6.9 L5.8 7.5 V3.5 Z" fill="currentColor"/>',
  ].join('');
  return `<svg${cls}${aria} viewBox="0 0 12 12" width="${size}" height="${size}" fill="none" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;
}
