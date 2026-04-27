// 메트릭 API fetch 래퍼.
// 모든 엔드포인트는 /api/metrics/* 하위. 공통 envelope { success, data, meta }.
//
// 변경 이력:
// - header-summary-merge ADR-002: Insights 카드 제거에 따라 5종 fetcher 제거
//   (fetchContextUsage / fetchActivityHeatmap / fetchTurnDistribution / fetchAgentDepth / fetchAnomaliesTimeseries).
//   서버 엔드포인트는 향후 재사용 여지로 유지.

const BASE = '';

/**
 * 공통 query string 생성. range / from / to / bucket 지원.
 * @param {Object} params { range?, from?, to?, bucket? }
 * @returns {string} `?key=val&...` (키 없으면 빈 문자열)
 */
function qs(params = {}) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

/**
 * fetch + envelope unwrap. 실패 시 빈 객체 또는 빈 배열 반환.
 */
async function getMetric(path, params = {}, fallback = null) {
  try {
    const res  = await fetch(`${BASE}${path}${qs(params)}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'metric error');
    return json.data;
  } catch {
    return fallback;
  }
}

// ── 1. 모델 사용량 비율 (Donut) ────────────────────────────────────────
export function fetchModelUsage(params = {}) {
  return getMetric('/api/metrics/model-usage', params, []);
}

// ── 2. (제거됨 — ADR-008) 모델별 캐시 적중률 매트릭스 ──
// fetchCacheMatrix는 cache-mode-toggle 폐기와 함께 제거됨.
// 서버 endpoint `/api/metrics/cache-matrix`는 다른 도구 재사용을 위해 유지.

// ── 3. Tool 카테고리 분포 ──────────────────────────────────────────
export function fetchToolCategories(params = {}) {
  return getMetric('/api/metrics/tool-categories', params, []);
}
