/**
 * /api/events/* 라우트 — Wildcard hook 이벤트 도메인.
 *
 * @description
 *   srp-redesign Phase 2: api.ts(406줄) 분해 결과.
 *   변경 이유: "claude_events 테이블 조회 정책 변경".
 *
 *   포함 라우트 (3개):
 *   - GET /api/events
 *   - GET /api/events/by-type/:type
 *   - GET /api/events/stats
 *
 *   참고: /api/sessions/:id/events는 라우트 매칭 우선순위 보존을 위해 sessions.ts에 위치.
 */

import {
  getEventsByType,
  getEventStats,
  getRecentEvents,
} from '@spyglass/storage';
import { jsonResponse, type RouteHandler } from './_shared';

export const eventsRouter: RouteHandler = (_req, db, url, path, method) => {
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

  return null;
};
