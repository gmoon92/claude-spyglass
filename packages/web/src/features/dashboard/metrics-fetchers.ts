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
  /** 프로젝트 스코프(도넛 프로젝트별 모델 분포). 미지정 시 전역(서버 기본). */
  project?: string;
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
 *
 * signal: 호출처(effect)의 AbortController 를 받으면 8초 타임아웃과 **결합**한다(AbortSignal.any).
 *   호출처 신호 누락 시에도 타임아웃은 항상 적용 — 요청이 매달려도 무한 대기하지 않는다(fetchers.ts B1 동치).
 *   호출처가 신호를 주면 effect cleanup/재실행 시 in-flight 요청이 취소되어 stale 응답 덮어쓰기를 막는다.
 */
export async function getMetric<T>(
  path: string,
  params: MetricParams = {},
  fallback: T,
  signal?: AbortSignal,
): Promise<T> {
  try {
    const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
    const res = await fetch(`${BASE}${path}${buildMetricQuery(params)}`, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { success?: boolean; data?: T; error?: string };
    if (!json.success) throw new Error(json.error || 'metric error');
    return (json.data ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/** 모델 사용량 비율(Donut) — 실패 시 []. signal 로 stale 응답 덮어쓰기 방지(model 도넛 race). */
export function fetchModelUsage(params: MetricParams = {}, signal?: AbortSignal): Promise<unknown[]> {
  return getMetric<unknown[]>('/api/metrics/model-usage', params, [], signal);
}

/** Tool 카테고리 분포 — 실패 시 []. */
export function fetchToolCategories(params: MetricParams = {}, signal?: AbortSignal): Promise<unknown[]> {
  return getMetric<unknown[]>('/api/metrics/tool-categories', params, [], signal);
}
