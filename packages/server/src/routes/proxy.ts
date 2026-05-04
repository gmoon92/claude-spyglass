/**
 * /api/proxy-requests/* 라우트 — Proxy 도메인.
 *
 * @description
 *   srp-redesign Phase 2: api.ts(406줄) 분해 결과.
 *   변경 이유: "proxy_requests 노출 정책·payload 디코딩 변경".
 *
 *   포함 라우트 (3개):
 *   - GET /api/proxy-requests          — HTTP 레벨 메트릭
 *   - GET /api/proxy-requests/stats    — 프록시 집계 통계
 *   - GET /api/proxy-requests/:id/messages — payload(zstd) 디코드 후 messages 추출
 */

import {
  getProxyRequestById,
  getProxyStats,
  getRecentProxyRequests,
} from '@spyglass/storage';
import { jsonResponse, type RouteHandler } from './_shared';

export const proxyRouter: RouteHandler = (_req, db, url, path, method) => {
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

  return null;
};
