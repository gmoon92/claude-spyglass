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
  // hit-rate-precision pass: Math.round 단독 사용은 99.5%를 100%로 반올림하여
  // "비현실적으로 보이는 100%" 인지 부담을 만든다 (Claude Code 패턴 상 99%+가 정상).
  //   - bar fill width는 round 그대로 유지 (시각적 미세 차이는 의미 없음)
  //   - 라벨은 99 < pct < 100 구간은 ">99%" boundary 어휘로 표시해 반올림 정보 손실 명시
  //   - 그 외는 정수 % (3자리 라벨 폭 유지)
  const rateRaw = hitRate ?? 0;
  const pctExact = rateRaw * 100;
  const pct      = Math.round(pctExact);
  const isNearCeiling = pctExact > 99 && pctExact < 100;
  const isNearFloor   = pctExact > 0  && pctExact < 1;
  const labelText = isNearCeiling ? '>99%'
                   : isNearFloor   ? '<1%'
                   : `${pct}%`;
  const fill   = document.getElementById('cacheHitFill');
  const pctEl  = document.getElementById('cacheHitPct');
  if (fill) {
    fill.style.width = `${pct}%`;
    // 이중 클래스: 기존 cache-bar-fill + is-high/is-mid/is-low 보존,
    // ds-bar-fill + data-tone 추가 (is-high→success, is-mid→warn, is-low→error)
    const legacyToneCls = pct >= 70 ? 'is-high' : pct >= 30 ? 'is-mid' : 'is-low';
    const dsTone        = pct >= 70 ? 'success'  : pct >= 30 ? 'warn'   : 'error';
    fill.className      = `cache-bar-fill ${legacyToneCls} ds-bar-fill`;
    fill.dataset.tone   = dsTone;
    // 정밀 값을 tooltip으로 노출해 호버 시 정확한 수치 확인 가능.
    fill.title          = `${pctExact.toFixed(2)}% (정밀)`;
  }
  if (pctEl) {
    pctEl.textContent = labelText;
    pctEl.title       = `${pctExact.toFixed(2)}% (정밀)`;
  }

  // Creation vs Read 비율 바
  const total      = cacheCreationTokens + cacheReadTokens;
  const createPct  = total > 0 ? Math.round((cacheCreationTokens / total) * 100) : 0;
  const readPct    = 100 - createPct;
  const createEl   = document.getElementById('cacheRatioCreate');
  const readEl     = document.getElementById('cacheRatioRead');
  const labelEl    = document.getElementById('cacheRatioLabel');
  if (createEl) {
    createEl.style.width = `${createPct}%`;
    // 이중 클래스: 기존 cache-ratio-creation 보존 + ds-bar-fill + data-tone="info"
    createEl.classList.add('ds-bar-fill');
    createEl.dataset.tone = 'info';
  }
  if (readEl) {
    readEl.style.width = `${readPct}%`;
    // 이중 클래스: 기존 cache-ratio-read 보존 + ds-bar-fill + data-tone="success"
    readEl.classList.add('ds-bar-fill');
    readEl.dataset.tone = 'success';
  }
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
