/**
 * REST API Router
 *
 * @description /api/* 엔드포인트 구현
 */

import type { Database } from 'bun:sqlite';
import {
  getAllSessions,
  getSessionById,
  getSessionsByProject,
  getActiveSessions,
  getSessionStats,
  getProjectStats,
  getAllRequests,
  getRequestsBySession,
  getRequestsByType,
  getTopTokenRequests,
  getRequestStats,
  getRequestStatsBySession,
  getRequestStatsByType,
  getToolStats,
  getTurnsBySession,
  getSessionToolStats,
  getAvgPromptDurationMs,
  getStripStats,
  getP95DurationMs,
  getCacheStats,
  getRecentEvents,
  getEventsBySession,
  getEventsByType,
  getEventStats,
} from '@spyglass/storage';
import { metricsRouter } from './metrics';

// =============================================================================
// API 응답 타입
// =============================================================================

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    offset?: number;
    p95DurationMs?: number;
  };
}

// =============================================================================
// Dashboard 캐시
// =============================================================================

const DASHBOARD_CACHE_TTL = 30_000;
let _dashboardCache: { key: string; data: unknown; ts: number } | null = null;

export function invalidateDashboardCache(): void {
  _dashboardCache = null;
}

// =============================================================================
// 라우터
// =============================================================================

/**
 * API 요청 라우터
 */
