/**
 * use-tooltip.test.tsx — TooltipLayer(B-1 React Portal) + tooltip-store(A-2 point-hover) 동작 검증.
 *
 * 배경:
 *  - B-1: 과거 useTooltip() 훅은 document.createElement/appendChild/innerHTML 로 floating 툴팁을
 *    명령형 생성했다. TooltipLayer 는 createPortal(document.body) 로 .stat-tooltip/.cache-tooltip 을
 *    선언적으로 렌더한다 — body 에 Portal 노드가 붙고 cleanup 시 사라지는지(라이프사이클) 검증.
 *  - A-2: 차트 데이터 포인트 호버는 document CustomEvent 가 아니라 stores/tooltip-store 구독으로
 *    표시된다 — store.setPointHover/clearPointHover 가 Portal 표시/숨김을 구동하는지 검증.
 *  - 설명 툴팁: document 위임([data-stat-tooltip]/.cache-cell)이 hover 시 Portal 을 띄우는지 검증.
 *
 * 검증 방식: jsdom 라이브 마운트(react-dom/client + act). vitest.setup.ts 가 i18next.t 를 window.I18n.t
 *   로 위임하므로, 키 → 한국어 stub 로 본문 텍스트를 단정한다(키 부재 시 passthrough).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ensureDom } from '../../test-support/ensure-dom';
import { TooltipLayer } from '../use-tooltip';
import { useTooltipStore } from '../../stores/tooltip-store';
import type { CtxPointHoverDetail } from '../../features/dashboard/context-chart-data';

ensureDom();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LABELS: Record<string, string> = {
  'ui.stat-tooltip.point-hover.title': '__TURN__',
  'ui.stat-tooltip.point-hover.accumulated': '__ACC__',
  'ui.chart.count-unit': '__COUNT__',
  'ui.stat-tooltip.sessions.title': '__SESS_TITLE__',
  'ui.stat-tooltip.sessions.desc': '__SESS_DESC__',
};

beforeAll(() => {
  (globalThis as { window?: { I18n?: unknown } }).window ??= {};
  (globalThis as { window: { I18n?: unknown } }).window.I18n = {
    t: (key: string) => LABELS[key] ?? key,
    getLang: () => 'ko',
    onChange: () => {},
    init: () => Promise.resolve(),
  };
  // jsdom 은 innerWidth/innerHeight 를 제공(기본 1024x768). offsetWidth/Height 는 0 → fallback 폭 사용.
});

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  useTooltipStore.setState({ pointHover: null });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

const ctxDetail: CtxPointHoverDetail = {
  turnIndex: 3,
  formattedValue: '12.0K',
  formattedDelta: null,
  windowLabel: null,
  windowModel: null,
  usagePercent: null,
  clientX: 100,
  clientY: 200,
};

describe('TooltipLayer — Portal 라이프사이클(B-1)', () => {
  it('초기엔 body 에 .stat-tooltip/.cache-tooltip Portal 이 없다(호버 전)', () => {
    act(() => root.render(<TooltipLayer />));
    expect(document.querySelector('.stat-tooltip')).toBeNull();
    expect(document.querySelector('.cache-tooltip')).toBeNull();
  });

  it('createElement/appendChild/innerHTML 명령형 흔적 없이 createPortal 로 렌더(소스 정적 가드)', async () => {
    // B-1 핵심: imperative DOM 제거 + createPortal 도입. 소스 텍스트로 회귀를 고정한다.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../use-tooltip.tsx'), 'utf8');
    expect(src).toContain('createPortal');
    // 실제 호출/대입 구문만 가드(주석 산문의 'createElement/appendChild/innerHTML' 언급은 제외).
    expect(src).not.toMatch(/\.createElement\(/);
    expect(src).not.toMatch(/\.appendChild\(/);
    expect(src).not.toMatch(/\.innerHTML\s*=/);
  });
});

describe('TooltipLayer — point-hover store 구독(A-2)', () => {
  it('store.setPointHover(ctx) → .stat-tooltip Portal 에 누적 본문 표시', () => {
    act(() => root.render(<TooltipLayer />));
    act(() => useTooltipStore.getState().setPointHover({ kind: 'ctx', detail: ctxDetail }));
    const el = document.querySelector('.stat-tooltip');
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain('__ACC__'); // accumulated 본문
    expect(el!.querySelector('.stat-tooltip-title')?.textContent).toBe('__TURN__');
  });

  it('store.clearPointHover() → Portal 숨김(다음 설명 툴팁 복원 가능 상태)', () => {
    act(() => root.render(<TooltipLayer />));
    act(() => useTooltipStore.getState().setPointHover({ kind: 'ctx', detail: ctxDetail }));
    expect(document.querySelector('.stat-tooltip')).not.toBeNull();
    act(() => useTooltipStore.getState().clearPointHover());
    expect(document.querySelector('.stat-tooltip')).toBeNull();
  });

  it('timeline kind → 시각 라벨 + count 본문', () => {
    act(() => root.render(<TooltipLayer />));
    act(() =>
      useTooltipStore.getState().setPointHover({
        kind: 'timeline',
        detail: { label: '10:30', count: 7, clientX: 50, clientY: 60 },
      }),
    );
    const el = document.querySelector('.stat-tooltip');
    expect(el).not.toBeNull();
    expect(el!.querySelector('.stat-tooltip-title')?.textContent).toBe('10:30');
    expect(el!.textContent).toContain('__COUNT__');
  });
});

describe('TooltipLayer — 설명 툴팁 document 위임', () => {
  it('[data-stat-tooltip] mouseover → .stat-tooltip Portal 에 title/desc', () => {
    const trigger = document.createElement('div');
    trigger.setAttribute('data-stat-tooltip', 'sessions');
    document.body.appendChild(trigger);
    act(() => root.render(<TooltipLayer />));
    act(() => {
      trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 10, clientY: 10 }));
    });
    const el = document.querySelector('.stat-tooltip');
    expect(el).not.toBeNull();
    expect(el!.querySelector('.stat-tooltip-title')?.textContent).toBe('__SESS_TITLE__');
    expect(el!.textContent).toContain('__SESS_DESC__');
  });

  it('.cache-cell mouseover → .cache-tooltip Portal 에 Read/Write 행', () => {
    const cell = document.createElement('div');
    cell.className = 'cache-cell';
    cell.setAttribute('data-cache-read', '1500');
    cell.setAttribute('data-cache-write', '300');
    document.body.appendChild(cell);
    act(() => root.render(<TooltipLayer />));
    act(() => {
      cell.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 10, clientY: 10 }));
    });
    const el = document.querySelector('.cache-tooltip');
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain('Prompt Cache');
    expect(el!.textContent).toContain('1,500 tokens'); // fmtNum(en-US)
    expect(el!.textContent).toContain('300 tokens'); // write>0 → Write 행
  });

  it('point-hover 활성 중엔 설명 툴팁 mouseover 를 억제(레거시 _pointHoverActive)', () => {
    const trigger = document.createElement('div');
    trigger.setAttribute('data-stat-tooltip', 'sessions');
    document.body.appendChild(trigger);
    act(() => root.render(<TooltipLayer />));
    act(() => useTooltipStore.getState().setPointHover({ kind: 'ctx', detail: ctxDetail }));
    // 포인트호버 표시 중 — 설명 트리거 hover 가 들어와도 수치 툴팁이 유지되어야 한다(억제).
    act(() => {
      trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 10, clientY: 10 }));
    });
    const el = document.querySelector('.stat-tooltip');
    expect(el!.querySelector('.stat-tooltip-title')?.textContent).toBe('__TURN__'); // 포인트호버 본문 유지
  });
});
