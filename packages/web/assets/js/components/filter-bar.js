// filter-bar.js — 타입 필터 버튼 바 컴포넌트

const FILTER_GROUPS = [
  {
    group: 'all',
    items: [{ key: 'all', label: 'All', defaultActive: true }],
  },
  {
    group: 'request',
    ariaLabel: '요청 종류',
    items: [
      { key: 'prompt',    label: 'prompt',    title: '사용자 입력(LLM 추론 요청)만 표시' },
      { key: 'system',    label: 'system',    title: '시스템 메시지(컨텍스트 주입 등)만 표시' },
    ],
  },
  {
    group: 'tool',
    ariaLabel: '도구 분류',
    items: [
      { key: 'tool_call', label: 'tool_call', title: '도구 실행 요청(Read/Write/Bash 등)만 표시' },
      { key: 'agent',     label: 'Agent',     title: 'Agent 도구 실행만 표시' },
      { key: 'skill',     label: 'Skill',     title: 'Skill 도구 실행만 표시' },
      { key: 'mcp',       label: 'MCP',       title: 'MCP 도구 실행만 표시' },
    ],
  },
];

/**
 * @param {string} containerId
 * @param {{ dataAttr: string, onChange: (filter: string) => void }} opts
 * @returns {{ setActive: (filter: string) => void, buttons: () => NodeList }}
 */
export function createFilterBar(containerId, { dataAttr, onChange }) {
  const container = document.getElementById(containerId);

  container.innerHTML = FILTER_GROUPS.map(g => {
    const ariaAttr = g.ariaLabel ? ` aria-label="${g.ariaLabel}"` : '';
    const btns = g.items.map(item => {
      const active = item.defaultActive ? ' active' : '';
      const title  = item.title ? ` title="${item.title}"` : '';
      return `<button class="type-filter-btn type-filter-${item.key}${active}" data-${dataAttr}="${item.key}"${title}>${item.label}</button>`;
    }).join('');
    return `<div class="filter-group filter-group--${g.group}"${ariaAttr}>${btns}</div>`;
  }).join('');

  container.addEventListener('click', e => {
    const btn = e.target.closest(`[data-${dataAttr}]`);
    if (!btn) return;
    const filter = btn.dataset[dataAttr.replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
    container.querySelectorAll('.type-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    onChange(filter);
  });

  return {
    setActive(filter) {
      container.querySelectorAll('.type-filter-btn').forEach(b => {
        const val = b.dataset[dataAttr.replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
        b.classList.toggle('active', val === filter);
      });
    },
    buttons() {
      return container.querySelectorAll('.type-filter-btn');
    },
  };
}
