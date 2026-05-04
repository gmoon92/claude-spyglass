/**
 * /api/dashboard 라우트 + 대시보드 응답 캐시.
 *
 * @description
 *   srp-redesign Phase 2: api.ts(406줄) 분해 결과.
 *   변경 이유: "대시보드 위젯 구성·캐시 TTL 변경" — 한 곳에 응집.
 *
 *   캐시는 모듈-스코프 변수로 관리. SSE/proxy 흐름이 INSERT 시 `invalidateDashboardCache()`를
 *   호출하여 다음 요청에서 fresh 응답 보장 (TTL 30s 안이라도 무효화).
 *
 *   외부 노출 함수: invalidateDashboardCache() — proxy/handler.ts·hook 등이 import.
 *   외부 호환 보장을 위해 api.ts에서도 re-export.
 */

import type { Database } from 'bun:sqlite';
import {
  getActiveSessions,
  getAvgPromptDurationMs,
  getProjectStats,
  getRequestStats,
  getRequestStatsByType,
  getSessionStats,
  getStripStats,
  getToolStats,
} from '@spyglass/storage';
import { jsonResponse, type RouteHandler } from './_shared';

// =============================================================================
// 모듈 스코프 캐시 (변경 이유 단일: TTL · 캐시 키 정책)
// =============================================================================

const DASHBOARD_CACHE_TTL = 30_000;
let _dashboardCache: { key: string; data: unknown; ts: number } | null = null;

/**
 * 대시보드 응답 캐시 무효화.
 * SSE/proxy 흐름이 새 데이터를 INSERT한 직후 호출하여 다음 요청이 fresh 응답을 받도록 보장.
 */
export function invalidateDashboardCache(): void {
  _dashboardCache = null;
}

// =============================================================================
// 라우트
// =============================================================================

export const dashboardRouter: RouteHandler = (_req, db: Database, url, path, method) => {
  // GET /api/dashboard
  if (path === '/api/dashboard' && method === 'GET') {
    const now = Date.now();
    const fromTs = url.searchParams.get('from') ? parseInt(url.searchParams.get('from')!, 10) : undefined;
    const toTs = url.searchParams.get('to') ? parseInt(url.searchParams.get('to')!, 10) : undefined;

    // 캐시 키에 날짜 범위 포함
    const cacheKey = `${fromTs || 'all'}-${toTs || 'all'}`;
    if (_dashboardCache && _dashboardCache.key === cacheKey && now - _dashboardCache.ts < DASHBOARD_CACHE_TTL) {
      return jsonResponse({ success: true, data: _dashboardCache.data });
    }

    const sessionStats = getSessionStats(db, fromTs, toTs);
    const requestStats = getRequestStats(db, fromTs, toTs);
    const projectStats = getProjectStats(db, 5, fromTs, toTs);
    const toolStats = getToolStats(db, 5, fromTs, toTs);
    const typeStats = getRequestStatsByType(db, fromTs, toTs);
    const activeSessions = getActiveSessions(db);
    const _avgRaw = getAvgPromptDurationMs(db, fromTs, toTs);
    const avgDurationMs = _avgRaw > 0 ? Math.round(_avgRaw) : null;
    const stripStats = getStripStats(db, fromTs, toTs);

    const data = {
      summary: {
        totalSessions: sessionStats.total_sessions,
        totalRequests: requestStats.total_requests,
        totalTokens: requestStats.total_tokens,
        activeSessions: activeSessions.length,
        avgDurationMs,
        p95DurationMs: stripStats.p95_duration_ms,
        errorRate: stripStats.error_rate,
      },
      sessions: sessionStats,
      requests: requestStats,
      projects: projectStats,
      tools: toolStats,
      types: typeStats,
      active: activeSessions,
    };
    _dashboardCache = { key: cacheKey, data, ts: now };
    return jsonResponse({ success: true, data });
  }

  return null;
};
