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
  getRequestsWithFilter,
  getTopTokenRequests,
  getRequestStats,
  getRequestStatsBySession,
  getRequestStatsByType,
  getToolStats,
} from '@spyglass/storage';

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
  };
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

  // GET /api/sessions
  if (path === '/api/sessions' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const sessions = getAllSessions(db, limit);
    return jsonResponse({ success: true, data: sessions, meta: { total: sessions.length, limit } });
  }

  // GET /api/sessions/:id
  if (path.startsWith('/api/sessions/') && method === 'GET') {
    const id = path.replace('/api/sessions/', '');
    const session = getSessionById(db, id);
    if (!session) {
      return jsonResponse({ success: false, error: 'Session not found' }, 404);
    }
    return jsonResponse({ success: true, data: session });
  }

  // GET /api/sessions/active
  if (path === '/api/sessions/active' && method === 'GET') {
    const sessions = getActiveSessions(db);
    return jsonResponse({ success: true, data: sessions });
  }

  // GET /api/projects/:name/sessions
  if (path.match(/^\/api\/projects\/[^\/]+\/sessions$/) && method === 'GET') {
    const projectName = path.split('/')[3];
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const sessions = getSessionsByProject(db, projectName, limit);
    return jsonResponse({ success: true, data: sessions, meta: { total: sessions.length, limit } });
  }

  // GET /api/requests
  if (path === '/api/requests' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const requests = getAllRequests(db, limit);
    return jsonResponse({ success: true, data: requests, meta: { total: requests.length, limit } });
  }

  // GET /api/requests/top
  if (path === '/api/requests/top' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '10', 10);
    const sessionId = url.searchParams.get('session_id') || undefined;
    const requests = getTopTokenRequests(db, limit, sessionId);
    return jsonResponse({ success: true, data: requests });
  }

  // GET /api/sessions/:id/requests
  if (path.match(/^\/api\/sessions\/[^\/]+\/requests$/) && method === 'GET') {
    const sessionId = path.split('/')[3];
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const requests = getRequestsBySession(db, sessionId, limit);
    return jsonResponse({ success: true, data: requests, meta: { total: requests.length, limit } });
  }

  // GET /api/requests/by-type/:type
  if (path.match(/^\/api\/requests\/by-type\/[^\/]+$/) && method === 'GET') {
    const type = path.split('/')[4] as 'prompt' | 'tool_call' | 'system';
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const requests = getRequestsByType(db, type, limit);
    return jsonResponse({ success: true, data: requests });
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

  // GET /api/sessions/:id/stats
  if (path.match(/^\/api\/sessions\/[^\/]+\/stats$/) && method === 'GET') {
    const sessionId = path.split('/')[3];
    const stats = getRequestStatsBySession(db, sessionId);
    return jsonResponse({ success: true, data: stats });
  }

  // GET /api/dashboard
  if (path === '/api/dashboard' && method === 'GET') {
    const sessionStats = getSessionStats(db);
    const requestStats = getRequestStats(db);
    const projectStats = getProjectStats(db, 5);
    const toolStats = getToolStats(db, 5);
    const typeStats = getRequestStatsByType(db);
    const activeSessions = getActiveSessions(db);

    return jsonResponse({
      success: true,
      data: {
        summary: {
          totalSessions: sessionStats.total_sessions,
          totalRequests: requestStats.total_requests,
          totalTokens: requestStats.total_tokens,
          activeSessions: activeSessions.length,
        },
        sessions: sessionStats,
        requests: requestStats,
        projects: projectStats,
        tools: toolStats,
        types: typeStats,
        active: activeSessions,
      },
    });
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
