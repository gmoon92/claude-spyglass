/**
 * use-meta-docs-panel-resize.test.tsx — useMetaDocsPanelResize 훅 라이브 결선 검증
 *
 * 원본 동치 기준: assets/js/left-panel-vertical-resize.js
 *   - initPanelVerticalResize(#panelVerticalHandle, 프로젝트↔요약카드) → --projects-panel-height /
 *     spyglass:panel-split. metadocs 모드에서 computeAvailable 이 .left-panel 전체 높이를 쓴다.
 *   - initMetaDocsFlowResize(#metaDocsFlowHandle, flow↔카탈로그) → --meta-docs-flow-height /
 *     spyglass:meta-docs-flow-split. topEl(#metaDocsFlowRegion)은 .left-panel 자손이 아니라 normal-path.
 *
 * 전략(use-col-resize.test 선례): React 18 createRoot + act 로 jsdom 마운트해 effect 발화 →
 *   실제 MouseEvent dispatch 로 드래그를 흉내내고 documentElement 의 CSS 변수가 갱신되는지 본다.
 *   jsdom 은 getBoundingClientRect().height 를 0 으로 반환하므로 요소별로 스텁한다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useMetaDocsPanelResize } from '../use-panel-resize';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** getBoundingClientRect().height 스텁(jsdom 은 0 반환). */
function stubRectHeight(el: Element, height: number): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 0, height, top: 0, left: 0, right: 0, bottom: height, x: 0, y: 0 }),
  });
}

function mouse(type: string, clientY: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
}

/** metadocs 좌측 패널 + flow/카탈로그 골격을 useMetaDocsPanelResize 와 함께 마운트. */
function Host(): ReturnType<typeof createElement> {
  const { vTopHandleRef, vProjectsRef, flowHandleRef, catalogAreaRef } = useMetaDocsPanelResize();
  return createElement(
    'aside',
    { className: 'left-panel' },
    createElement('div', { id: 'browserProjectsSection', ref: vProjectsRef }),
    createElement('div', { className: 'panel-vertical-handle', id: 'panelVerticalHandle', ref: vTopHandleRef }),
    createElement('div', { id: 'metaDocsSummaryCards' }),
    // metaDocsBody: flow-region + flow handle + catalog-area
    createElement('div', { id: 'metaDocsBody' },
      createElement('div', { id: 'metaDocsFlowRegion', className: 'meta-docs-flow-region' }),
      createElement('div', { className: 'panel-vertical-handle meta-docs-flow-handle', id: 'metaDocsFlowHandle', ref: flowHandleRef }),
      createElement('div', { className: 'meta-docs-catalog-area', ref: catalogAreaRef }),
    ),
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.style.removeProperty('--projects-panel-height');
  document.documentElement.style.removeProperty('--meta-docs-flow-height');
  document.body.dataset.appMode = 'metadocs'; // computeAvailable metadocs 분기 활성
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete document.body.dataset.appMode;
});

function mount() {
  root = createRoot(container);
  act(() => root.render(createElement(Host)));
}

describe('useMetaDocsPanelResize — #panelVerticalHandle(프로젝트 ↔ 요약카드)', () => {
  it('드래그 시 --projects-panel-height 가 갱신된다', () => {
    mount();
    const aside = container.querySelector('.left-panel')!;
    const projects = container.querySelector('#browserProjectsSection')!;
    const handle = container.querySelector('#panelVerticalHandle')!;
    // metadocs 분기: available = .left-panel 전체 높이. projects 시작 높이도 스텁.
    stubRectHeight(aside, 600);
    stubRectHeight(projects, 200);

    act(() => handle.dispatchEvent(mouse('mousedown', 100)));
    // delta +120 → newTopH = 200+120 = 320; ratio = 320/600; clamp(80, 600-80=520, 320) = 320px
    act(() => document.dispatchEvent(mouse('mousemove', 220)));
    expect(document.documentElement.style.getPropertyValue('--projects-panel-height')).toBe('320px');

    act(() => document.dispatchEvent(mouse('mouseup', 220)));
    // mouseup 시 비율 저장(spyglass:panel-split).
    expect(localStorage.getItem('spyglass:panel-split')).not.toBeNull();
  });
});

describe('useMetaDocsPanelResize — #metaDocsFlowHandle(flow ↔ 카탈로그)', () => {
  it('드래그 시 --meta-docs-flow-height 가 갱신된다', () => {
    mount();
    const flowRegion = container.querySelector('#metaDocsFlowRegion')!;
    const catalog = container.querySelector('.meta-docs-catalog-area')!;
    const handle = container.querySelector('#metaDocsFlowHandle')!;
    // flow handle: topEl=#metaDocsFlowRegion 은 .left-panel 자손이지만 동일 metadocs 분기를 타므로
    //   .left-panel 높이가 available 이 된다. aside 높이를 스텁해 결정론 확보.
    const aside = container.querySelector('.left-panel')!;
    stubRectHeight(aside, 800);
    stubRectHeight(flowRegion, 380);
    stubRectHeight(catalog, 300);

    act(() => handle.dispatchEvent(mouse('mousedown', 100)));
    // delta +100 → newTopH = 380+100 = 480; clamp(80, 800-80=720, 480)=480px
    act(() => document.dispatchEvent(mouse('mousemove', 200)));
    expect(document.documentElement.style.getPropertyValue('--meta-docs-flow-height')).toBe('480px');

    act(() => document.dispatchEvent(mouse('mouseup', 200)));
    expect(localStorage.getItem('spyglass:meta-docs-flow-split')).not.toBeNull();
  });

  it('저장 비율 복원 — 마운트 시 rAF 로 --meta-docs-flow-height 적용', async () => {
    localStorage.setItem('spyglass:meta-docs-flow-split', '0.5');
    mount();
    const aside = container.querySelector('.left-panel')!;
    const flowRegion = container.querySelector('#metaDocsFlowRegion')!;
    const catalog = container.querySelector('.meta-docs-catalog-area')!;
    stubRectHeight(aside, 800);
    stubRectHeight(flowRegion, 380);
    stubRectHeight(catalog, 300);
    // rAF 콜백 발화 대기.
    await act(async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    });
    // 0.5 * 800 = 400 → clamp(80,720,400)=400px
    expect(document.documentElement.style.getPropertyValue('--meta-docs-flow-height')).toBe('400px');
  });
});

describe('useMetaDocsPanelResize — cleanup', () => {
  it('언마운트 후 mousedown 이 더 이상 CSS 변수를 바꾸지 않는다', () => {
    mount();
    const handle = container.querySelector('#panelVerticalHandle')! as HTMLElement;
    const aside = container.querySelector('.left-panel')!;
    const projects = container.querySelector('#browserProjectsSection')!;
    stubRectHeight(aside, 600);
    stubRectHeight(projects, 200);
    act(() => root.unmount());
    document.documentElement.style.setProperty('--projects-panel-height', '111px');
    handle.dispatchEvent(mouse('mousedown', 100));
    document.dispatchEvent(mouse('mousemove', 300));
    expect(document.documentElement.style.getPropertyValue('--projects-panel-height')).toBe('111px');
    root = createRoot(document.createElement('div')); // afterEach unmount 안전.
  });
});
