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
  getRequestById,
  getRequestsByType,
  getTopTokenRequests,
} from '@spyglass/storage';
import { normalizeRequests } from '../domain/request-normalizer';
import { enrichWithAnomalies } from '../domain/anomaly-enricher';
import { jsonResponse, type RouteHandler } from './_shared';

/**
 * 응답 직전 anomaly 필드 부여 (anomaly-bloated-sys ADR-003).
 *
 * 클라이언트는 본 함수가 채운 `bloated_sys` / `agent_spike` 필드를 그대로 표시한다.
 * (거울 계산 금지 — `packages/web/assets/js/anomaly.js`)
 *
 * SSoT 쌍:
 *  - packages/server/src/metrics/calculators/anomaly.ts (검출 알고리즘 SSoT)
 *  - packages/server/src/domain/anomaly-enricher.ts (행 부여 정책)
 *  - packages/web/assets/js/anomaly.js (표시만 — 계산 폐기)
 */
export const requestsRouter: RouteHandler = (_req, db, url, path, method) => {
  // GET /api/requests — ADR-001: 응답 직전 정규화 + anomaly 부여 (ADR-003)
  if (path === '/api/requests' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const fromTs = url.searchParams.get('from') ? parseInt(url.searchParams.get('from')!, 10) : undefined;
    const toTs = url.searchParams.get('to') ? parseInt(url.searchParams.get('to')!, 10) : undefined;
    const rawRequests = getAllRequests(db, limit, fromTs, toTs);
    const requests = enrichWithAnomalies(db, normalizeRequests(rawRequests));
    const p95DurationMs = getP95DurationMs(db, fromTs, toTs);
    return jsonResponse({ success: true, data: requests, meta: { total: requests.length, limit, p95DurationMs } });
  }

  // GET /api/requests/:id/payload — 단건 full payload lazy-load (additive).
  //   피드/목록 응답은 payload 미포함(getAllRequests·getRequestsByType — 전송량 절감)이라,
  //   특정 행의 본문 전체가 필요할 때(행 펼침·turn lazy-load) 이 경로로 단건만 회수한다.
  //   getRequestById(read.ts) 재사용 — LEFT JOIN request_payloads + decodeText SSoT 경유.
  //   대화 기능 전용이 아니다(피드 행 펼침 등 어느 화면이든 재사용 가능한 독립 primitive).
  {
    const m = path.match(/^\/api\/requests\/([^/]+)\/payload$/);
    if (m && method === 'GET') {
      const id = decodeURIComponent(m[1]);
      const row = getRequestById(db, id);
      if (!row) return jsonResponse({ success: false, error: 'request not found' }, 404);
      // payload 는 평문 디코드 완료(null 가능 — 본문 없는 행). preview 도 함께 제공(폴백 용도).
      return jsonResponse({
        success: true,
        data: { id: row.id, payload: row.payload ?? null, preview: row.preview ?? null },
      });
    }
  }

  // GET /api/requests/top
  if (path === '/api/requests/top' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '10', 10);
    const sessionId = url.searchParams.get('session_id') || undefined;
    const requests = getTopTokenRequests(db, limit, sessionId);
    return jsonResponse({ success: true, data: requests });
  }

  // GET /api/requests/by-type/:type — ADR-001: 응답 직전 정규화 + anomaly 부여 (ADR-003)
  if (path.match(/^\/api\/requests\/by-type\/[^\/]+$/) && method === 'GET') {
    const type = path.split('/')[4] as 'prompt' | 'tool_call' | 'system';
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10));
    const fromTs = url.searchParams.get('from') ? parseInt(url.searchParams.get('from')!, 10) : undefined;
    const toTs   = url.searchParams.get('to')   ? parseInt(url.searchParams.get('to')!,   10) : undefined;
    const rawRequests = getRequestsByType(db, type, limit, offset, fromTs, toTs);
    const requests = enrichWithAnomalies(db, normalizeRequests(rawRequests));
    return jsonResponse({ success: true, data: requests, meta: { total: requests.length, limit, offset } });
  }

  return null;
};
