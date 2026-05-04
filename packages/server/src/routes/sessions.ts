/**
 * /api/sessions/* 라우트 — 세션 도메인.
 *
 * @description
 *   srp-redesign Phase 2: api.ts(406줄) 분해 결과.
 *   변경 이유: "세션 조회·세션별 자식 데이터 제공 정책 변경".
 *
 *   포함 라우트 (9개):
 *   - GET /api/sessions
 *   - GET /api/sessions/active
 *   - GET /api/sessions/:id/requests
 *   - GET /api/sessions/:id/stats
 *   - GET /api/sessions/:id/turns
 *   - GET /api/sessions/:id/tool-stats
 *   - GET /api/sessions/:id/events
 *   - GET /api/sessions/:id  (catch-all — 마지막에 배치)
 *   - GET /api/projects/:name/sessions
 *
 *   세션 도메인이 같은 파일에 응집된 이유: 라우트 매칭 우선순위 보존.
 *   예: /api/sessions/:id가 catch-all이라 /api/sessions/active·:id/requests 등
 *   하위 경로보다 늦게 매칭되어야 함 — 한 파일 안에서 순서 명시가 가장 안전.
 */

import {
  getActiveSessions,
  getAllSessions,
  getEventsBySession,
  getRequestsBySession,
  getRequestStatsBySession,
  getSessionById,
  getSessionsByProject,
  getSessionToolStats,
  getTurnsBySession,
  getOrphanRowsBySession,
} from '@spyglass/storage';
import { normalizeRequest, normalizeRequests, normalizeTurns } from '../domain/request-normalizer';
import { jsonResponse, type RouteHandler } from './_shared';

export const sessionsRouter: RouteHandler = (_req, db, url, path, method) => {
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

  // GET /api/sessions/:id/requests — ADR-001 (log-view-unification): 응답 직전 정규화
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
  // ADR-001 P1 (session-prologue): turn_id가 NULL인 행도 별도 prologue 배열로 노출.
  //   비어 있으면 클라가 섹션 자체를 안 그림 (일반 세션은 prologue 없음).
  if (path.match(/^\/api\/sessions\/[^\/]+\/turns$/) && method === 'GET') {
    const sessionId = path.split('/')[3];
    const rawTurns = getTurnsBySession(db, sessionId);
    const turns = normalizeTurns(rawTurns, sessionId);
    const rawOrphans = getOrphanRowsBySession(db, sessionId);
    const prologue = rawOrphans.map((r) => normalizeRequest(r));
    return jsonResponse({
      success: true,
      data: turns,
      prologue,
      meta: { total: turns.length, prologue_count: prologue.length },
    });
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

  // GET /api/sessions/:id/events — events 라우터에서도 매칭되지만 ordering으로 여기서 먼저
  if (path.match(/^\/api\/sessions\/[^\/]+\/events$/) && method === 'GET') {
    const sessionId = path.split('/')[3];
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const events = getEventsBySession(db, sessionId, limit);
    return jsonResponse({ success: true, data: events, meta: { total: events.length, limit } });
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

  return null;
};
