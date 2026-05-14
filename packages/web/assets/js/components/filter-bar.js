// filter-bar.js — 타입 필터 버튼 바 컴포넌트

import { renderFilterBtn } from '../design-system/primitives/filter-button.js';

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
      const isActive = !!item.defaultActive;
      const title    = item.title ? ` title="${item.title}"` : '';
      const base     = renderFilterBtn({ label: item.label, active: isActive, strength: 'soft', value: item.key });
      // ds-filter-btn 클래스에 기존 type-filter-btn + type-filter-{key} + active(조건부) 클래스를 이중으로 추가
      const activeCls = isActive ? ' active' : '';
      // 첫 번째 '>' 교체: <button ...> 오프닝 태그 끝에 data-* 속성 삽입
      return base
        .replace('class="ds-filter-btn"', `class="ds-filter-btn type-filter-btn type-filter-${item.key}${activeCls}"`)
        .replace('>', ` data-${dataAttr}="${item.key}"${title}>`);
    }).join('');
    return `<div class="filter-group filter-group--${g.group}"${ariaAttr}>${btns}</div>`;
  }).join('');

  container.addEventListener('click', e => {
    const btn = e.target.closest(`[data-${dataAttr}]`);
    if (!btn) return;
    const filter = btn.dataset[dataAttr.replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
    // ds-filter-btn 활성 시각은 [aria-pressed="true"]로 결정되므로 .active 클래스와 함께 동기화.
    container.querySelectorAll('.type-filter-btn').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
    onChange(filter);
  });

  return {
    setActive(filter) {
      container.querySelectorAll('.type-filter-btn').forEach(b => {
        const val = b.dataset[dataAttr.replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
        const isActive = val === filter;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    },
    buttons() {
      return container.querySelectorAll('.type-filter-btn');
    },
  };
}
