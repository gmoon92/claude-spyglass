/**
 * @module primitives/close-button
 *
 * 책임: 닫기(×) 버튼 단일 원시 컴포넌트.
 *       size(sm|md|lg) 변형에 따라 적절한 크기와 폰트를 가진 <button> HTML 문자열을 생성한다.
 *       모든 닫기 버튼의 비주얼(배경 없음 → hover 시 surface-alt 배경 + text-1 + border-strong)을
 *       하나의 토큰으로 통일한다.
 *
 * 흡수 대상 (다음 wave에서 호출처 치환):
 *   - search-box.js: feed-search-clear 버튼 (×, 18×18)
 *   - syslib-detail.js / system-prompt-library.js: syslib-detail-close (×, 28×28)
 *   - llm-input-view.js: llm-input-refs-popover-close (×, 22×22)
 *   - llm-input-view.js: llm-input-refs-popover-close
 *   - main.js: kbd-help-close, KBD modal close (×, 30×30)
 *
 * 의존:
 *   - packages/web/assets/css/design-system/primitives/close-button.css (스타일)
 *   - design-tokens.css: --surface-alt, --text-1, --text-3, --border-strong, --dur-fast, --ease
 *
 * 향후 치환 호출처:
 *   - search-box.js L*: `<button class="feed-search-clear"` → renderCloseBtn({ size: 'sm' })
 *   - system-prompt-library.js L*: `<button class="syslib-detail-close"` → renderCloseBtn({ size: 'md' })
 *   - llm-input-view.js L*: `<button class="llm-input-refs-popover-close"` → renderCloseBtn({ size: 'sm' })
 *   - main.js L*: kbd-help-close → renderCloseBtn({ size: 'lg' }), kbd-modal-close → renderCloseBtn({ size: 'lg' })
 */

/**
 * @typedef {'sm' | 'md' | 'lg'} CloseBtnSize
 */

/**
 * 닫기(×) 버튼 HTML 문자열을 생성한다.
 *
 * @param {object}        opts
 * @param {CloseBtnSize}  [opts.size='md']    - 버튼 크기 (sm: 20×20 / md: 24×24 / lg: 30×30)
 * @param {string}        [opts.label='닫기'] - aria-label 텍스트 (접근성)
 * @param {Record<string,string>} [opts.dataAttrs={}] - 추가 data-* 속성 맵 (키: 속성명 접미사, 값: 속성값)
 * @returns {string} HTML 문자열
 *
 * @example
 * renderCloseBtn({ size: 'md' })
 * // => '<button class="ds-close-btn" type="button" data-size="md" aria-label="닫기">×</button>'
 *
 * @example
 * renderCloseBtn({ size: 'sm', label: '검색어 지우기', dataAttrs: { action: 'clear' } })
 * // => '<button class="ds-close-btn" type="button" data-size="sm" aria-label="검색어 지우기" data-action="clear">×</button>'
 */
export function renderCloseBtn({ size = 'md', label = '닫기', dataAttrs = {} } = {}) {
  const safeSize  = ['sm', 'md', 'lg'].includes(size) ? size : 'md';

  const extraAttrs = Object.entries(dataAttrs)
    .map(([k, v]) => ` data-${k}="${String(v).replace(/"/g, '&quot;')}"`)
    .join('');

  return `<button class="ds-close-btn" type="button" data-size="${safeSize}" aria-label="${label.replace(/"/g, '&quot;')}"${extraAttrs}>×</button>`;
}
