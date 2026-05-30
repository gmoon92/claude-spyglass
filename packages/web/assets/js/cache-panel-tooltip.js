// Cache Intelligence Panel 섹션 hover 툴팁 — stat-tooltip.js 패턴 동일
import { asEl } from './dom.js';

const CACHE_PANEL_TOOLTIP_CONTENT = {
  'hit-rate': {
    get title() { return window.I18n.t('ui.cache-panel.hit-rate.title'); },
    get desc()  { return window.I18n.t('ui.cache-panel.hit-rate.desc'); },
  },
  ratio: {
    get title() { return window.I18n.t('ui.cache-panel.ratio.title'); },
    get desc()  { return window.I18n.t('ui.cache-panel.ratio.desc'); },
  },
};

export function initCachePanelTooltip() {
  const tooltip = document.createElement('div');
  tooltip.className = 'stat-tooltip';
  tooltip.style.display = 'none';
  document.body.appendChild(tooltip);

  function show(e, key) {
    const content = CACHE_PANEL_TOOLTIP_CONTENT[key];
    if (!content) return;
    tooltip.innerHTML = `
      <div class="stat-tooltip-title">${content.title}</div>
      <div class="stat-tooltip-desc">${content.desc.replace(/\n/g, '<br>')}</div>
    `;
    tooltip.style.display = 'block';
    position(e);
  }

  function position(e) {
    const tw = tooltip.offsetWidth  || 240;
    const th = tooltip.offsetHeight || 60;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = e.clientX + 8;
    let y = e.clientY + 12;
    if (x + tw > vw) x = e.clientX - tw - 8;
    if (y + th > vh) y = e.clientY - th - 8;
    tooltip.style.left = `${x}px`;
    tooltip.style.top  = `${y}px`;
  }

  function hide() {
    tooltip.style.display = 'none';
  }

  document.addEventListener('mouseover', e => {
    const el = asEl(e.target).closest('[data-cache-panel-tooltip]');
    if (!el) return;
    show(e, asEl(el).dataset.cachePanelTooltip);
  });

  document.addEventListener('mousemove', e => {
    if (tooltip.style.display === 'none') return;
    if (!asEl(e.target).closest('[data-cache-panel-tooltip]')) { hide(); return; }
    position(e);
  });

  document.addEventListener('mouseout', e => {
    if (!asEl(e.target).closest('[data-cache-panel-tooltip]')) return;
    hide();
  });
}
