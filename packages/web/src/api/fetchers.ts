/**
 * api/fetchers.ts — assets/js/api.js render-coupled fetcher 의 데이터-역전 이식 (P3-03).
 *
 * @description
 *   원본 api.js 의 fetcher 들은 fetch 직후 render 함수를 **동기 호출**하는 9개 사이드이펙트를
 *   품고 있었다(dependency-safety.md §5 위험 #1, api.js:276~418):
 *     1. renderProjects(d.projects)        (fetchDashboard:276)
 *     2. setTypeData(...)                  (fetchDashboard:277)
 *     3. setSourceData('model', modelData) (fetchDashboard:287)
 *     4. drawDonut()                       (fetchDashboard:291)
 *     5. renderTypeLegend()                (fetchDashboard:292)
 *     6. setAllSessions + renderBrowserSessions (fetchAllSessions:348-349)
 *     7. renderCachePanel(json.data)       (fetchCacheStats:359)
 *     8. setAllSessions + renderBrowserSessions (fetchSessionsByProject:369-370)
 *     9. renderBurnRate/renderCacheHealth/renderToolCategoriesCard/renderLivePulse/
 *        renderAnomalyBadge                (fetchObservability:403-418)
 *   추가로 fetchDashboard/fetchRequests 는 document.getElementById DOM 쓰기와
 *   FEED_UPDATED CustomEvent dispatch(api.js:326) 도 수행했다.
 *
 *   본 모듈은 **fetch → 파싱/검증 → raw data 반환** 만 한다.
 *     - render·DOM·CustomEvent 사이드이펙트 0. 호출처(후속 React 계층)가 setState 담당.
 *     - store(zustand) 역참조 0 — range/pagination 은 **파라미터로 주입**(api/→stores/ 금지).
 *     - 파싱은 P1-07 Zod(api-schema.ts) 재사용. any 금지 — 반환 타입은 z.infer 로 구체화.
 *     - 실패(HTTP/스키마/abort)는 throw 없이 안전 폴백(null / []) — 원본 silent catch 1:1.
 *
 *   병존: 원본 assets/js/api.js 는 유지된다(소비처 main.js vanilla + 순수 range 유틸 5 소비처).
 *   본 모듈은 신규 React 계층 전용. 순수 range 유틸(getDateRange/buildQuery/setActiveRange)은
 *   api.js 에 그대로 두고 호출처가 그 결과(RangeParams)를 본 fetcher 에 주입한다.
 *
 * @see packages/web/assets/js/api.js (원본)
 * @see packages/web/src/schema/api-schema.ts (P1-07 Zod envelope 빌더)
 * @see packages/web/docs/react-migration/_panel/dependency-safety.md §5 위험 #1
 */

import { z } from 'zod';
import type { Session } from '@spyglass/types';
import {
  ApiListEnvelopeSchema,
  ApiObjectEnvelopeSchema,
  DashboardEnvelopeSchema,
  parseApiEnvelope,
  type DashboardData,
} from '../schema/api-schema';

const API = '';
const DEFAULT_TIMEOUT_MS = 8000;

// =============================================================================
// 공통 — range/pagination 파라미터 (store 무참조, 호출처 주입)
// =============================================================================

/**
 * 날짜 range 파라미터. 원본 buildQuery 가 getDateRange()로 읽던 모듈 상태를
 * 여기선 **인자로 주입**받아 store/모듈 역참조를 끊는다(데이터 역전 핵심).
 *   - {from,to} : 절대시각(ms epoch). 둘 다 있으면 쿼리에 부착.
 *   - {range:'all'} : metrics 엔드포인트용 명시 전체 기간(api.js getMetricRangeParams 1:1).
 *   - {} : 파라미터 없음('전체' — 서버 기본값).
 */
export type RangeParams = { from?: number; to?: number; range?: string };

