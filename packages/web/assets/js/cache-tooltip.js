// Cache 셀 호버 툴팁 — position: fixed, 뷰포트 충돌 방지
function fmtNum(n) {
  return Number(n).toLocaleString('en-US');
}

export function initCacheTooltip() {
  const tooltip = document.createElement('div');
  tooltip.className = 'cache-tooltip';
  tooltip.style.display = 'none';
  document.body.appendChild(tooltip);

  function show(e, readVal, writeVal) {
    const readTokens  = parseInt(readVal,  10) || 0;
    const writeTokens = parseInt(writeVal, 10) || 0;
    tooltip.innerHTML = `
      <div class="cache-tooltip-title">Prompt Cache</div>
      <div class="cache-tooltip-row">
        <span class="cache-tooltip-label">Read</span>
        <span>
          <span class="cache-tooltip-value read">${fmtNum(readTokens)} tokens</span>
          <span class="cache-tooltip-cost">×0.1 cost</span>
        </span>
      </div>
      ${writeTokens > 0 ? `
      <div class="cache-tooltip-row">
        <span class="cache-tooltip-label">Write</span>
        <span>
          <span class="cache-tooltip-value write">${fmtNum(writeTokens)} tokens</span>
          <span class="cache-tooltip-cost">×1.25 cost</span>
        </span>
      </div>` : ''}
    `;
    tooltip.style.display = 'block';
    position(e);
  }

  function position(e) {
    const tw = tooltip.offsetWidth  || 220;
    const th = tooltip.offsetHeight || 80;
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
    const cell = e.target.closest('.cache-cell');
    if (!cell) return;
    show(e, cell.dataset.cacheRead, cell.dataset.cacheWrite);
  });

  document.addEventListener('mousemove', e => {
    if (tooltip.style.display === 'none') return;
    if (!e.target.closest('.cache-cell')) { hide(); return; }
    position(e);
  });

  document.addEventListener('mouseout', e => {
    if (!e.target.closest('.cache-cell')) return;
    hide();
  });
}
