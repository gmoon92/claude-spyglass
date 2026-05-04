/**
 * /api/requests/* 라우트 — Request 도메인.
 *
 * @description
 *   srp-redesign Phase 2: api.ts(406줄) 분해 결과.
 *   변경 이유: "Request 조회 정책·정규화 결과 노출 변경".
 *
 *   포함 라우트 (3개):
 *   - GET /api/requests
 *   - GET /api/requests/top
 *   - GET /api/requests/by-type/:type
 *
 *   3개 모두 NormalizedRequest 정규화를 거쳐 응답하는 공통 패턴 (ADR-001 log-view-unification).
 */

import {
  getAllRequests,
  getP95DurationMs,
  getRequestsByType,
  getTopTokenRequests,
} from '@spyglass/storage';
import { normalizeRequests } from '../domain/request-normalizer';
import { jsonResponse, type RouteHandler } from './_shared';

export const requestsRouter: RouteHandler = (_req, db, url, path, method) => {
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

  return null;
};
