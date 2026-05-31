// filter-bar.js — 타입 필터 버튼 바 컴포넌트

import { renderFilterBtn } from '../design-system/primitives/filter-button.js';
import { asEl } from '../dom.js';

/** i18n 준비 후 호출 시점에 평가되도록 함수로 정의 */
function getFilterGroups() {
  const t = (key) => window.I18n.t(key);
  return [
    {
      group: 'all',
      items: [{ key: 'all', label: t('ui.filter-bar.all'), defaultActive: true }],
    },
    {
      group: 'request',
      ariaLabel: t('ui.filter-bar.request-type'),
      items: [
        { key: 'prompt',    label: t('ui.filter-bar.prompt'),    title: t('ui.filter-bar.prompt-title') },
        { key: 'system',    label: t('ui.filter-bar.system'),    title: t('ui.filter-bar.system-title') },
      ],
    },
    {
      group: 'tool',
      ariaLabel: t('ui.filter-bar.tool-category'),
      items: [
        { key: 'tool_call', label: t('ui.filter-bar.tool-call'), title: t('ui.filter-bar.tool-call-title') },
        { key: 'agent',     label: t('ui.filter-bar.agent'),     title: t('ui.filter-bar.agent-title') },
        { key: 'skill',     label: t('ui.filter-bar.skill'),     title: t('ui.filter-bar.skill-title') },
        { key: 'mcp',       label: t('ui.filter-bar.mcp'),       title: t('ui.filter-bar.mcp-title') },
      ],
    },
  ];
}

/**
 * @param {string} containerId
 * @param {{ dataAttr: string, onChange: (filter: string) => void }} opts
 * @returns {{ setActive: (filter: string) => void, buttons: () => NodeList }}
 */
export function createFilterBar(containerId, { dataAttr, onChange }) {
  const container = document.getElementById(containerId);

  container.innerHTML = getFilterGroups().map(g => {
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
    const btn = asEl(e.target).closest(`[data-${dataAttr}]`);
    if (!btn) return;
    const filter = asEl(btn).dataset[dataAttr.replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
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
        const val = asEl(b).dataset[dataAttr.replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
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
