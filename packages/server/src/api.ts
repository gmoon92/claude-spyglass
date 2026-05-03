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
  getRecentProxyRequests,
  getProxyRequestById,
  getProxyStats,
  // v22 — system_prompts 정규화 dedup 카탈로그 (system-prompt-exposure)
  listSystemPrompts,
  getSystemPromptByHash,
  type SystemPromptOrderBy,
} from '@spyglass/storage';
import { metricsRouter } from './metrics';
import { normalizeRequests, normalizeTurns } from './domain/request-normalizer';

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

  // GET /api/sessions/:id/requests — ADR-001: 응답 직전 정규화
  if (path.match(/^\/api\/sessions\/[^\/]+\/requests$/) && method === 'GET') {
    const sessionId = path.split('/')[3];
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const rawRequests = getRequestsBySession(db, sessionId, limit);
    const requests = normalizeRequests(rawRequests);
    return jsonResponse({ success: true, data: requests, meta: { total: requests.length, limit } });
  }

  // GET /api/sessions/:id/stats
  if (path.match(/^\/api\/sessions\/[^\/]+\/stats$/) && method === 'GET') {
    const sessionId = path.split('/')[3];
    const stats = getRequestStatsBySession(db, sessionId);
    return jsonResponse({ success: true, data: stats });
  }

  // GET /api/sessions/:id/turns — ADR-001/006: 정규화 + items[] 인터리빙
  if (path.match(/^\/api\/sessions\/[^\/]+\/turns$/) && method === 'GET') {
    const sessionId = path.split('/')[3];
    const rawTurns = getTurnsBySession(db, sessionId);
    const turns = normalizeTurns(rawTurns, sessionId);
    return jsonResponse({ success: true, data: turns, meta: { total: turns.length } });
  }

  // GET /api/sessions/:id/tool-stats
  const toolStatsMatch = path.match(/^\/api\/sessions\/([^/]+)\/tool-stats$/);
  if (toolStatsMatch && method === 'GET') {
    const sessionId = decodeURIComponent(toolStatsMatch[1]);
    const rows = getSessionToolStats(db, sessionId);
    // data-honesty-ui: confidence 카운트 → has_low_confidence boolean 파생
    const data = rows.map((r) => ({
      ...r,
      has_low_confidence: (r.confidence_low_count ?? 0) + (r.confidence_error_count ?? 0) > 0,
    }));
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

  // GET /api/requests — ADR-001: 응답 직전 정규화
  if (path === '/api/requests' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const fromTs = url.searchParams.get('from') ? parseInt(url.searchParams.get('from')!, 10) : undefined;
    const toTs = url.searchParams.get('to') ? parseInt(url.searchParams.get('to')!, 10) : undefined;
    const rawRequests = getAllRequests(db, limit, fromTs, toTs);
    const requests = normalizeRequests(rawRequests);
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

  // GET /api/requests/by-type/:type — ADR-001: 응답 직전 정규화
  if (path.match(/^\/api\/requests\/by-type\/[^\/]+$/) && method === 'GET') {
    const type = path.split('/')[4] as 'prompt' | 'tool_call' | 'system';
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10));
    const fromTs = url.searchParams.get('from') ? parseInt(url.searchParams.get('from')!, 10) : undefined;
    const toTs   = url.searchParams.get('to')   ? parseInt(url.searchParams.get('to')!,   10) : undefined;
    const rawRequests = getRequestsByType(db, type, limit, offset, fromTs, toTs);
    const requests = normalizeRequests(rawRequests);
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
    // data-honesty-ui: confidence 카운트 → has_low_confidence boolean 파생
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

  // GET /api/proxy-requests — HTTP 레벨 메트릭 (프록시 수집)
  if (path === '/api/proxy-requests' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const requests = getRecentProxyRequests(db, limit);
    return jsonResponse({ success: true, data: requests, meta: { total: requests.length, limit } });
  }

  // GET /api/proxy-requests/stats — 프록시 집계 통계
  if (path === '/api/proxy-requests/stats' && method === 'GET') {
    const sinceMs = url.searchParams.get('since')
      ? parseInt(url.searchParams.get('since')!, 10)
      : Date.now() - 24 * 60 * 60 * 1000; // 기본 24시간
    const stats = getProxyStats(db, sinceMs);
    return jsonResponse({ success: true, data: stats });
  }

  // GET /api/system-prompts — dedup 카탈로그 목록 (라이브러리 패널 — ADR-004 옵션 B)
  // 정렬: orderBy ∈ {last_seen_at|ref_count|byte_size|first_seen_at}, 기본 last_seen_at DESC
  // 본문(content) 미포함 — 라이브러리 표는 메타만, 본문은 lazy-fetch (/api/system-prompts/:hash)
  if (path === '/api/system-prompts' && method === 'GET') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
    const allowedOrder: SystemPromptOrderBy[] = ['last_seen_at', 'ref_count', 'byte_size', 'first_seen_at'];
    const requested = url.searchParams.get('orderBy') as SystemPromptOrderBy | null;
    const orderBy = (requested && allowedOrder.includes(requested)) ? requested : 'last_seen_at';
    const data = listSystemPrompts(db, { limit, orderBy });
    return jsonResponse({ success: true, data, meta: { total: data.length, limit } });
  }

  // GET /api/system-prompts/:hash — 본문 lazy-fetch (LLM Input 탭에서 클릭 시)
  if (path.match(/^\/api\/system-prompts\/[^\/]+$/) && method === 'GET') {
    const hash = path.split('/')[3];
    // hash 형식 검증 — SHA-256 hex 64자
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      return jsonResponse({ success: false, error: 'Invalid hash format (expected 64-char hex)' }, 400);
    }
    const row = getSystemPromptByHash(db, hash);
    if (!row) return jsonResponse({ success: false, error: 'system prompt not found' }, 404);
    return jsonResponse({ success: true, data: row });
  }

  // GET /api/proxy-requests/:id/messages — payload(zstd) 디코드 후 user messages + system_hash 반환
  // T-09 LLM Input 탭이 의존. 본문(system content)은 미동봉 — 클라이언트가 system_hash로 별도 lazy-fetch.
  if (path.match(/^\/api\/proxy-requests\/[^\/]+\/messages$/) && method === 'GET') {
    const id = path.split('/')[3];
    const row = getProxyRequestById(db, id);
    if (!row) return jsonResponse({ success: false, error: 'proxy request not found' }, 404);

    // payload BLOB → zstd 디코드 → JSON.parse → body.messages 추출 (graceful — 실패해도 200 with empty)
    let messages: unknown[] = [];
    let decodeError: string | null = null;
    if (row.payload instanceof Uint8Array && row.payload.byteLength > 0) {
      try {
        const raw = Bun.zstdDecompressSync(row.payload);
        const text = new TextDecoder().decode(raw);
        const body = JSON.parse(text) as { messages?: unknown };
        if (Array.isArray(body.messages)) messages = body.messages;
      } catch (err) {
        decodeError = (err as Error).message ?? 'decode failed';
      }
    }

    return jsonResponse({
      success: true,
      data: {
        id: row.id,
        system_hash: row.system_hash,
        system_byte_size: row.system_byte_size,
        messages,
        ...(decodeError ? { decode_error: decodeError } : {}),
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