/** URLSearchParams 직렬화 — 모듈/store 상태를 읽지 않는 순수 헬퍼(buildQuery 와 달리 무상태). */
function withQuery(base: string, params: Record<string, string | number | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue;
    usp.set(k, String(v));
  }
  const qs = usp.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * fetch + envelope Zod 파싱 → ParseResult.ok ? data : fallback. throw·DOM·render 없음.
 *
 * 스키마 인자는 z.ZodTypeAny(Zod 자신이 제네릭 소비처에 쓰는 타입) — passthrough envelope 의
 * input/output variance 와 충돌하지 않는다(z.ZodType<{data:...}> 로 좁히면 TS2345).
 * 런타임 검증은 parseApiEnvelope 가 보장하므로, 검증 통과한 `.data` 를 호출처가 지정한
 * 데이터 타입 T 로 노출한다(반환 타입은 T|F 로 구체화 — any 누출 없음).
 *
 * @param schema ApiListEnvelopeSchema/ApiObjectEnvelopeSchema/DashboardEnvelopeSchema (P1-07)
 * @param fallback HTTP/스키마/abort 실패 시 폴백(null 또는 [])
 */
async function fetchParsed<T, F>(
  url: string,
  schema: z.ZodTypeAny,
  fallback: F,
  signal?: AbortSignal,
): Promise<T | F> {
  try {
    const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
    if (!res.ok) return fallback;
    const json: unknown = await res.json();
    const parsed = parseApiEnvelope<{ data: T }>(schema as z.ZodType<{ data: T }>, json);
    return parsed.ok && parsed.data ? parsed.data.data : fallback;
  } catch {
    return fallback;
  }
}

// =============================================================================
// 항목 스키마 (P1-07 envelope 빌더 재사용 — passthrough 로 후방호환, any 금지)
// =============================================================================

/** REST 요청 행(최소 계약). 원본 anomaly-bloated-sys ADR-003: bloated_sys/agent_spike 는 서버가 채움 → passthrough 보존. */
const RequestRowSchema = z.object({ id: z.string() }).passthrough();
export type RequestRow = z.infer<typeof RequestRowSchema>;

/** 세션 행 — 도메인 Session(@spyglass/types) 으로 흘러갈 최소 필드. passthrough 로 나머지 보존. */
const SessionRowSchema = z.object({ session_id: z.string() }).passthrough();
type SessionRow = z.infer<typeof SessionRowSchema>;

/** /api/stats/cache data. */
const CacheStatsSchema = z.object({ hit_rate: z.number().optional() }).passthrough();
export type CacheStats = z.infer<typeof CacheStatsSchema>;

/** /api/proxy-requests 행(api.js ProxyRequestRow typedef 1:1 최소). */
const ProxyRequestRowSchema = z
  .object({ id: z.string(), timestamp: z.number() })
  .passthrough();
export type ProxyRequestRow = z.infer<typeof ProxyRequestRowSchema>;

/** /api/proxy-requests/stats data(api.js ProxyStats typedef 1:1 최소). */
const ProxyStatsSchema = z
  .object({ total_requests: z.number().optional(), total_tokens: z.number().optional() })
  .passthrough();
export type ProxyStats = z.infer<typeof ProxyStatsSchema>;

/** 활성 세션 행 — Live Pulse 집계용 last_activity_at 만 필요. */
const ActiveSessionRowSchema = z.object({ last_activity_at: z.number().optional() }).passthrough();
export type ActiveSessionRow = z.infer<typeof ActiveSessionRowSchema>;

const RequestListEnvelope = ApiListEnvelopeSchema(RequestRowSchema);
const SessionListEnvelope = ApiListEnvelopeSchema(SessionRowSchema);
const CacheStatsEnvelope = ApiObjectEnvelopeSchema(CacheStatsSchema);
const ProxyListEnvelope = ApiListEnvelopeSchema(ProxyRequestRowSchema);
const ProxyStatsEnvelope = ApiObjectEnvelopeSchema(ProxyStatsSchema);
const ActiveListEnvelope = ApiListEnvelopeSchema(ActiveSessionRowSchema);

// =============================================================================
// 1. Dashboard — raw DashboardData 반환 (원본 render 5종 제거: :276,277,287,291,292)
// =============================================================================

