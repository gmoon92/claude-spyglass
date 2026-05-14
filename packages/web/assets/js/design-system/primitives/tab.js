/**
 * @module primitives/tab
 *
 * 책임: 탭 버튼 단일 원시 컴포넌트.
 *       selected 여부에 따라 accent 색상 + 하단 보더 강조 + font-weight 600을 가진
 *       <button role="tab" aria-selected> HTML 문자열을 생성한다.
 *       상단 텍스트는 uppercase + letter-spacing으로 표시하며,
 *       선택 상태 전환은 CSS 단독으로 처리한다(JS로 클래스를 별도로 토글할 필요 없음).
 *
 * 흡수 대상 (다음 wave에서 호출처 치환):
 *   - detail-view.css / 관련 JS: .view-tab.active (프로젝트/세션 디테일 탭)
 *   - meta-docs.css / meta-docs-view.js: .meta-tab.active (메타 문서 탭)
 *
 * 의존:
 *   - packages/web/assets/js/formatters.js (escHtml — XSS 방지용 label 이스케이프)
 *   - packages/web/assets/css/design-system/primitives/tab.css (스타일)
 *   - design-tokens.css: --text-3, --accent, --space-2, --space-3, --dur-fast, --ease
 *
 * 향후 치환 호출처:
 *   - 관련 JS L*: `.view-tab` 생성부 → renderTab({ value: '...', label: '...', selected: ... })
 *   - meta-docs-view.js L*: `.meta-tab` 생성부 → renderTab({ value: '...', label: '...', selected: ... })
 */

import { escHtml } from '../../formatters.js';

/**
 * 탭 버튼 HTML 문자열을 생성한다.
 *
 * @param {object}  opts
 * @param {string}  opts.label              - 탭 레이블 텍스트 (escHtml 처리됨)
 * @param {boolean} [opts.selected=false]   - 선택 상태 여부 (aria-selected 값)
 * @param {string}  [opts.value]            - data-tab-value 속성값 (탭 식별자, 선택적)
 * @returns {string} HTML 문자열
 *
 * @example
 * renderTab({ label: 'Sessions', selected: true, value: 'sessions' })
 * // => '<button class="ds-tab" type="button" role="tab" aria-selected="true" data-tab-value="sessions">Sessions</button>'
 *
 * @example
 * renderTab({ label: 'Overview', selected: false })
 * // => '<button class="ds-tab" type="button" role="tab" aria-selected="false">Overview</button>'
 */
export function renderTab({ label, selected = false, value } = {}) {
  const safeLabel   = escHtml(String(label ?? ''));
  const isSelected  = selected ? 'true' : 'false';
  const valueAttr   = value !== undefined ? ` data-tab-value="${escHtml(String(value))}"` : '';

  return `<button class="ds-tab" type="button" role="tab" aria-selected="${isSelected}"${valueAttr}>${safeLabel}</button>`;
}
