// Cache Intelligence Panel 렌더러

function fmt2(n) {
  return `$${Number(n).toFixed(2)}`;
}

export function renderCachePanel(data) {
  if (!data) return;

  const { hitRate, cacheReadTokens, cacheCreationTokens,
          costWithCache, costWithoutCache, savingsUsd, savingsRate } = data;

  // Hit Rate 바
  const pct    = Math.round((hitRate ?? 0) * 100);
  const fill   = document.getElementById('cacheHitFill');
  const pctEl  = document.getElementById('cacheHitPct');
  if (fill) {
    fill.style.width = `${pct}%`;
    fill.className   = 'cache-bar-fill ' + (pct >= 70 ? 'is-high' : pct >= 30 ? 'is-mid' : 'is-low');
  }
  if (pctEl) pctEl.textContent = `${pct}%`;

  // 비용 비교
  const elWithout = document.getElementById('cacheCostWithout');
  const elActual  = document.getElementById('cacheCostActual');
  const elSaved   = document.getElementById('cacheCostSaved');
  if (elWithout) elWithout.textContent = fmt2(costWithoutCache ?? 0);
  if (elActual)  elActual.textContent  = fmt2(costWithCache ?? 0);
  if (elSaved) {
    const rate = Math.round((savingsRate ?? 0) * 100);
    elSaved.textContent = `${fmt2(savingsUsd ?? 0)} (${rate}%)`;
  }

  // Creation vs Read 비율 바
  const total      = (cacheCreationTokens ?? 0) + (cacheReadTokens ?? 0);
  const createPct  = total > 0 ? Math.round((cacheCreationTokens / total) * 100) : 0;
  const readPct    = 100 - createPct;
  const createEl   = document.getElementById('cacheRatioCreate');
  const readEl     = document.getElementById('cacheRatioRead');
  const labelEl    = document.getElementById('cacheRatioLabel');
  if (createEl) createEl.style.width = `${createPct}%`;
  if (readEl)   readEl.style.width   = `${readPct}%`;
  if (labelEl)  labelEl.textContent  = readPct >= 70 ? 'stable' : 'building';
}
