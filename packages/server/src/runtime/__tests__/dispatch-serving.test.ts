/**
 * dispatch-serving.test.ts — 정적 서빙 라우팅 계약 가드 (P4-10)
 *
 * 배경:
 *   P4-10 에서 데몬 정적 서빙을 dist 로 전환했다(WEB_ROOT→dist, mimeMap .map, SPA fallback).
 *   이 분기들은 packages/web 빌드 산출(dist/)에 의존하므로, 회귀를 자동으로 잡으려면
 *   handleRequest 를 실제 dist 에 대해 구동해 계약을 단정한다.
 *
 * 경계(D2, .architecture-decision-serving §4-1):
 *   REST/SSE/collect/proxy/health 핸들러 로직은 무수정. 본 테스트는 "정적 자산 라우팅 분기"
 *   (진입 HTML 일원화 · /assets mime · SPA fallback · Accept 가드)만 단정한다.
 *
 * dist 의존:
 *   bun test 게이트는 build 선행을 전제로 하지 않을 수 있으므로, dist/index.html 부재 시
 *   해당 케이스는 스킵(가드)하고 fallback 의 "Accept:json 은 제외" 같은 dist-무관 분기만 단정한다.
 */

import { describe, it, expect, afterAll } from 'bun:test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SpyglassDatabase, closeDatabase } from '@spyglass/storage';
import { handleRequest } from '../dispatch';

const DIST_INDEX = fileURLToPath(new URL('../../../../web/dist/index.html', import.meta.url));
const hasDist = existsSync(DIST_INDEX);

const db = new SpyglassDatabase({ dbPath: `/tmp/spyglass-dispatch-${Date.now()}.db`, autoInit: true });
afterAll(() => closeDatabase());

function get(path: string, accept?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (accept) headers.accept = accept;
  return handleRequest(new Request('http://localhost' + path, { method: 'GET', headers }), db);
}

describe('dispatch 정적 서빙 — Accept 가드 (dist 무관)', () => {
  it('루트(/)에 Accept: application/json 이면 API info JSON 을 반환(HTML 아님)', async () => {
    const res = await get('/', 'application/json');
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body.name).toBe('spyglass');
  });

  it('/api/* 미지 엔드포인트는 SPA fallback 없이 404(REST 무수정)', async () => {
    const res = await get('/api/__no_such__', 'application/json');
    expect(res.status).toBe(404);
  });

  it('비-GET 미매칭은 fallback 없이 404', async () => {
    const res = await handleRequest(
      new Request('http://localhost/__nope__', { method: 'POST' }),
      db,
    );
    expect(res.status).toBe(404);
  });
});

describe.if(hasDist)('dispatch 정적 서빙 — dist 진입/SPA fallback/mime (dist 의존)', () => {
  it('"/" → React 진입 HTML(#react-root) 을 dist 에서 서빙', async () => {
    const res = await get('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('id="react-root"');
  });

  it('React Router 직접진입(/meta-docs, /settings, 딥링크)은 404 아닌 index.html(SPA fallback)', async () => {
    for (const p of ['/meta-docs', '/settings', '/sessions/abc']) {
      const res = await get(p);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(await res.text()).toContain('id="react-root"');
    }
  });

  it('진입 HTML 은 classic i18n 3종 + CSS24 외부화 태그를 포함', async () => {
    const html = await (await get('/')).text();
    for (const s of ['/assets/js/i18n.js', '/assets/js/i18n-dom.js', '/assets/js/lang-switcher.js']) {
      expect(html).toContain(s);
    }
    expect(html).toContain('/assets/css/design-tokens.css');
    expect(html).toContain('/assets/css/design-system/_index.css');
  });

  it('/assets/*.map sourcemap 은 application/json 으로 서빙(mimeMap .map)', async () => {
    // dist 의 실제 해시 번들 .map 경로를 진입 HTML 의 module src 에서 도출.
    const html = await (await get('/')).text();
    const m = html.match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)/);
    expect(m).not.toBeNull();
    const res = await get(`/assets/${m![1]}.map`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('classic CSS/JS 와 locales 가 dist 에서 정상 서빙', async () => {
    const css = await get('/assets/css/design-tokens.css');
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toContain('text/css');

    const js = await get('/assets/js/i18n.js');
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toContain('application/javascript');

    const loc = await get('/locales/ko/ui.json');
    expect(loc.status).toBe(200);
    expect(loc.headers.get('content-type')).toContain('application/json');
  });
});
