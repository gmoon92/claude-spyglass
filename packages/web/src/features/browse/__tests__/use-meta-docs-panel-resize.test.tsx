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
import { ensureDom } from '../../../test-support/ensure-dom';

// 루트 bun test 에는 jsdom 전역이 없으므로 라이브 DOM(+ requestAnimationFrame)을 보장한다.
//   vitest 에서는 no-op. 두 러너 모두에서 동일한 드래그/rAF 복원 경로가 동작한다.
ensureDom();

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

/** 수평 드래그용 MouseEvent(clientX). */
function mouseX(type: string, clientX: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, clientX });
}

/** getBoundingClientRect().width 스텁(jsdom 은 0 반환). */
function stubRectWidth(el: Element, width: number): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0 }),
  });
}

/** metadocs 좌측 패널 + flow/카탈로그 골격을 useMetaDocsPanelResize 와 함께 마운트. */
function Host(): ReturnType<typeof createElement> {
  const { panelRef, widthHandleRef, vTopHandleRef, vProjectsRef, flowHandleRef, catalogAreaRef } =
    useMetaDocsPanelResize();
  return createElement(
    'aside',
    { className: 'left-panel', ref: panelRef },
    createElement('div', { className: 'panel-resize-handle', ref: widthHandleRef }),
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
  document.documentElement.style.removeProperty('--left-panel-width');
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

describe('useMetaDocsPanelResize — .panel-resize-handle(수평 너비 — metadocs 좌측 패널 resize 회귀 복원)', () => {
  it('훅이 panelRef·widthHandleRef 를 제공한다(좌측 패널 너비 resize 결선 가능)', () => {
    mount();
    // 핸들 엘리먼트가 마운트되어 ref 가 결선됐는지 확인(미제공 시 metadocs 좌우 resize 누락 회귀).
    expect(container.querySelector('.panel-resize-handle')).not.toBeNull();
  });

  it('드래그 시 --left-panel-width 가 갱신되고 mouseup 에 너비가 저장된다', () => {
    mount();
    const panel = container.querySelector('.left-panel')!;
    const handle = container.querySelector('.panel-resize-handle')!;
    stubRectWidth(panel, 224); // 시작 너비(design-tokens 기본).

    act(() => handle.dispatchEvent(mouseX('mousedown', 100)));
    // delta +100 → 324px. clamp(180, 480, 324)=324px (jsdom getComputedStyle 빈값 → 폴백 min/max).
    act(() => document.dispatchEvent(mouseX('mousemove', 200)));
    expect(document.documentElement.style.getPropertyValue('--left-panel-width')).toBe('324px');

    // mouseup 후 panel 실측 너비를 'spyglass:panel-width' 로 저장(stub 224 → "224").
    act(() => document.dispatchEvent(mouseX('mouseup', 200)));
    expect(localStorage.getItem('spyglass:panel-width')).toBe('224');
  });

  it('clamp — min(180px) 이하로는 줄지 않는다', () => {
    mount();
    const panel = container.querySelector('.left-panel')!;
    const handle = container.querySelector('.panel-resize-handle')!;
    stubRectWidth(panel, 224);
    act(() => handle.dispatchEvent(mouseX('mousedown', 300)));
    // delta -300 → -76px → clamp 최소 180px.
    act(() => document.dispatchEvent(mouseX('mousemove', 0)));
    expect(document.documentElement.style.getPropertyValue('--left-panel-width')).toBe('180px');
    act(() => document.dispatchEvent(mouseX('mouseup', 0)));
  });

  it('마운트 시 저장 너비 복원 — localStorage spyglass:panel-width → --left-panel-width', () => {
    localStorage.setItem('spyglass:panel-width', '300');
    mount();
    // 300 은 [180,480] 범위 내 → 그대로 적용.
    expect(document.documentElement.style.getPropertyValue('--left-panel-width')).toBe('300px');
  });
});

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
