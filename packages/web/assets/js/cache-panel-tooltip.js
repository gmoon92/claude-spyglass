// Cache Intelligence Panel 섹션 hover 툴팁 — stat-tooltip.js 패턴 동일
const CACHE_PANEL_TOOLTIP_CONTENT = {
  'hit-rate': {
    title: 'Cache Hit Rate',
    desc:  '전체 입력 토큰 중 프롬프트 캐시에서 읽힌 비율.\n70% 이상: green · 30~69%: orange · 30% 미만: red.',
  },
  cost: {
    title: 'Cost Breakdown',
    desc:  'without cache: 캐시 없이 전량 입력으로 처리했을 경우의 예상 비용.\nactual cost: 캐시 적용 후 실제 청구 비용.\nsaved: 캐시로 절약된 금액과 절약률.',
  },
  ratio: {
    title: 'Creation / Read Ratio',
    desc:  '캐시 토큰의 Write(초기 생성) vs Read(재사용) 비율.\nstable: Read ≥ 70% — 캐시가 잘 재사용되고 있음.\nbuilding: Read < 70% — 캐시를 채우는 중.',
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
    const el = e.target.closest('[data-cache-panel-tooltip]');
    if (!el) return;
    show(e, el.dataset.cachePanelTooltip);
  });

  document.addEventListener('mousemove', e => {
    if (tooltip.style.display === 'none') return;
    if (!e.target.closest('[data-cache-panel-tooltip]')) { hide(); return; }
    position(e);
  });

  document.addEventListener('mouseout', e => {
    if (!e.target.closest('[data-cache-panel-tooltip]')) return;
    hide();
  });
}
