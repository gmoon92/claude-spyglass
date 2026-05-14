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
 * 세션 단위 cache stats 계산 — 모든 LLM API 호출 합산 (cache-stats-scope pass).
 *
 * 이전엔 `type='prompt'` 한정이라 도구 사이클의 수십~수백 API 호출이 빠지고
 * 사용자 발화 단위의 첫 호출만 보여 cache_read의 약 95%가 분모에서 누락됐다.
 * Anthropic API는 매 호출마다 input/cache_read/cache_create 토큰을 보고하므로
 * "비용 절감 가시화"라는 spyglass 목적에 맞추려면 모든 호출을 합산해야 한다.
 *
 * 포함 범위: prompt + tool_call(event_type='tool') + response.
 * 제외: tool_call(event_type='pre_tool') — 미완성 레코드, 토큰 0.
 *
 * 산식 (observability-true pass):
 *   - 분자: cache_read
 *   - 분모: input + cache_read + cache_creation
 *     이전엔 cache_creation을 분모에서 빼서 "캐시 등록도 비용"이라는 사실이 누락됐다.
 *     새 세션 초반 hit rate가 인위적으로 부풀어 보이는 회귀가 있었으며, 옵저빌리티 의미
 *     ("전체 토큰 비용 중 캐시 처리 비율")가 흐려졌다. cache_creation은 첫 write 비용이
 *     발생하는 토큰이라 분모에 포함해야 정확.
 *
 * 서버 aggregate-cache.ts#getCacheStats와 동일 SSoT.
 *
 * @param {Array} requests — 세션 내 모든 요청 (_detailAllRequests)
 * @returns {Object} renderCachePanel가 받는 형태
 */
export function computeSessionCacheStats(requests) {
  let cacheRead = 0, cacheCreate = 0, input = 0;
  for (const r of requests || []) {
    // pre_tool 행 제외 — PreToolUse는 토큰=0 미완성 레코드.
    if (r.event_type === 'pre_tool') continue;
    // LLM API 호출에 해당하는 행만: prompt / tool_call / response.
    if (r.type !== 'prompt' && r.type !== 'tool_call' && r.type !== 'response') continue;
    cacheRead   += r.cache_read_tokens     || 0;
    cacheCreate += r.cache_creation_tokens || 0;
    input       += r.tokens_input          || 0;
  }
  const denom   = input + cacheRead + cacheCreate;
  const hitRate = denom > 0 ? cacheRead / denom : 0;
  return {
    hitRate,
    cacheReadTokens:     cacheRead,
    cacheCreationTokens: cacheCreate,
    totalInputTokens:    input,
  };
}
