// search-box.js — 검색 박스 컴포넌트

/**
 * @param {string} containerId
 * @param {{ placeholder?: string, onSearch: (query: string) => void }} opts
 * @returns {{ getValue: () => string, clear: () => void, focus: () => void, element: () => HTMLInputElement }}
 */
export function createSearchBox(containerId, { placeholder = '', onSearch }) {
  const container = document.getElementById(containerId);

  container.innerHTML = `
    <span class="feed-search-icon">⌕</span>
    <input class="feed-search-input" type="text" placeholder="${placeholder}" autocomplete="off" />
    <button class="feed-search-clear" aria-label="검색어 지우기">×</button>
  `.trim();

  const input = container.querySelector('.feed-search-input');
  const clear = container.querySelector('.feed-search-clear');

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