export async function apiRouter(req: Request, db: Database): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // /api/metrics/* — UI Redesign Phase 2 시각 지표 8종
  // (가격 환산 없음, 토큰/카운트/비율 단위만 노출)
  const metricsResponse = await metricsRouter(req, db);
  if (metricsResponse) return metricsResponse;

  // GET /api/sessions
  if (path === '/api/sessions' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const fromTs = url.searchParams.get('from') ? parseInt(url.searchParams.get('from')!, 10) : undefined;
    const toTs = url.searchParams.get('to') ? parseInt(url.searchParams.get('to')!, 10) : undefined;
    const sessions = getAllSessions(db, limit, fromTs, toTs);
    return jsonResponse({ success: true, data: sessions, meta: { total: sessions.length, limit } });
  }

  // GET /api/sessions/active
  if (path === '/api/sessions/active' && method === 'GET') {
    const sessions = getActiveSessions(db);
    return jsonResponse({ success: true, data: sessions });
  }

  // GET /api/sessions/:id/requests
  if (path.match(/^\/api\/sessions\/[^\/]+\/requests$/) && method === 'GET') {
    const sessionId = path.split('/')[3];
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const requests = getRequestsBySession(db, sessionId, limit);
    return jsonResponse({ success: true, data: requests, meta: { total: requests.length, limit } });
  }

  // GET /api/sessions/:id/stats
  if (path.match(/^\/api\/sessions\/[^\/]+\/stats$/) && method === 'GET') {
    const sessionId = path.split('/')[3];
    const stats = getRequestStatsBySession(db, sessionId);
    return jsonResponse({ success: true, data: stats });
  }

  // GET /api/sessions/:id/turns
  if (path.match(/^\/api\/sessions\/[^\/]+\/turns$/) && method === 'GET') {
    const sessionId = path.split('/')[3];
    const turns = getTurnsBySession(db, sessionId);
    return jsonResponse({ success: true, data: turns, meta: { total: turns.length } });
  }

  // GET /api/sessions/:id/tool-stats
  const toolStatsMatch = path.match(/^\/api\/sessions\/([^/]+)\/tool-stats$/);
  if (toolStatsMatch && method === 'GET') {
    const sessionId = decodeURIComponent(toolStatsMatch[1]);
    const data = getSessionToolStats(db, sessionId);
    return jsonResponse({ success: true, data });
  }

  // GET /api/sessions/:id  (반드시 하위 경로 라우트 뒤에 위치)
  if (path.startsWith('/api/sessions/') && method === 'GET') {
    const id = path.replace('/api/sessions/', '');
    const session = getSessionById(db, id);
    if (!session) {
      return jsonResponse({ success: false, error: 'Session not found' }, 404);
    }
    return jsonResponse({ success: true, data: session });
  }

  // GET /api/projects/:name/sessions
  if (path.match(/^\/api\/projects\/[^\/]+\/sessions$/) && method === 'GET') {
    const projectName = path.split('/')[3];
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const fromTs = url.searchParams.get('from') ? parseInt(url.searchParams.get('from')!, 10) : undefined;
    const toTs = url.searchParams.get('to') ? parseInt(url.searchParams.get('to')!, 10) : undefined;
    const sessions = getSessionsByProject(db, projectName, limit, fromTs, toTs);
    return jsonResponse({ success: true, data: sessions, meta: { total: sessions.length, limit } });
  }

  // GET /api/requests
  if (path === '/api/requests' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const fromTs = url.searchParams.get('from') ? parseInt(url.searchParams.get('from')!, 10) : undefined;
    const toTs = url.searchParams.get('to') ? parseInt(url.searchParams.get('to')!, 10) : undefined;
    const requests = getAllRequests(db, limit, fromTs, toTs);
    const p95DurationMs = getP95DurationMs(db, fromTs, toTs);
    return jsonResponse({ success: true, data: requests, meta: { total: requests.length, limit, p95DurationMs } });
  }

  // GET /api/requests/top
  if (path === '/api/requests/top' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '10', 10);
    const sessionId = url.searchParams.get('session_id') || undefined;
    const requests = getTopTokenRequests(db, limit, sessionId);
    return jsonResponse({ success: true, data: requests });
  }

  // GET /api/requests/by-type/:type
  if (path.match(/^\/api\/requests\/by-type\/[^\/]+$/) && method === 'GET') {
    const type = path.split('/')[4] as 'prompt' | 'tool_call' | 'system';
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10));
    const fromTs = url.searchParams.get('from') ? parseInt(url.searchParams.get('from')!, 10) : undefined;
    const toTs   = url.searchParams.get('to')   ? parseInt(url.searchParams.get('to')!,   10) : undefined;
    const requests = getRequestsByType(db, type, limit, offset, fromTs, toTs);
    return jsonResponse({ success: true, data: requests, meta: { total: requests.length, limit, offset } });
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

  // GET /api/stats/tools
  if (path === '/api/stats/tools' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '10', 10);
    const stats = getToolStats(db, limit);
    return jsonResponse({ success: true, data: stats });
  }

  // GET /api/stats/by-type
  if (path === '/api/stats/by-type' && method === 'GET') {
    const stats = getRequestStatsByType(db);
    return jsonResponse({ success: true, data: stats });
  }

  // GET /api/stats/strip — 오늘 Command Center Strip 지표 (P95, error rate, 토큰 캐시)
  // 비용(USD) 지표는 페이로드에 없는 계산값이라 옵저빌리티 신뢰도 정책상 제거됨.
  if (path === '/api/stats/strip' && method === 'GET') {
    const todayMidnightMs = new Date().setHours(0, 0, 0, 0);
    const { cost_usd: _c, cache_savings_usd: _s, ...stats } = getStripStats(db, todayMidnightMs);
    return jsonResponse({ success: true, data: stats });
  }

  // GET /api/stats/cache — 캐시 히트율·토큰 절감 집계 (USD 환산은 노출하지 않음)
  if (path === '/api/stats/cache' && method === 'GET') {
    const fromTs = url.searchParams.get('from') ? parseInt(url.searchParams.get('from')!, 10) : undefined;
    const toTs   = url.searchParams.get('to')   ? parseInt(url.searchParams.get('to')!,   10) : undefined;
    const { costWithCache: _w, costWithoutCache: _wo, savingsUsd: _su, ...stats } = getCacheStats(db, fromTs, toTs);
    return jsonResponse({ success: true, data: stats });
  }

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

  // GET /api/events
  if (path === '/api/events' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const events = getRecentEvents(db, limit);
    return jsonResponse({ success: true, data: events, meta: { total: events.length, limit } });
  }

  // GET /api/events/by-type/:type
  if (path.match(/^\/api\/events\/by-type\/[^\/]+$/) && method === 'GET') {
    const eventType = path.split('/')[4];
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const events = getEventsByType(db, eventType, limit);
    return jsonResponse({ success: true, data: events, meta: { total: events.length, limit } });
  }

  // GET /api/events/stats
  if (path === '/api/events/stats' && method === 'GET') {
    const stats = getEventStats(db);
    return jsonResponse({ success: true, data: stats });
  }

  // GET /api/sessions/:id/events
  if (path.match(/^\/api\/sessions\/[^\/]+\/events$/) && method === 'GET') {
    const sessionId = path.split('/')[3];
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const events = getEventsBySession(db, sessionId, limit);
    return jsonResponse({ success: true, data: events, meta: { total: events.length, limit } });
  }

  // 404
  return jsonResponse({ success: false, error: 'API endpoint not found' }, 404);
}

// =============================================================================
// 유틸리티
// =============================================================================

function jsonResponse(body: ApiResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
