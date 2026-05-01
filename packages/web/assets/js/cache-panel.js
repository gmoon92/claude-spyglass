// Cache Intelligence Panel 렌더러 (Hit Rate + Creation/Read 비율)
//
// 비용/USD 표시는 옵저빌리티 신뢰도 정책상 제거됨. 토큰은 페이로드에서 받은 실측이지만
// USD는 계산값이라 오해 소지가 있어 노출하지 않는다.

export function renderCachePanel(data) {
  if (!data) return;

  const {
    hitRate,
    cacheReadTokens     = 0,
    cacheCreationTokens = 0,
  } = data;

  // Hit Rate 바
  const pct    = Math.round((hitRate ?? 0) * 100);
  const fill   = document.getElementById('cacheHitFill');
  const pctEl  = document.getElementById('cacheHitPct');
  if (fill) {
    fill.style.width = `${pct}%`;
    fill.className   = 'cache-bar-fill ' + (pct >= 70 ? 'is-high' : pct >= 30 ? 'is-mid' : 'is-low');
  }
  if (pctEl) pctEl.textContent = `${pct}%`;

  // Creation vs Read 비율 바
  const total      = cacheCreationTokens + cacheReadTokens;
  const createPct  = total > 0 ? Math.round((cacheCreationTokens / total) * 100) : 0;
  const readPct    = 100 - createPct;
  const createEl   = document.getElementById('cacheRatioCreate');
  const readEl     = document.getElementById('cacheRatioRead');
  const labelEl    = document.getElementById('cacheRatioLabel');
  if (createEl) createEl.style.width = `${createPct}%`;
  if (readEl)   readEl.style.width   = `${readPct}%`;
  if (labelEl)  labelEl.textContent  = readPct >= 70 ? 'stable' : 'building';
}

/**
 * ADR-017: 세션 단위 cache stats 계산 (요청 배열 → renderCachePanel 데이터 형태).
 * @param {Array} requests — 세션 내 prompt 요청 (_detailAllRequests)
 * @returns {Object} renderCachePanel가 받는 형태
 */
export function computeSessionCacheStats(requests) {
  let cacheRead = 0, cacheCreate = 0, input = 0;
  for (const r of requests || []) {
    if (r.type !== 'prompt') continue;
    cacheRead   += r.cache_read_tokens     || 0;
    cacheCreate += r.cache_creation_tokens || 0;
    input       += r.tokens_input          || 0;
  }
  const denom   = input + cacheRead;
  const hitRate = denom > 0 ? cacheRead / denom : 0;
  return {
    hitRate,
    cacheReadTokens:     cacheRead,
    cacheCreationTokens: cacheCreate,
    totalInputTokens:    input,
  };
}
