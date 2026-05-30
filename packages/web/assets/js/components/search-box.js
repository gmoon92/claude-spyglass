// search-box.js — 검색 박스 컴포넌트

import { svgSearch } from '../render/icons.js';
import { renderCloseBtn } from '../design-system/primitives/close-button.js';

/**
 * @param {string} containerId
 * @param {{ placeholder?: string, onSearch: (query: string) => void }} opts
 * @returns {{ getValue: () => string, clear: () => void, focus: () => void, element: () => HTMLInputElement }}
 */
export function createSearchBox(containerId, { placeholder = '', onSearch }) {
  const container = document.getElementById(containerId);

  container.innerHTML = `
    <span class="feed-search-icon">${svgSearch({ size: 14, className: 'feed-search-icon-svg' })}</span>
    <input class="feed-search-input" type="text" placeholder="${placeholder}" autocomplete="off" />
    ${renderCloseBtn({ size: 'sm', label: window.I18n.t('ui.search-box.clear-label'), dataAttrs: { action: 'clear' } }).replace('class="ds-close-btn"', 'class="feed-search-clear ds-close-btn"')}
  `.trim();

  const input = /** @type {HTMLInputElement} */ (container.querySelector('.feed-search-input'));
  const clear = /** @type {HTMLElement} */ (container.querySelector('.feed-search-clear'));

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    clear.classList.toggle('visible', q.length > 0);
    onSearch(q);
  });

  clear.addEventListener('click', () => {
    input.value = '';
    clear.classList.remove('visible');
    onSearch('');
    input.focus();
  });

  return {
    getValue()   { return input.value.trim().toLowerCase(); },
    clear()      { input.value = ''; clear.classList.remove('visible'); onSearch(''); },
    focus()      { input.focus(); input.select?.(); },
    element()    { return input; },
  };
}