/**
 * GET /api/dashboard — raw DashboardData 반환.
 * 원본(api.js:240)이 하던 DOM stat 쓰기 + renderProjects/setTypeData/drawDonut/renderTypeLegend +
 * fetchModelUsage(donut) + fetchObservability 트리거는 **전부 제거**. 호출처가 setState 로 처리하고,
 * model-usage·observability 후속 fetch 도 호출처가 오케스트레이션한다.
 * @param range from/to 주입(원본 buildQuery(getDateRange()) 대체)
 */
export async function fetchDashboard(
  range: RangeParams = {},
  signal?: AbortSignal,
): Promise<DashboardData | null> {
  const url = withQuery(`${API}/api/dashboard`, { from: range.from, to: range.to });
  return fetchParsed<DashboardData, null>(url, DashboardEnvelopeSchema, null, signal);
}

// =============================================================================
// 2. Requests — raw 행 배열 반환 (원본 FEED_UPDATED dispatch + DOM 쓰기 제거: :326,332,336)
// =============================================================================

/** fetchRequests 파라미터. reqOffset 모듈 상태는 호출처(store)가 관리 → 인자 주입. */
export interface FetchRequestsParams {
  /** 'all' 또는 type 키(by-type 엔드포인트). 원본 reqFilter(api.js:147). */
  filter?: string;
  /** 페이지 크기. 원본 REQ_PAGE=200(api.js:149). */
  limit?: number;
  /** 페이지 오프셋. 원본 reqOffset(api.js:148, 모듈 상태였음). */
  offset?: number;
  range?: RangeParams;
}

/**
 * GET /api/requests | /api/requests/by-type/:type — raw 행 배열 반환.
 * 원본(api.js:304)의 anomalyMap 계산 + FEED_UPDATED CustomEvent dispatch +
 * loadMoreBtn/requestsBody DOM 쓰기는 **제거**. anomaly 매핑·페이지네이션은 호출처 책임.
 */
export async function fetchRequests(params: FetchRequestsParams = {}, signal?: AbortSignal): Promise<RequestRow[]> {
  const { filter = 'all', limit = 200, offset = 0, range = {} } = params;
  const base =
    filter === 'all'
      ? `${API}/api/requests`
      : `${API}/api/requests/by-type/${encodeURIComponent(filter)}`;
  const url = withQuery(base, { limit, offset, from: range.from, to: range.to });
  return fetchParsed<RequestRow[], RequestRow[]>(url, RequestListEnvelope, [], signal);
}

// =============================================================================
// 3. Sessions — raw Session[] 반환 (원본 setAllSessions + renderBrowserSessions 제거: :348-349,369-370)
// =============================================================================

/**
 * GET /api/sessions — raw 세션 배열 반환.
 * 원본(api.js:344)의 setAllSessions(left-panel store)+renderBrowserSessions 는 **제거**.
 */
export async function fetchAllSessions(range: RangeParams = {}, limit = 500, signal?: AbortSignal): Promise<Session[]> {
  const url = withQuery(`${API}/api/sessions`, { limit, from: range.from, to: range.to });
  const rows = await fetchParsed<SessionRow[], SessionRow[]>(url, SessionListEnvelope, [], signal);
  // SessionRowSchema 는 passthrough — 호출처가 Session 으로 소비. 좁히기 캐스팅(any 미사용).
  return rows as unknown as Session[];
}

/**
 * GET /api/projects/:name/sessions — 해당 프로젝트 세션 배열만 raw 반환.
 * 원본(api.js:364)의 getAllSessions().filter merge + setAllSessions + renderBrowserSessions 는
 * **제거** — merge 는 store(호출처) 책임. 본 fetcher 는 프로젝트 결과만 반환.
 */
export async function fetchSessionsByProject(projectName: string, limit = 200, signal?: AbortSignal): Promise<Session[]> {
  const url = withQuery(`${API}/api/projects/${encodeURIComponent(projectName)}/sessions`, { limit });
  const rows = await fetchParsed<SessionRow[], SessionRow[]>(url, SessionListEnvelope, [], signal);
  return rows as unknown as Session[];
}

