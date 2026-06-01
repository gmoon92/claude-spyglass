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
import type { ReactElement } from 'react';
import { Footer } from '../Footer';
import { DashboardWarning } from '../DashboardWarning';
import { SettingsHeader } from '../../features/settings/SettingsHeader';
import { findFirst } from '../../test-support/react-element-walk';

const byClass = (frag: string) => (el: ReactElement) => {
  const cls = (el.props as { className?: string })?.className ?? '';
  return typeof cls === 'string' && cls.includes(frag);
};
const t = (key: string) => key;

describe('Footer — 마크업 + 도움말 배선', () => {
  it('.footer + 도움말 버튼을 노출한다(#btnHelpOpen 1:1)', () => {
    const html = renderToStaticMarkup(<Footer onHelp={() => {}} t={t} />);
    expect(html).toContain('class="footer"');
    expect(html).toContain('footer-help-btn');
  });

  it('도움말 버튼 클릭 시 onHelp 가 호출된다', () => {
    let called = 0;
    const tree = <Footer onHelp={() => { called += 1; }} t={t} />;
    const btn = findFirst(tree, byClass('footer-help-btn'));
    expect(btn).toBeTruthy();
    (btn!.props as { onClick: () => void }).onClick();
    expect(called).toBe(1);
  });
});

describe('DashboardWarning — shallow clone 경고', () => {
  it('visible=false 면 미렌더(applyShallowWarning 숨김 1:1)', () => {
    const html = renderToStaticMarkup(
      <DashboardWarning visible={false} onDismiss={() => {}} onCopy={() => {}} t={t} />,
    );
    expect(html).toBe('');
  });

  it('visible=true 면 .dashboard-warning + 명령 코드(git fetch --unshallow)를 노출한다', () => {
    const html = renderToStaticMarkup(
      <DashboardWarning visible onDismiss={() => {}} onCopy={() => {}} t={t} />,
    );
    expect(html).toContain('dashboard-warning');
    expect(html).toContain('git fetch --unshallow'); // 비번역 코드 블록(SSoT).
  });

  it('dismiss 버튼 클릭 시 onDismiss 가 호출된다(localStorage dismiss 결선)', () => {
    let dismissed = 0;
    const tree = <DashboardWarning visible onDismiss={() => { dismissed += 1; }} onCopy={() => {}} t={t} />;
    const btn = findFirst(tree, byClass('dashboard-warning-dismiss'));
    expect(btn).toBeTruthy();
    (btn!.props as { onClick: () => void }).onClick();
    expect(dismissed).toBe(1);
  });

  it('copy 버튼 클릭 시 onCopy(명령문) 가 호출된다', () => {
    const copied: string[] = [];
    const tree = <DashboardWarning visible onDismiss={() => {}} onCopy={(c) => copied.push(c)} t={t} />;
    const btn = findFirst(tree, byClass('dashboard-warning-cmd-copy'));
    expect(btn).toBeTruthy();
    (btn!.props as { onClick: () => void }).onClick();
    expect(copied).toEqual(['git fetch --unshallow']);
  });
});

describe('SettingsHeader — 타이틀 + 진단 새로고침', () => {
  it('.settings-header + 새로고침 버튼을 노출한다(#settingsRefreshBtn 1:1)', () => {
    const html = renderToStaticMarkup(<SettingsHeader onRefresh={() => {}} t={t} />);
    expect(html).toContain('settings-header');
    expect(html).toContain('settings-refresh-btn');
    expect(html).toContain('ui.settings-view.title'); // 타이틀 i18n 키 노출(passthrough).
  });

  it('새로고침 버튼 클릭 시 onRefresh 가 호출된다(전체 진단 재실행)', () => {
    let refreshed = 0;
    const tree = <SettingsHeader onRefresh={() => { refreshed += 1; }} t={t} />;
    const btn = findFirst(tree, byClass('settings-refresh-btn'));
    expect(btn).toBeTruthy();
    (btn!.props as { onClick: () => void }).onClick();
    expect(refreshed).toBe(1);
  });
});
