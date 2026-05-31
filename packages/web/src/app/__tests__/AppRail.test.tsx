/**
 * AppRail.test.tsx — 좌측 앱 모드 rail TSX 동작 동치 (P4-09)
 *
 * 원본: assets/js/app-rail.js (initAppRail/setRailActive/syncRailButtons) +
 *   index.html .app-rail aside(:130-165, 3 모드 버튼).
 *
 * 전략(sidebar.test/app-routes.test 선례 — 무 DOM 하네스):
 *  - 마크업/aria-current 계약: renderToStaticMarkup 으로 검증(원본 syncRailButtons 1:1).
 *  - 클릭 배선: 트리에서 버튼 onClick 직접 invoke → onSelect 콜백 호출(원본 클릭 위임 1:1).
 *
 * 신규 계약(원본 대비): rail 은 controlled — appMode prop 으로 aria-current 를 선언적으로 도출하고
 *   onSelect 콜백에 raw mode 만 전달(app-rail.js 의 applyAppMode 주입 패턴 1:1).
 */
import { describe, it, expect } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { AppRail, APP_RAIL_MODES } from '../AppRail';

/** 트리 깊이우선 탐색 — sidebar.test findNode 동일 패턴(함수형 element 1회 호출 후 descend). */
function findAll(node: unknown, pred: (el: ReactElement) => boolean, acc: ReactElement[] = []): ReactElement[] {
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) {
    for (const c of node) findAll(c, pred, acc);
    return acc;
  }
  const el = node as ReactElement & { type?: unknown; props?: Record<string, unknown> };
  if (el.props && pred(el)) acc.push(el);
  // 함수형 컴포넌트 element → 호출해 반환 트리를 탐색(sidebar.test 선례).
  if (typeof el.type === 'function') {
    const rendered = (el.type as (p: unknown) => unknown)(el.props ?? {});
    findAll(rendered, pred, acc);
    return acc;
  }
  if (el.props && el.props.children !== undefined) findAll(el.props.children, pred, acc);
  return acc;
}

const t = (key: string) => key; // i18n 스텁 — 키 passthrough.

describe('AppRail — 마크업 계약', () => {
  it('3 모드 버튼(browse/metadocs/settings)을 data-app-mode 로 노출한다', () => {
    const html = renderToStaticMarkup(<AppRail appMode="browse" onSelect={() => {}} t={t} />);
    for (const mode of APP_RAIL_MODES) {
      expect(html).toContain(`data-app-mode="${mode}"`);
    }
  });

  it('.app-rail aside + aria-label 을 노출한다(index.html :130 1:1)', () => {
    const html = renderToStaticMarkup(<AppRail appMode="browse" onSelect={() => {}} t={t} />);
    expect(html).toContain('class="app-rail"');
    expect(html).toContain('aria-label');
  });

  it('활성 모드 버튼에만 aria-current="page" 가 부여된다(syncRailButtons 1:1)', () => {
    const html = renderToStaticMarkup(<AppRail appMode="metadocs" onSelect={() => {}} t={t} />);
    // metadocs 버튼은 aria-current, 나머지는 미부여 — aria-current 출현 횟수 정확히 1.
    const occurrences = html.match(/aria-current="page"/g) ?? [];
    expect(occurrences.length).toBe(1);
    // metadocs 버튼 마크업 안에 aria-current 가 들어있는지 — 버튼 순서 무관 단정 위해 슬라이스 검사.
    const metaIdx = html.indexOf('data-app-mode="metadocs"');
    const slice = html.slice(metaIdx - 120, metaIdx + 120);
    expect(slice).toContain('aria-current="page"');
  });

  it('appMode=settings 일 때 settings 버튼이 활성(aria-current)', () => {
    const html = renderToStaticMarkup(<AppRail appMode="settings" onSelect={() => {}} t={t} />);
    const settingsIdx = html.indexOf('data-app-mode="settings"');
    const slice = html.slice(settingsIdx - 120, settingsIdx + 120);
    expect(slice).toContain('aria-current="page"');
  });
});

describe('AppRail — 클릭 배선', () => {
  it('버튼 클릭 시 onSelect(mode) 가 호출된다(app-rail.js 클릭 위임 1:1)', () => {
    const calls: string[] = [];
    const tree = <AppRail appMode="browse" onSelect={(m) => calls.push(m)} t={t} />;
    const buttons = findAll(tree, (el) => typeof (el.props as { onClick?: unknown })?.onClick === 'function'
      && typeof (el.props as { 'data-app-mode'?: unknown })?.['data-app-mode'] === 'string');
    expect(buttons.length).toBe(3);
    // metadocs 버튼 onClick invoke → onSelect('metadocs')
    const metaBtn = buttons.find((b) => (b.props as { 'data-app-mode': string })['data-app-mode'] === 'metadocs');
    expect(metaBtn).toBeTruthy();
    (metaBtn!.props as { onClick: () => void }).onClick();
    expect(calls).toEqual(['metadocs']);
  });
});
