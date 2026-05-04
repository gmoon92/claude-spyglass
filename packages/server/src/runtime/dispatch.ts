/**
 * 최상위 HTTP 요청 디스패처 — 경로 prefix별로 도메인 핸들러 라우팅.
 *
 * 변경 이유: 최상위 경로 추가/제거 (/v1, /collect, /events, /api, /health, /, /assets, favicon) 시
 * 한 곳만 수정.
 */

import { handleHookHttpRequest } from '../hook';
import { eventsCollectHandler } from '../events';
import { apiRouter, invalidateDashboardCache } from '../api';
import { sseRouter } from '../sse';
import { handleProxy } from '../proxy';
import type { SpyglassDatabase } from '@spyglass/storage';

/**
 * 메인 요청 핸들러
 */
export async function handleRequest(req: Request, db: SpyglassDatabase): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // CORS 프리플라이트
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  try {
    // /v1/* — Anthropic API 프록시 (ANTHROPIC_BASE_URL 설정 시 활성화)
    if (path.startsWith('/v1/')) {
      return handleProxy(req, url, db.instance);
    }

    // /collect 엔드포인트 — raw Claude Code hook payload 수신 후 서버에서 정제
    if (path === '/collect') {
      const result = await handleHookHttpRequest(req, db);
      // 캐시 무효화 (SSE 브로드캐스트는 handleCollect 내부 broadcastNewRequest가 담당)
      if (result.status === 200) invalidateDashboardCache();
      return result;
    }

    // /events: POST = raw hook 수집, GET = SSE 스트림
    if (path === '/events') {
      if (req.method === 'POST') {
        return eventsCollectHandler(req, db.instance);
      }
      return sseRouter(req);
    }

    // /api/* REST API
    if (path.startsWith('/api/')) {
      return apiRouter(req, db.instance);
    }

    // /health 헬스체크
    if (path === '/health') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          timestamp: Date.now(),
          version: '0.1.0',
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // 루트 경로 - 웹 대시보드
    if (path === '/') {
      const webDir = new URL('../../../web/index.html', import.meta.url);
      const file = Bun.file(webDir);
      if (await file.exists()) {
        return new Response(file, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      return new Response(
        JSON.stringify({ name: 'spyglass', version: '0.1.0' }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 정적 자산 서빙 (/assets/ prefix → packages/web/assets/)
    if (path.startsWith('/assets/')) {
      const safePath = path.split('?')[0].replace(/\.\./g, '');
      const staticFile = new URL(`../../../web${safePath}`, import.meta.url);
      const file = Bun.file(staticFile);
      if (await file.exists()) {
        const ext = safePath.split('.').pop() ?? '';
        const mimeMap: Record<string, string> = {
          js:  'application/javascript',
          css: 'text/css',
          svg: 'image/svg+xml',
          ico: 'image/x-icon',
        };
        return new Response(file, {
          headers: { 'Content-Type': mimeMap[ext] ?? 'application/octet-stream' },
        });
      }
    }

    // favicon 서빙 (하위 호환)
    if (/^\/(favicon\.svg|favicon\.ico)/.test(path)) {
      const fileName = path.split('?')[0].slice(1);
      const staticFile = new URL(`../../../web/${fileName}`, import.meta.url);
      const file = Bun.file(staticFile);
      if (await file.exists()) {
        const ext = fileName.split('.').pop();
        const mime = ext === 'svg' ? 'image/svg+xml' : 'image/x-icon';
        return new Response(file, { headers: { 'Content-Type': mime } });
      }
    }

    // 404
    return new Response(
      JSON.stringify({ error: 'Not found', path }),
      {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('[Server] Error handling request:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}
