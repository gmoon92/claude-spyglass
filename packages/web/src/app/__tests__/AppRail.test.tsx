/**
 * AppRail.test.tsx — 좌측 앱 모드 rail TSX 동작 동치 (P4-09)
 *
 * 원본: assets/js/app-rail.js (initAppRail/setRailActive/syncRailButtons) +
 *   index.html .app-rail aside(:130-165, 3 모드 버튼).
 *
 * 전략:
 *  - 마크업/aria-current 계약: renderToStaticMarkup 으로 검증(원본 syncRailButtons 1:1).
 *    AppRail 이 react-i18next useTranslation 으로 직접 구독 → vitest.setup 기본 passthrough t.
 *  - 클릭 배선: 컴포넌트가 hook 을 쓰므로 createRoot+act 라이브 렌더 후 DOM 버튼 click.
 *
 * 신규 계약(원본 대비): rail 은 controlled — appMode prop 으로 aria-current 를 선언적으로 도출하고
 *   onSelect 콜백에 raw mode 만 전달(app-rail.js 의 applyAppMode 주입 패턴 1:1).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ensureDom } from '../../test-support/ensure-dom';
import { AppRail, APP_RAIL_MODES } from '../AppRail';

ensureDom();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('AppRail — 마크업 계약', () => {
  it('3 모드 버튼(browse/metadocs/settings)을 data-app-mode 로 노출한다', () => {
    const html = renderToStaticMarkup(<AppRail appMode="browse" onSelect={() => {}} />);
    for (const mode of APP_RAIL_MODES) {
      expect(html).toContain(`data-app-mode="${mode}"`);
    }
  });

  it('.app-rail aside + aria-label 을 노출한다(index.html :130 1:1)', () => {
    const html = renderToStaticMarkup(<AppRail appMode="browse" onSelect={() => {}} />);
    expect(html).toContain('class="app-rail"');
    expect(html).toContain('aria-label');
  });

  it('활성 모드 버튼에만 aria-current="page" 가 부여된다(syncRailButtons 1:1)', () => {
    const html = renderToStaticMarkup(<AppRail appMode="metadocs" onSelect={() => {}} />);
    // metadocs 버튼은 aria-current, 나머지는 미부여 — aria-current 출현 횟수 정확히 1.
    const occurrences = html.match(/aria-current="page"/g) ?? [];
    expect(occurrences.length).toBe(1);
    // metadocs 버튼 마크업 안에 aria-current 가 들어있는지 — 버튼 순서 무관 단정 위해 슬라이스 검사.
    const metaIdx = html.indexOf('data-app-mode="metadocs"');
    const slice = html.slice(metaIdx - 120, metaIdx + 120);
    expect(slice).toContain('aria-current="page"');
  });

  it('appMode=settings 일 때 settings 버튼이 활성(aria-current)', () => {
    const html = renderToStaticMarkup(<AppRail appMode="settings" onSelect={() => {}} />);
    const settingsIdx = html.indexOf('data-app-mode="settings"');
    const slice = html.slice(settingsIdx - 120, settingsIdx + 120);
    expect(slice).toContain('aria-current="page"');
  });
});

describe('AppRail — 클릭 배선', () => {
  let container: HTMLElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = '';
  });

  it('버튼 클릭 시 onSelect(mode) 가 호출된다(app-rail.js 클릭 위임 1:1)', () => {
    const calls: string[] = [];
    act(() => root.render(<AppRail appMode="browse" onSelect={(m) => calls.push(m)} />));
    const buttons = container.querySelectorAll('[data-app-mode]');
    expect(buttons.length).toBe(3);
    const metaBtn = container.querySelector<HTMLElement>('[data-app-mode="metadocs"]')!;
    expect(metaBtn).toBeTruthy();
    act(() => metaBtn.click());
    expect(calls).toEqual(['metadocs']);
  });
});
