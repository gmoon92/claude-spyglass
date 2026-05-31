/**
 * @module design-system/badges/badge
 *
 * 책임:
 *   조건부로 표시되는 상태 신호·이상 탐지·타입 표지를 일관된 시각 어휘로 렌더링한다.
 *   호출자는 tone(의미)과 label(텍스트)만 넘기면 되고, 색·배경·패딩은
 *   badge.css + design-tokens.css의 CSS 변수가 처리한다.
 *
 * 흡수 대상 (향후 wave에서 호출처 치환):
 *   - .mini-badge .badge-{spike,loop,slow,error,cache}  — render/badges.js anomalyBadgesHtml
 *   - .type-badge .type-{prompt,tool_call,system,response,unknown} — render/badges.js typeBadge
 *   - .mini-badge .badge-error                          — render/badges.js toolStatusBadge
 *
 * 의존:
 *   - formatters.js#escHtml — XSS 방어용 HTML 이스케이프
 *   - badge.css / design-tokens.css — .ds-badge[data-tone] 스타일
 *
 * 향후 위임 호출처:
 *   - render/badges.js :: anomalyBadgesHtml  → renderBadge({ tone: 'warn'|'info'|'error', … })
 *   - render/badges.js :: typeBadge          → renderBadge({ tone: <mapped>, … })
 *   - render/badges.js :: toolStatusBadge    → renderBadge({ tone: 'error', … })
 */

import { escHtml } from '../../formatters.js';

/**
 * 상태 배지 HTML 문자열을 반환한다.
 *
 * @param {object}  opts
 * @param {'error'|'warn'|'info'|'success'|'brand'|'neutral'} [opts.tone='neutral']
 *   배지의 의미론적 색조.
 * @param {string}  opts.label       표시할 텍스트. escHtml로 자동 이스케이프된다.
 * @param {string}  [opts.icon]      SVG HTML 문자열 (svgError/svgWarn 등 결과를 그대로 전달).
 *                                   icon과 iconText 둘 다 있으면 icon이 우선 적용된다.
 * @param {string}  [opts.iconText]  단순 글리프(↑ ↻ ◷ ✗ 등). icon이 없을 때 사용된다.
 * @param {string}  [opts.ariaLabel] aria-label 속성. 없으면 label 값으로 자동 설정된다.
 * @returns {string} .ds-badge span HTML 문자열
 *
 * @example
 * // 이상 탐지 배지
 * renderBadge({ tone: 'warn', iconText: '↑', label: 'spike' })
 * // → '<span class="ds-badge" data-tone="warn" aria-label="spike">↑spike</span>'
 *
 * @example
 * // 오류 배지 (SVG 아이콘)
 * renderBadge({ tone: 'error', icon: svgErrorHtml, label: '오류' })
 */
export function renderBadge({ tone = 'neutral', label, icon, iconText, ariaLabel }: { tone?: string; label: string; icon?: string; iconText?: string; ariaLabel?: string }) {
  const safeLabel    = escHtml(label ?? '');
  const safeAria     = escHtml(ariaLabel ?? label ?? '');
  const ariaAttr     = safeAria ? ` aria-label="${safeAria}"` : '';
  const iconFragment = icon
    ? icon                              // SVG HTML 문자열 (이미 안전하다고 가정)
    : iconText
      ? escHtml(iconText)               // 단순 글리프는 이스케이프
      : '';

  return `<span class="ds-badge" data-tone="${escHtml(tone)}"${ariaAttr}>${iconFragment}${safeLabel}</span>`;
}
