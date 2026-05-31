/**
 * features/dashboard/cache-stats.ts — Cache Intelligence Panel 순수 로직 (P3-09)
 *
 * 원본: assets/js/cache-panel.js.
 *  - computeSessionCacheStats: 세션 내 모든 LLM 호출 합산 hit-rate(서버 aggregate-cache.ts SSoT). 순수.
 *  - renderCachePanel 의 "표시 산술"(hit% 라벨 경계 >99/<1, 톤 클래스, creation/read 비율)을
 *    뷰모델로 추출한다(원본은 getElementById+style.width 직접 변형 → CachePanel.tsx 가 JSX 로).
 *
 * @module features/dashboard/cache-stats
 */

/** 세션 요청 1건(필요 필드만). 원본 _detailAllRequests 항목. */
export interface CacheRequestLike {
  event_type?: string;
  type?: string;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
  tokens_input?: number;
}

/** renderCachePanel 입력 형태. */
export interface CacheStats {
  hitRate: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalInputTokens: number;
}

/**
 * 세션 cache stats — prompt/tool_call/response 합산(pre_tool 제외).
 * 분모 = input + cache_read + cache_creation. 서버 getCacheStats 와 동일 SSoT.
 * (원본 cache-panel.js:123 그대로 — byte 동치)
 */
export function computeSessionCacheStats(
  requests: ReadonlyArray<CacheRequestLike> | null | undefined,
): CacheStats {
  let cacheRead = 0;
  let cacheCreate = 0;
  let input = 0;
  for (const r of requests || []) {
    if (r.event_type === 'pre_tool') continue;
    if (r.type !== 'prompt' && r.type !== 'tool_call' && r.type !== 'response') continue;
    cacheRead += r.cache_read_tokens || 0;
    cacheCreate += r.cache_creation_tokens || 0;
    input += r.tokens_input || 0;
  }
  const denom = input + cacheRead + cacheCreate;
  const hitRate = denom > 0 ? cacheRead / denom : 0;
  return {
    hitRate,
    cacheReadTokens: cacheRead,
    cacheCreationTokens: cacheCreate,
    totalInputTokens: input,
  };
}

/** Hit Rate 바 뷰모델(원본 renderCachePanel hit-rate 산술 SSoT). */
export interface HitRateView {
  /** bar fill width %(Math.round — 시각). */
  pct: number;
  /** 라벨 텍스트: >99%(99<pct<100) / <1%(0<pct<1) / `${pct}%`. */
  labelText: string;
  /** 정밀 값(툴팁 pct: pctExact.toFixed(2)). */
  pctExact: number;
  /** 레거시 톤 클래스(is-high/is-mid/is-low). */
  legacyToneCls: string;
  /** ds 톤(success/warn/error). */
  dsTone: string;
}

/**
 * hit_rate(0..1) → 바 뷰모델.
 * 경계 어휘(hit-rate-precision): 99<pctExact<100 → '>99%', 0<pctExact<1 → '<1%'.
 * 톤: pct≥70 high/success, ≥30 mid/warn, else low/error.
 */
export function computeHitRateView(hitRate: number | null | undefined): HitRateView {
  const rateRaw = hitRate ?? 0;
  const pctExact = rateRaw * 100;
  const pct = Math.round(pctExact);
  const isNearCeiling = pctExact > 99 && pctExact < 100;
  const isNearFloor = pctExact > 0 && pctExact < 1;
  const labelText = isNearCeiling ? '>99%' : isNearFloor ? '<1%' : `${pct}%`;
  const legacyToneCls = pct >= 70 ? 'is-high' : pct >= 30 ? 'is-mid' : 'is-low';
  const dsTone = pct >= 70 ? 'success' : pct >= 30 ? 'warn' : 'error';
  return { pct, labelText, pctExact, legacyToneCls, dsTone };
}

/** Creation vs Read 비율 뷰모델. */
export interface RatioView {
  createPct: number;
  readPct: number;
  /** readPct≥70 ? 'stable' : 'building'(원본 labelEl 텍스트). */
  ratioLabel: string;
}

/** creation/read 토큰 → 비율(%) + 라벨. total=0 → create 0 / read 100. */
export function computeRatioView(
  cacheCreationTokens: number,
  cacheReadTokens: number,
): RatioView {
  const total = cacheCreationTokens + cacheReadTokens;
  const createPct = total > 0 ? Math.round((cacheCreationTokens / total) * 100) : 0;
  const readPct = 100 - createPct;
  return { createPct, readPct, ratioLabel: readPct >= 70 ? 'stable' : 'building' };
}
