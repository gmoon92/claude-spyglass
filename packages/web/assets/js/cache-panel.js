// Cache Intelligence Panel 렌더러 (ADR-015 — 토큰 단위, ADR-017 — 세션/전역 모드 지원)
import { fmtToken } from './formatters.js';

/**
 * Cache panel 렌더링.
 *
 * @param {Object} data — 전역(서버) or 세션(클라이언트 계산):
 *   { hitRate, cacheReadTokens, cacheCreationTokens, totalInputTokens? }
 */
export function renderCachePanel(data) {
  if (!data) return;

  const {
    hitRate,
    cacheReadTokens     = 0,
    cacheCreationTokens = 0,
    totalInputTokens    = 0,    // 비-캐시 input 토큰 (없으면 0)
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

  // ── ADR-015: 가격($) 대신 토큰 단위 ──
  // no cache  = totalInputTokens + cacheCreationTokens + cacheReadTokens (캐시 없었으면 전부 input)
  // actual    = totalInputTokens + cacheCreationTokens (실제로 LLM에 새로 전달된 토큰)
  // saved     = cacheReadTokens (캐시 read 덕에 LLM 재처리를 회피한 토큰)
  const noCacheTokens = totalInputTokens + cacheCreationTokens + cacheReadTokens;
  const actualTokens  = totalInputTokens + cacheCreationTokens;
  const savedTokens   = cacheReadTokens;
  const savedRate     = noCacheTokens > 0 ? Math.round((savedTokens / noCacheTokens) * 100) : 0;

  const elWithout = document.getElementById('cacheCostWithout');
  const elActual  = document.getElementById('cacheCostActual');
  const elSaved   = document.getElementById('cacheCostSaved');
  if (elWithout) elWithout.textContent = fmtToken(noCacheTokens);
  if (elActual)  elActual.textContent  = fmtToken(actualTokens);
  if (elSaved)   elSaved.textContent   = `${fmtToken(savedTokens)} (${savedRate}%)`;

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
