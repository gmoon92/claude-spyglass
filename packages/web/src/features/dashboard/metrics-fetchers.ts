/**
 * features/dashboard/metrics-fetchers.ts — /api/metrics/* fetch 래퍼 (P3-09)
 *
 * 원본: assets/js/metrics-api.js (fetchModelUsage/fetchToolCategories).
 *  - 공통 envelope { success, data, meta } unwrap, 실패 시 안전 폴백.
 *  - P3-03 fetchers.ts 와 동형: fetch → 파싱 → raw data 반환(render/DOM/store 사이드이펙트 0).
 *  - qs 빌더는 range/from/to/bucket 지원(원본과 동일 정책 — null/'' 키 생략).
 *
 * @module features/dashboard/metrics-fetchers
 */

const BASE = '';
const DEFAULT_TIMEOUT_MS = 8000;

/** metrics 공통 query 파라미터(원본 qs 입력). */
export interface MetricParams {
  range?: string;
  from?: number | string;
  to?: number | string;
  bucket?: string;
}

/** range/from/to/bucket → query string(null/'' 키 생략, 원본 qs 동치). */
export function buildMetricQuery(params: MetricParams = {}): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

/**
 * fetch + envelope unwrap. 실패(HTTP/!success/abort) 시 fallback 반환(throw 없음 — 원본 silent catch).
 */
export async function getMetric<T>(
  path: string,
  params: MetricParams = {},
  fallback: T,
): Promise<T> {
  try {
    const res = await fetch(`${BASE}${path}${buildMetricQuery(params)}`, {
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { success?: boolean; data?: T; error?: string };
    if (!json.success) throw new Error(json.error || 'metric error');
    return (json.data ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/** 모델 사용량 비율(Donut) — 실패 시 []. */
export function fetchModelUsage(params: MetricParams = {}): Promise<unknown[]> {
  return getMetric<unknown[]>('/api/metrics/model-usage', params, []);
}

/** Tool 카테고리 분포 — 실패 시 []. */
export function fetchToolCategories(params: MetricParams = {}): Promise<unknown[]> {
  return getMetric<unknown[]>('/api/metrics/tool-categories', params, []);
}
