/**
 * chrome-misc.test.tsx — Footer / DashboardWarning / SettingsHeader TSX 동작 동치 (P4-09)
 *
 * 원본:
 *  - Footer: index.html .footer(:854-859, 텍스트 + 단축키 도움말 버튼 #btnHelpOpen).
 *  - DashboardWarning: index.html #dashboardShallowWarning(:950-973) + version-check.js applyShallowWarning(:139-147).
 *  - SettingsHeader: index.html #settingsView header(:816-828, 타이틀 + 진단 새로고침 #settingsRefreshBtn).
 *
 * 전략(무 DOM 하네스): 마크업/가시성 renderToStaticMarkup, 콜백 배선 onClick 직접 invoke.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReactElement } from 'react';
import { Footer } from '../Footer';
import { DashboardWarning } from '../DashboardWarning';
import { SettingsHeader } from '../../features/settings/SettingsHeader';
import { ensureDom } from '../../test-support/ensure-dom';

ensureDom();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 컴포넌트(Footer/DashboardWarning/SettingsHeader)는 useTranslation 으로 i18n 을 자체 구독한다(t prop 폐기).
//   useTranslation 사용 컴포넌트는 함수 직접 호출이 불가하므로 콜백 배선은 라이브 렌더 후 호스트 버튼 클릭으로 검증.
function renderLive(el: ReactElement): { container: HTMLElement; cleanup: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(el); });
  return { container, cleanup: () => { act(() => root.unmount()); container.remove(); } };
}

describe('Footer — 마크업 + 도움말 배선', () => {
  it('.footer + 도움말 버튼을 노출한다(#btnHelpOpen 1:1)', () => {
    const html = renderToStaticMarkup(<Footer onHelp={() => {}} />);
    expect(html).toContain('class="footer"');
    expect(html).toContain('footer-help-btn');
  });

  it('도움말 버튼 클릭 시 onHelp 가 호출된다', () => {
    let called = 0;
    const { container, cleanup } = renderLive(<Footer onHelp={() => { called += 1; }} />);
    const btn = container.querySelector<HTMLButtonElement>('.footer-help-btn');
    expect(btn).not.toBeNull();
    act(() => { btn!.click(); });
    expect(called).toBe(1);
    cleanup();
  });
});

describe('DashboardWarning — shallow clone 경고', () => {
  it('visible=false 면 미렌더(applyShallowWarning 숨김 1:1)', () => {
    const html = renderToStaticMarkup(
      <DashboardWarning visible={false} onDismiss={() => {}} onCopy={() => {}} />,
    );
    expect(html).toBe('');
  });

  it('visible=true 면 .dashboard-warning + 명령 코드(git fetch --unshallow)를 노출한다', () => {
    const html = renderToStaticMarkup(
      <DashboardWarning visible onDismiss={() => {}} onCopy={() => {}} />,
    );
    expect(html).toContain('dashboard-warning');
    expect(html).toContain('git fetch --unshallow'); // 비번역 코드 블록(SSoT).
  });

  it('dismiss 버튼 클릭 시 onDismiss 가 호출된다(localStorage dismiss 결선)', () => {
    let dismissed = 0;
    const { container, cleanup } = renderLive(
      <DashboardWarning visible onDismiss={() => { dismissed += 1; }} onCopy={() => {}} />,
    );
    const btn = container.querySelector<HTMLButtonElement>('.dashboard-warning-dismiss');
    expect(btn).not.toBeNull();
    act(() => { btn!.click(); });
    expect(dismissed).toBe(1);
    cleanup();
  });

  it('copy 버튼 클릭 시 onCopy(명령문) 가 호출된다', () => {
    const copied: string[] = [];
    const { container, cleanup } = renderLive(
      <DashboardWarning visible onDismiss={() => {}} onCopy={(c) => copied.push(c)} />,
    );
    const btn = container.querySelector<HTMLButtonElement>('.dashboard-warning-cmd-copy');
    expect(btn).not.toBeNull();
    act(() => { btn!.click(); });
    expect(copied).toEqual(['git fetch --unshallow']);
    cleanup();
  });
});

describe('SettingsHeader — 타이틀 + 진단 새로고침', () => {
  // SettingsHeader 는 useTranslation 으로 i18n 을 자체 구독한다(t prop 폐기) — passthrough 가 키 반환.
  it('.settings-header + 새로고침 버튼을 노출한다(#settingsRefreshBtn 1:1)', () => {
    const html = renderToStaticMarkup(<SettingsHeader onRefresh={() => {}} />);
    expect(html).toContain('settings-header');
    expect(html).toContain('settings-refresh-btn');
    expect(html).toContain('ui:settings-view.title'); // 타이틀 i18n 키 노출(passthrough).
  });

  it('새로고침 버튼 클릭 시 onRefresh 가 호출된다(전체 진단 재실행)', () => {
    // useTranslation 사용 컴포넌트라 함수 직접 호출 불가 → 라이브 렌더 후 호스트 버튼 클릭.
    let refreshed = 0;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<SettingsHeader onRefresh={() => { refreshed += 1; }} />);
    });
    const btn = container.querySelector<HTMLButtonElement>('.settings-refresh-btn');
    expect(btn).not.toBeNull();
    act(() => { btn!.click(); });
    expect(refreshed).toBe(1);
    act(() => root.unmount());
    container.remove();
  });
});
