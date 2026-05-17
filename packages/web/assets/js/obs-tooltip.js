/**
 * Observability Panel hover 툴팁
 *
 * left-panel-observability-revamp ADR-008 (후속):
 *   카드 라벨/패널 타이틀을 제거한 대신 KPI의 의미를 hover 툴팁으로 노출.
 *   기존 stat-tooltip / cache-panel-tooltip 의 디자인·동작 패턴을 그대로 차용
 *   (`.stat-tooltip` 클래스 재사용으로 시각 일관성 유지).
 *
 * 트리거: `data-obs-tooltip="<key>"` 속성. 카드 / Anomaly Badge / 카테고리 행에 부여.
 */

const OBS_TOOLTIP_CONTENT = {
  // ── 카드 4종 ──────────────────────────────────────────────────────────
  'burn-rate': {
    get title() { return window.I18n.t('ui.obs-tooltip.burn-rate.title'); },
    get desc()  { return window.I18n.t('ui.obs-tooltip.burn-rate.desc'); },
  },
  'cache-health': {
    get title() { return window.I18n.t('ui.obs-tooltip.cache-health.title'); },
    get desc()  { return window.I18n.t('ui.obs-tooltip.cache-health.desc'); },
  },
  'live-pulse': {
    get title() { return window.I18n.t('ui.obs-tooltip.live-pulse.title'); },
    get desc()  { return window.I18n.t('ui.obs-tooltip.live-pulse.desc'); },
  },
  'tool-categories': {
    get title() { return window.I18n.t('ui.obs-tooltip.tool-categories.title'); },
    get desc()  { return window.I18n.t('ui.obs-tooltip.tool-categories.desc'); },
  },

  // ── 카테고리 행별 ───────────────────────────────────────────────────
  'cat-Agent': {
    get title() { return window.I18n.t('ui.obs-tooltip.cat-Agent.title'); },
    get desc()  { return window.I18n.t('ui.obs-tooltip.cat-Agent.desc'); },
  },
  'cat-Skill': {
    get title() { return window.I18n.t('ui.obs-tooltip.cat-Skill.title'); },
    get desc()  { return window.I18n.t('ui.obs-tooltip.cat-Skill.desc'); },
  },
  'cat-MCP': {
    get title() { return window.I18n.t('ui.obs-tooltip.cat-MCP.title'); },
    get desc()  { return window.I18n.t('ui.obs-tooltip.cat-MCP.desc'); },
  },
  'cat-Native': {
    get title() { return window.I18n.t('ui.obs-tooltip.cat-Native.title'); },
    get desc()  { return window.I18n.t('ui.obs-tooltip.cat-Native.desc'); },
  },

  // ── Anomaly Badge ───────────────────────────────────────────────────
  anomaly: {
    get title() { return window.I18n.t('ui.obs-tooltip.anomaly.title'); },
    get desc()  { return window.I18n.t('ui.obs-tooltip.anomaly.desc'); },
  },
};

export function initObsTooltip() {
  // stat-tooltip.js 와 동일한 .stat-tooltip 클래스를 재사용해 시각 일관성 유지
  const tooltip = document.createElement('div');
  tooltip.className = 'stat-tooltip';
  tooltip.style.display = 'none';
  document.body.appendChild(tooltip);

  function show(e, key) {
    const content = OBS_TOOLTIP_CONTENT[key];
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
    const el = e.target.closest('[data-obs-tooltip]');
    if (!el) return;
    show(e, el.dataset.obsTooltip);
  });

  document.addEventListener('mousemove', e => {
    if (tooltip.style.display === 'none') return;
    if (!e.target.closest('[data-obs-tooltip]')) { hide(); return; }
    position(e);
  });

  document.addEventListener('mouseout', e => {
    if (!e.target.closest('[data-obs-tooltip]')) return;
    hide();
  });
}
