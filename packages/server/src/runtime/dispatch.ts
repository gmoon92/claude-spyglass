/**
 * 최상위 HTTP 요청 디스패처 — 경로 prefix별로 도메인 핸들러 라우팅.
 *
 * 변경 이유: 최상위 경로 추가/제거 (/v1, /collect, /events, /api, /health, /, /assets, favicon) 시
 * 한 곳만 수정.
 */

import { fileURLToPath } from 'node:url';
import { join as pathJoin } from 'node:path';
import { handleHookHttpRequest } from '../hook';
import { eventsCollectHandler } from '../events';
import { apiRouter, invalidateDashboardCache } from '../api';
import { sseRouter } from '../sse';
import { handleProxy } from '../proxy';
import type { SpyglassDatabase } from '@spyglass/storage';
import { corsHeaders, preflightResponse } from '@spyglass/types';

/**
 * web 정적 파일 루트 — packaged(Electron desktop) 환경에서는 `SPYGLASS_WEB_ROOT`
 * env 가 절대 경로를 주입한다. 미설정(dev)이면 `import.meta.url` 기반 워크스페이스
 * 상대 경로(`packages/web`)로 fallback.
 *
 * 변경 이유: Bun standalone executable에서 `import.meta.url`이 가상 파일시스템
 * 경로(`/$bunfs/root/...`)를 반환해 실제 파일에 도달 불가. Electron 메인이 동봉
 * 위치(`process.resourcesPath/app/web`)를 env 로 주입한다.
 */
const WEB_ROOT: string = process.env.SPYGLASS_WEB_ROOT
  ? process.env.SPYGLASS_WEB_ROOT
  : fileURLToPath(new URL('../../../web/dist/', import.meta.url));

/** web 디렉토리 안 파일을 Bun.file 로 반환. subPath 는 '/' 로 시작하는 URL path. */
function webFile(subPath: string) {
  return Bun.file(pathJoin(WEB_ROOT, subPath.replace(/^\//, '')));
}

/**
 * 메인 요청 핸들러
 */
export async function handleRequest(req: Request, db: SpyglassDatabase): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // CORS 프리플라이트 — origin 허용 판단·헤더 부여는 SSoT(preflightResponse)가 책임.
  if (req.method === 'OPTIONS') {
    return preflightResponse(req);
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
            ...corsHeaders(req),
          },
        }
      );
    }

    // 루트 경로 — Accept: application/json 시 API info, 그 외 웹 대시보드 HTML.
    if (path === '/') {
      const accept = req.headers.get('accept') ?? '';
      if (accept.includes('application/json')) {
        return new Response(
          JSON.stringify({
            name: 'spyglass',
            version: '0.1.0',
            endpoints: [
              '/health',
              '/api/dashboard',
              '/api/stats/sessions',
              '/api/stats/requests',
              '/api/stats/cache',
              '/api/stats/proxy',
              '/api/stats/proxy/by-model',
              '/api/metrics/cache-trend',
              '/events',
              '/collect',
            ],
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }
      const file = webFile('/index.html');
      if (await file.exists()) {
        return new Response(file, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      return new Response(
        JSON.stringify({ name: 'spyglass', version: '0.1.0', endpoints: [] }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 정적 자산 서빙 (/assets/ prefix → WEB_ROOT/assets/ = packages/web/dist/assets/)
    // dist/assets 에는 Vite 번들(index-<hash>.js[.map])과 classic 자산(css/·js/, vite.config closeBundle 복사)이 공존.
    if (path.startsWith('/assets/')) {
      const safePath = path.split('?')[0].replace(/\.\./g, '');
      const file = webFile(safePath);
      if (await file.exists()) {
        const ext = safePath.split('.').pop() ?? '';
        const mimeMap: Record<string, string> = {
          js:  'application/javascript',
          css: 'text/css',
          svg: 'image/svg+xml',
          ico: 'image/x-icon',
          // P4-10/P1-02 §4: Vite sourcemap(dist/assets/index-<hash>.js.map) 산출됨.
          // octet-stream 으로 서빙되면 브라우저가 sourcemap 로드를 거부할 수 있음.
          map: 'application/json',
        };
        return new Response(file, {
          headers: { 'Content-Type': mimeMap[ext] ?? 'application/octet-stream' },
        });
      }
    }

    // i18n 로케일 서빙 (/locales/ prefix → packages/web/locales/)
    if (path.startsWith('/locales/')) {
      const safePath = path.split('?')[0].replace(/\.\./g, '');
      const file = webFile(safePath);
      if (await file.exists()) {
        return new Response(file, {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=300',
          },
        });
      }
    }

    // favicon 서빙 (하위 호환)
    if (/^\/(favicon\.svg|favicon\.ico)/.test(path)) {
      const fileName = path.split('?')[0].slice(1);
      const file = webFile('/' + fileName);
      if (await file.exists()) {
        const ext = fileName.split('.').pop();
        const mime = ext === 'svg' ? 'image/svg+xml' : 'image/x-icon';
        return new Response(file, { headers: { 'Content-Type': mime } });
      }
    }

    // SPA fallback (P4-10 / P1-02 §5-2): React Router v6 직접진입·새로고침(/meta-docs, /settings 등)이
    // 404 가 되지 않도록 잔여 GET 을 index.html 로 폴백한다. api/events/collect/v1/health/assets/locales/
    // favicon 분기는 이 지점 이전에 이미 return 하므로, 여기 도달하는 건 라우터가 클라이언트에서
    // 처리할 경로뿐이다. Accept 가 application/json 인 GET(프로그램 호출)은 폴백에서 제외 → 404 유지.
    if (req.method === 'GET' && !(req.headers.get('accept') ?? '').includes('application/json')) {
      const file = webFile('/index.html');
      if (await file.exists()) {
        return new Response(file, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
    }

    // 404
    return new Response(
      JSON.stringify({ error: 'Not found', path }),
      {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders(req),
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
          ...corsHeaders(req),
        },
      }
    );
  }
}