// =============================================================================
// 4. Cache stats — raw CacheStats|null (원본 renderCachePanel 제거: :359)
// =============================================================================

/** GET /api/stats/cache — raw data 반환. 원본(api.js:354) renderCachePanel 제거. */
export async function fetchCacheStats(range: RangeParams = {}, signal?: AbortSignal): Promise<CacheStats | null> {
  const url = withQuery(`${API}/api/stats/cache`, { from: range.from, to: range.to });
  return fetchParsed<CacheStats, null>(url, CacheStatsEnvelope, null, signal);
}

// =============================================================================
// 5. Observability — 4 payload 묶음 raw 반환 (원본 render 5종 제거: :403-418)
// =============================================================================

/** 옵저빌리티 4 엔드포인트 raw payload 묶음. 원본은 즉시 render; 여기선 데이터만. */
export interface ObservabilityData {
  burnRate: unknown;
  cacheTrend: unknown;
  toolCategories: unknown[];
  activeSessions: ActiveSessionRow[];
}

/** 개별 엔드포인트 안전 fetch — 실패 시 null(원본 safeJson api.js:378 1:1). */
async function safeJsonData(url: string, signal?: AbortSignal): Promise<unknown> {
  try {
    const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
    if (!res.ok) return null;
    const j = (await res.json()) as { data?: unknown };
    return j?.data ?? null;
  } catch {
    return null;
  }
}

/**
 * /api/metrics/{burn-rate,cache-trend,tool-categories} + /api/sessions/active 병렬 호출.
 * 원본(api.js:388)의 renderBurnRate/renderCacheHealth/renderToolCategoriesCard/renderLivePulse/
 * renderAnomalyBadge 5개 render 는 **제거** — raw payload 묶음만 반환. Live Pulse 집계(last_event_ts)·
 * anomaly 판정은 호출처가 raw 에서 파생.
 * @param rangeExtra metrics 라우터용 range(원본 getDateRange→{} | {range:'all'} 분기 결과를 주입)
 */
export async function fetchObservability(rangeExtra: RangeParams = {}, signal?: AbortSignal): Promise<ObservabilityData> {
  const q = { from: rangeExtra.from, to: rangeExtra.to, range: rangeExtra.range };
  const [burnRate, cacheTrend, toolCategoriesRaw, activeRaw] = await Promise.all([
    safeJsonData(withQuery(`${API}/api/metrics/burn-rate`, q), signal),
    safeJsonData(withQuery(`${API}/api/metrics/cache-trend`, q), signal),
    safeJsonData(withQuery(`${API}/api/metrics/tool-categories`, q), signal),
    safeJsonData(`${API}/api/sessions/active`, signal),
  ]);

  const activeParsed = ActiveListEnvelope.safeParse({ data: activeRaw });
  return {
    burnRate,
    cacheTrend,
    toolCategories: Array.isArray(toolCategoriesRaw) ? toolCategoriesRaw : [],
    activeSessions: activeParsed.success ? activeParsed.data.data : [],
  };
}

// =============================================================================
// 6. Proxy — 원본이 이미 raw 반환(api.js:423,434). 이식 동일성 유지(any 금지 강화).
// =============================================================================

/** GET /api/proxy-requests?limit= — raw 행 배열(원본 api.js:423, 이미 사이드이펙트 없음). */
export async function fetchProxyRequests(limit = 50, signal?: AbortSignal): Promise<ProxyRequestRow[]> {
  const url = `${API}/api/proxy-requests?limit=${limit}`;
  return fetchParsed<ProxyRequestRow[], ProxyRequestRow[]>(url, ProxyListEnvelope, [], signal);
}

/** GET /api/proxy-requests/stats?since= — raw data|null(원본 api.js:434). */
export async function fetchProxyStats(since?: number, signal?: AbortSignal): Promise<ProxyStats | null> {
  const sinceMs = since ?? Date.now() - 24 * 60 * 60 * 1000;
  const url = `${API}/api/proxy-requests/stats?since=${sinceMs}`;
  return fetchParsed<ProxyStats, null>(url, ProxyStatsEnvelope, null, signal);
}
