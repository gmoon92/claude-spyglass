/**
 * app-shell.test.tsx — AppShell chrome 조립 계약 (P4-09)
 *
 * 원본: index.html 정적 chrome(.app-rail / .footer / #updateModal / #dashboardShallowWarning) +
 *   #errorBanner. P4-06 셸이 좌/우 패널만 조립한 gap(.manual-verify-p4-07 §5)을 메운다.
 *
 * 전략(app-routes.test 선례 — SSR): renderToStaticMarkup 으로 chrome 마운트 구조만 검증.
 *   useEffect 미발화 → SSE/폴링 fetch 미생성(EventSource/네트워크 안전). 배지 초기 loading 렌더.
 *   AppRail/Footer/UpdateBadge/UpdateModal 마운트 + 콘텐츠(children) 슬롯을 단정한다.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { AppShell } from '../AppShell';

// i18n 기본 t(passthrough)는 vitest.setup 가 담당 — window 만 보장(루트 bun test 대응).
beforeAll(() => {
  const g = globalThis as unknown as { window?: object };
  g.window = g.window ?? ({} as never);
});
afterAll(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

function renderShell(children: ReactElement, path = '/'): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <AppShell>{children}</AppShell>
    </MemoryRouter>,
  );
}

describe('AppShell — chrome 마운트', () => {
  it('AppRail(.app-rail) 3 모드 버튼을 마운트한다', () => {
    const html = renderShell(<div data-testid="content-slot" />);
    expect(html).toContain('class="app-rail"');
    for (const mode of ['browse', 'metadocs', 'settings']) {
      expect(html).toContain(`data-app-mode="${mode}"`);
    }
  });

  it('children(콘텐츠 슬롯)을 chrome 안에 렌더한다', () => {
    const html = renderShell(<div data-testid="content-slot">CONTENT</div>);
    expect(html).toContain('data-testid="content-slot"');
    expect(html).toContain('CONTENT');
  });

  it('Footer(.footer) + 도움말 버튼을 마운트한다', () => {
    const html = renderShell(<div />);
    expect(html).toContain('class="footer"');
    expect(html).toContain('footer-help-btn');
  });

  it('UpdateBadge(초기 loading) + UpdateModal(overlay)을 마운트한다', () => {
    const html = renderShell(<div />);
    expect(html).toContain('update-badge--loading'); // 폴링 미발화(SSR) → 초기 loading.
    expect(html).toContain('update-modal-overlay');
    expect(html).not.toContain('update-modal-overlay open'); // 초기 닫힘.
  });

  it('연결 정상 초기 상태 → ErrorBanner 미렌더(SSE onError 전)', () => {
    const html = renderShell(<div />);
    expect(html).not.toContain('class="error-banner"');
  });

  it('rail 활성 모드는 현재 경로를 따른다(/settings → settings aria-current)', () => {
    const html = renderShell(<div />, '/settings');
    const idx = html.indexOf('data-app-mode="settings"');
    expect(html.slice(idx - 120, idx + 120)).toContain('aria-current="page"');
  });
});
