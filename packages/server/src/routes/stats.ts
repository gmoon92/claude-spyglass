/**
 * /api/stats/* 라우트 — 통계 도메인.
 *
 * @description
 *   srp-redesign Phase 2: api.ts(406줄) 분해 결과.
 *   변경 이유: "통계 지표 노출 정책 변경 (어떤 지표를 어떤 단위로 보여줄지)".
 *
 *   포함 라우트 (7개):
 *   - GET /api/stats/sessions
 *   - GET /api/stats/requests
 *   - GET /api/stats/projects
 *   - GET /api/stats/tools
 *   - GET /api/stats/by-type
 *   - GET /api/stats/strip
 *   - GET /api/stats/cache
 *   - GET /api/stats/subagents?from=&to=&project=&max_tier=  (서브에이전트 종류 × 실제 모델, 상한 초과 표시)
 *
 *   참고: /api/dashboard는 캐시 정책이 있어 별도 routes/dashboard.ts로 분리.
 *   /api/metrics/*는 metricsRouter(별도 파일)가 담당 — UI Redesign Phase 2 시각 지표.
 */

import {
  getCacheStats,
  getProjectStats,
  getProxyHourlyStats,
  getProxyHourlyStatsByModel,
  getRequestStats,
  getRequestStatsByType,
  getSessionStats,
  getStripStats,
  getSubagentUsage,
  parseModelTier,
  getToolStats,
} from '@spyglass/storage';
import { jsonResponse, type RouteHandler } from './_shared';

export const statsRouter: RouteHandler = (_req, db, url, path, method) => {
  // GET /api/stats/subagents — 허브 서브에이전트 모델 상한 점검. 모델은 proxy 실측 우선.
  if (path === '/api/stats/subagents' && method === 'GET') {
    const from = parseMsParam(url.searchParams.get('from'));
    const to = parseMsParam(url.searchParams.get('to'));
    if (from === undefined || to === undefined) {
      return jsonResponse({ success: false, error: 'from/to must be ms epoch integers' }, 400);
    }
    const rawTier = url.searchParams.get('max_tier');
    const maxTier = parseModelTier(rawTier);
    if (rawTier && !maxTier) {
      return jsonResponse({ success: false, error: 'max_tier must be one of haiku|sonnet|opus|fable' }, 400);
    }
    const data = getSubagentUsage(db, {
      from, to, project: url.searchParams.get('project') || null, maxTier,
    });
    return jsonResponse({
      success: true,
      data,
      meta: { total: data.length, max_tier: maxTier, over_cap_count: data.filter((r) => r.over_cap === true).length },
    });
  }

  // GET /api/stats/sessions
  if (path === '/api/stats/sessions' && method === 'GET') {
    const stats = getSessionStats(db);
    return jsonResponse({ success: true, data: stats });
  }

  // GET /api/stats/requests
  if (path === '/api/stats/requests' && method === 'GET') {
    const stats = getRequestStats(db);
    return jsonResponse({ success: true, data: stats });
  }

  // GET /api/stats/projects
  if (path === '/api/stats/projects' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '10', 10);
    const stats = getProjectStats(db, limit);
    return jsonResponse({ success: true, data: stats });
  }

  // GET /api/stats/tools — data-honesty-ui: confidence 카운트 → has_low_confidence 파생
  if (path === '/api/stats/tools' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '10', 10);
    const stats = getToolStats(db, limit);
    const data = stats.map((r) => ({
      ...r,
      has_low_confidence: (r.confidence_low_count ?? 0) + (r.confidence_error_count ?? 0) > 0,
    }));
    return jsonResponse({ success: true, data });
  }

  // GET /api/stats/by-type
  if (path === '/api/stats/by-type' && method === 'GET') {
    const stats = getRequestStatsByType(db);
    return jsonResponse({ success: true, data: stats });
  }

  // GET /api/stats/strip — 오늘 Command Center Strip 지표 (P95 / error rate)
  // 비용(USD) 지표는 정확한 가격 플랜을 알 수 없는 추정치이므로 제거됨 (storage layer에서 계산 자체 제거).
  if (path === '/api/stats/strip' && method === 'GET') {
    const todayMidnightMs = new Date().setHours(0, 0, 0, 0);
    const stats = getStripStats(db, todayMidnightMs);
    return jsonResponse({ success: true, data: stats });
  }

  // GET /api/stats/cache — 캐시 히트율·토큰 절감 집계 (USD 환산은 노출하지 않음)
  if (path === '/api/stats/cache' && method === 'GET') {
    const fromTs = url.searchParams.get('from') ? parseInt(url.searchParams.get('from')!, 10) : undefined;
    const toTs   = url.searchParams.get('to')   ? parseInt(url.searchParams.get('to')!,   10) : undefined;
    const stats = getCacheStats(db, fromTs, toTs);
    return jsonResponse({ success: true, data: stats });
  }

  // GET /api/stats/proxy — proxy_requests 사전 집계 통계 (응답시간/TTFT/비용/에러율)
  if (path === '/api/stats/proxy' && method === 'GET') {
    const fromTs = url.searchParams.get('from') ? parseInt(url.searchParams.get('from')!, 10) : undefined;
    const toTs   = url.searchParams.get('to')   ? parseInt(url.searchParams.get('to')!,   10) : undefined;
    const stats = getProxyHourlyStats(db, fromTs, toTs);
    return jsonResponse({ success: true, data: stats });
  }

  // GET /api/stats/proxy/by-model — 모델별 proxy 통계 (cost / latency 비교 차트용)
  if (path === '/api/stats/proxy/by-model' && method === 'GET') {
    const fromTs = url.searchParams.get('from') ? parseInt(url.searchParams.get('from')!, 10) : undefined;
    const toTs   = url.searchParams.get('to')   ? parseInt(url.searchParams.get('to')!,   10) : undefined;
    const stats = getProxyHourlyStatsByModel(db, fromTs, toTs);
    return jsonResponse({ success: true, data: stats });
  }

  return null;
};

/** ms epoch 쿼리 파라미터 — 없으면 null, 정수가 아니면 undefined(→ 400). */
function parseMsParam(v: string | null): number | null | undefined {
  if (v == null || v === '') return null;
  if (!/^\d+$/.test(v)) return undefined;
  return Number(v);
}
