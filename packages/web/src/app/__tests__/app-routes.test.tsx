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
beforeAll(() => {
  const g = globalThis as unknown as { window?: { I18n?: unknown } };
  g.window = g.window ?? ({} as never);
  (g.window as { I18n: unknown }).I18n = {
    t: (key: string) => key,
    onChange: () => {},
    init: () => Promise.resolve(),
  };
});

/** MemoryRouter 로 경로를 고정해 AppRoutes 를 SSR 마크업으로 렌더한다. */
function renderAt(path: string): string {
  const tree: ReactElement = (
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>
  );
  return renderToStaticMarkup(tree);
}

describe('AppRoutes — 경로 → 레이아웃 마운트 매핑', () => {
  it('"/" → BrowseLayout 마운트', () => {
    const html = renderAt('/');
    // BrowseLayout 은 Fragment(래퍼 div 없음) — .main-layout grid 직계로 left-panel/right-panel 전개.
    expect(html).toContain('data-testid="browse-sidebar"');
    expect(html).toContain('data-testid="browse-main"');
    expect(html).not.toContain('data-testid="meta-docs-layout"');
    expect(html).not.toContain('data-testid="settings-layout"');
  });

  it('"/meta-docs" → MetaDocsLayout 마운트', () => {
    const html = renderAt('/meta-docs');
    expect(html).toContain('data-testid="meta-docs-layout"');
    expect(html).not.toContain('data-testid="browse-layout"');
  });

  it('"/settings" → SettingsLayout 마운트', () => {
    const html = renderAt('/settings');
    expect(html).toContain('data-testid="settings-layout"');
    expect(html).not.toContain('data-testid="browse-layout"');
  });

  it('미지 경로 → BrowseLayout 폴백(main.js applyAppMode 무효값 가드 1:1)', () => {
    const html = renderAt('/no-such-route');
    expect(html).toContain('data-testid="browse-sidebar"');
  });
});

describe('레이아웃 마운트 계약 — 핵심 컨테이너 region', () => {
  it('BrowseLayout 은 좌측 패널 + 차트(timeline) region 을 마운트한다', () => {
    const html = renderAt('/');
    // 좌측 패널 region(Sidebar 호스트) + Chart 의 timeline canvas(SSoT 마커).
    expect(html).toContain('id="timelineChart"');
    expect(html).toContain('data-testid="browse-sidebar"');
    expect(html).toContain('data-testid="browse-main"');
  });

  it('MetaDocsLayout 은 메타 카탈로그 region 을 마운트한다', () => {
    const html = renderAt('/meta-docs');
    expect(html).toContain('data-testid="meta-docs-catalog"');
  });

  it('SettingsLayout 은 6 패널 네비 + 활성 패널 region 을 마운트한다', () => {
    const html = renderAt('/settings');
    expect(html).toContain('data-testid="settings-nav"');
    expect(html).toContain('data-testid="settings-panel"');
    // 6 sub-tab 키가 네비에 존재(diag/hooks/server/graph/sqlite/proxy).
    for (const k of ['diag', 'hooks', 'server', 'graph', 'sqlite', 'proxy']) {
      expect(html).toContain(`data-settings-tab="${k}"`);
    }
  });
});
