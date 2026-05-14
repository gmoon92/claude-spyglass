/**
 * @module primitives/filter-button
 *
 * 책임: 필터 버튼 단일 원시 컴포넌트.
 *       active 여부와 strength(soft|strong)에 따라 두 가지 강조 스타일을 가진
 *       <button aria-pressed> HTML 문자열을 생성한다.
 *       - soft(기본):  active 시 accent-bg-medium + text-1 + accent 테두리 (은은한 강조)
 *       - strong:      active 시 accent 배경 + #fff 텍스트 (전체 채움 강조)
 *
 * 흡수 대상 (다음 wave에서 호출처 치환):
 *   - default-view.css / default-view.js: .type-filter-btn.active (soft 계열)
 *   - meta-docs.css / meta-docs-view.js:  .meta-doc-filter-btn.active (strong 계열)
 *   - index.html: .filter-btn.active (날짜 필터, soft 계열)
 *
 * 의존:
 *   - packages/web/assets/js/formatters.js (escHtml — XSS 방지용 label 이스케이프)
 *   - packages/web/assets/css/design-system/primitives/filter-button.css (스타일)
 *   - design-tokens.css: --surface, --border, --text-3, --text-1, --accent-bg-medium,
 *                         --accent-border, --accent, --border-strong, --radius-md,
 *                         --space-1, --space-3, --dur-fast, --ease
 *
 * 향후 치환 호출처:
 *   - default-view.js L*: `.type-filter-btn` 생성부 → renderFilterBtn({ strength: 'soft', ... })
 *   - meta-docs-view.js L*: `.meta-doc-filter-btn` 생성부 → renderFilterBtn({ strength: 'strong', ... })
 *   - index.html L*: `.filter-btn` 인라인 HTML → renderFilterBtn({ strength: 'soft', ... })
 */

import { escHtml } from '../../formatters.js';

/**
 * @typedef {'soft' | 'strong'} FilterStrength
 */

/**
 * 필터 버튼 HTML 문자열을 생성한다.
 *
 * @param {object}          opts
 * @param {string}          opts.label              - 버튼 레이블 텍스트 (escHtml 처리됨)
 * @param {boolean}         [opts.active=false]     - 활성 상태 여부 (aria-pressed 값)
 * @param {FilterStrength}  [opts.strength='soft']  - 활성 강조 강도 (soft: 은은한 / strong: 전체 채움)
 * @param {string}          [opts.value]            - data-value 속성값 (필터 식별자, 선택적)
 * @returns {string} HTML 문자열
 *
 * @example
 * renderFilterBtn({ label: '전체', active: true, strength: 'soft', value: 'all' })
 * // => '<button class="ds-filter-btn" type="button" aria-pressed="true" data-strength="soft" data-value="all">전체</button>'
 *
 * @example
 * renderFilterBtn({ label: 'Skill', active: false, strength: 'strong' })
 * // => '<button class="ds-filter-btn" type="button" aria-pressed="false" data-strength="strong">Skill</button>'
 */
export function renderFilterBtn({ label, active = false, strength = 'soft', value } = {}) {
  const safeLabel    = escHtml(String(label ?? ''));
  const safeStrength = ['soft', 'strong'].includes(strength) ? strength : 'soft';
  const pressed      = active ? 'true' : 'false';
  const valueAttr    = value !== undefined ? ` data-value="${escHtml(String(value))}"` : '';

  return `<button class="ds-filter-btn" type="button" aria-pressed="${pressed}" data-strength="${safeStrength}"${valueAttr}>${safeLabel}</button>`;
}
