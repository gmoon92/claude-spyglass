// Cache Intelligence Panel 렌더러 (Hit Rate + Creation/Read 비율)
//
// 비용/USD 표시는 옵저빌리티 신뢰도 정책상 제거됨. 토큰은 페이로드에서 받은 실측이지만
// USD는 계산값이라 오해 소지가 있어 노출하지 않는다.

/**
 * 첫 호출 시 skeleton 표지 제거 (stats-aggregation T-11).
 *
 * init() → fetchCacheStats() resolve 전까지 #cacheHitFill width:0% / #cacheHitPct '--'가
 * 잠깐 노출되던 깜빡임을 제거. index.html 초기 마크업은 data-skeleton="1" + .sk 자식으로
 * 시작하므로, 첫 fetch 응답이 도착하는 이 시점에 표지를 제거하고 실제 값/width로 자연 전환.
 * 멱등 — 두 번째 호출부터는 querySelectorAll이 빈 NodeList라 no-op.
 */
function dismissCachePanelSkeleton() {
  const panel = document.getElementById('cachePanel');
  if (!panel) return;
  // 각 skeleton 표지 + 그 안의 .sk 자식 한 번에 제거
  panel.querySelectorAll('[data-skeleton]').forEach(el => {
    el.querySelectorAll('.sk').forEach(s => s.remove());
    el.removeAttribute('data-skeleton');
  });
  // 실제 bar fill 요소들의 [hidden] 해제 — 0% width로 시작하지만 곧 renderCachePanel가
  // 실제 값으로 갱신. CSS transition 0.6s ease가 0→실제값 매끄러운 진입을 담당.
  ['cacheHitFill', 'cacheRatioCreate', 'cacheRatioRead'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.hidden = false;
  });
}

export function renderCachePanel(data: any) {
  if (!data) return;
  dismissCachePanelSkeleton();

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
    fill.title          = window.I18n.t('ui.cache-panel.precision-tooltip', { pct: pctExact.toFixed(2) });
  }
  if (pctEl) {
    pctEl.textContent = labelText;
    pctEl.title       = window.I18n.t('ui.cache-panel.precision-tooltip', { pct: pctExact.toFixed(2) });
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
    // ADR-cache-panel-color-system-001 (2026-05-17): data-tone 의미 토큰화.
    // 이전: data-tone="info" (--grad-info: blue→teal 그라데이션) — read의 --grad-success와
    // 종착점(teal)이 같아 인접 경계가 흐릿했음.
    // 현재: cache-panel.css 의 .cache-ratio-creation 직접 룰이 --cache-creation-color (violet
    // 솔리드) + --cache-creation-glow 를 적용. data-tone 은 의미 표지("creation")로만 유지.
    createEl.classList.add('ds-bar-fill');
    createEl.dataset.tone = 'creation';
  }
  if (readEl) {
    readEl.style.width = `${readPct}%`;
    // 이중 클래스: 기존 cache-ratio-read 보존 + ds-bar-fill + data-tone="read" (의미 표지).
    // 실제 색상은 cache-panel.css 의 .cache-ratio-read 직접 룰(--cache-read-color, emerald)이 적용.
    readEl.classList.add('ds-bar-fill');
    readEl.dataset.tone = 'read';
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
export function computeSessionCacheStats(requests: any) {
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

