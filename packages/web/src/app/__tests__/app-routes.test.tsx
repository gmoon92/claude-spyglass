/**
 * app-routes.test.tsx — React Router v6 라우트→레이아웃 마운트 계약 (P4-06)
 *
 * 원본: main.js applyAppMode(:73-123, body[data-app-mode] CSS 라우팅).
 *   → 선언적 React Router v6 routes 로 전환. appMode 3종을 3 경로/3 레이아웃에 매핑.
 *
 * 검증 전략(SSR — task TDD §2):
 *   renderToStaticMarkup 은 useEffect 를 발화하지 않으므로(SSE/EventSource 미생성),
 *   "어떤 경로가 어떤 레이아웃/컨테이너를 마운트하는가"의 구조 계약만 검증한다.
 *   MemoryRouter(initialEntries) 로 진입 경로를 고정 → 마운트된 레이아웃 testid/마커로 단정.
 *
 * 레이아웃 셸은 각자 data-testid(browse-layout/meta-docs-layout/settings-layout)를 노출한다(SSoT 마커).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { AppRoutes } from '../App';

// 컨테이너(SessionRow/SystemPromptLibrary 등)가 window.I18n 을 참조 → 테스트 스텁(sidebar.test 선례).
beforeAll(async () => {
  const g = globalThis as unknown as { window?: { I18n?: unknown } };
  g.window = g.window ?? ({} as never);
  (g.window as { I18n: unknown }).I18n = {
    t: (key: string) => key,
    onChange: () => {},
    init: () => Promise.resolve(),
  };
  // lazy 라우트 모듈(MetaDocs/Settings) 프리로드 — ESM 캐시 워밍. App.tsx 의 React.lazy 가 동일 모듈을
  //   import 하므로, 캐시가 데워지면 renderAt 의 flush 루프에서 즉시 resolve 된다(무거운 모듈 그래프의
  //   dynamic import 가 동기 setTimeout flush 만으로는 제때 안 끝나는 문제 회피).
  await Promise.all([import('../MetaDocsLayout'), import('../SettingsLayout')]);
});

/**
 * MemoryRouter 로 경로를 고정해 AppRoutes 를 SSR 마크업으로 렌더한다.
 *
 * lazy 라우트(MetaDocs/Settings, React.lazy) 대응: 동기 renderToStaticMarkup 1회로는 Suspense
 *   fallback(null)만 나오므로, (1) 1차 렌더로 lazy import 를 트리거하고 (2) 마이크로태스크를 flush 해
 *   React.lazy promise 를 resolve 시킨 뒤 (3) 2차 렌더로 실제 레이아웃 마크업을 얻는다.
 *   renderToStaticMarkup 은 useEffect 를 발화하지 않으므로(SSE/EventSource/폴링 미생성) 기존
 *   "효과 없는 순수 구조 검증" 계약은 그대로 유지된다(클라이언트 렌더 전환 아님).
 */
async function renderAt(path: string): Promise<string> {
  const tree: ReactElement = (
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>
  );
  // 1차 렌더로 lazy 로더(MetaDocs/Settings)를 트리거한다. Suspense fallback=null 이라 suspend 중에는
  //   마크업이 빈 문자열('')이다 → 이를 "아직 미해결" 신호로 삼아, 비어있지 않을 때까지 flush+재렌더.
  //   browse/미지 경로(동기)는 1차에 즉시 non-empty → 루프 미진입. 모듈 그래프가 커 import resolve 가
  //   여러 tick 걸릴 수 있어 최대 20회 macrotask flush(상한 — 무한루프 가드).
  let html = renderToStaticMarkup(tree);
  for (let i = 0; i < 20 && html.trim() === ''; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    html = renderToStaticMarkup(tree);
  }
  return html;
}

describe('AppRoutes — 경로 → 레이아웃 마운트 매핑', () => {
  it('"/" → BrowseLayout 마운트', async () => {
    const html = await renderAt('/');
    // BrowseLayout 은 Fragment(래퍼 div 없음) — .main-layout grid 직계로 left-panel/right-panel 전개.
    expect(html).toContain('data-testid="browse-sidebar"');
    expect(html).toContain('data-testid="browse-main"');
    expect(html).not.toContain('data-testid="meta-docs-root"');
    expect(html).not.toContain('data-testid="settings-layout"');
  });

  it('"/meta-docs" → MetaDocsLayout 마운트', async () => {
    const html = await renderAt('/meta-docs');
    expect(html).toContain('data-testid="meta-docs-root"');
    expect(html).not.toContain('data-testid="browse-main"');
  });

  it('"/settings" → SettingsLayout 마운트', async () => {
    const html = await renderAt('/settings');
    expect(html).toContain('data-testid="settings-layout"');
    expect(html).not.toContain('data-testid="browse-layout"');
  });

  it('미지 경로 → BrowseLayout 폴백(main.js applyAppMode 무효값 가드 1:1)', async () => {
    const html = await renderAt('/no-such-route');
    expect(html).toContain('data-testid="browse-sidebar"');
  });
});

describe('레이아웃 마운트 계약 — 핵심 컨테이너 region', () => {
  it('BrowseLayout 은 좌측 패널 + 차트(timeline) region 을 마운트한다', async () => {
    const html = await renderAt('/');
    // 좌측 패널 region(Sidebar 호스트) + Chart 의 timeline canvas(SSoT 마커).
    expect(html).toContain('id="timelineChart"');
    expect(html).toContain('data-testid="browse-sidebar"');
    expect(html).toContain('data-testid="browse-main"');
  });

  it('MetaDocsLayout 은 메타 카탈로그 region 을 마운트한다', async () => {
    const html = await renderAt('/meta-docs');
    expect(html).toContain('class="meta-docs-catalog-area"');
  });

  it('SettingsLayout 은 4 패널 네비 + 활성 패널 region 을 마운트한다', async () => {
    const html = await renderAt('/settings');
    expect(html).toContain('data-testid="settings-nav"');
    expect(html).toContain('data-testid="settings-panel"');
    // 4 sub-tab 키가 네비에 존재(Hook·Proxy→integration, SQLite·Graph→storage 통합).
    for (const k of ['diag', 'integration', 'storage', 'server']) {
      expect(html).toContain(`data-settings-tab="${k}"`);
    }
  });
});
