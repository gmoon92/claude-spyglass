/**
 * meta-docs-flow-render.test.tsx — MetaDocsFlow effect 렌더 특성화(characterization) (vanilla-js-audit)
 *
 * 목적: 명령형 → 선언형 축소 전환의 1:1 동치 게이트. effect 가 fetch 후 실제로 그리는
 *   DOM(엣지 path d 형식 / viewBox / 노드 아이콘 svg / 통계 텍스트 / 칩 / sub-row / pill)을
 *   jsdom 에서 고정한다. 전환 전/후 동일 출력이어야 한다.
 *
 * 주의: jsdom 은 SVG layout(offsetWidth/getBBox/getScreenCTM)을 계산하지 않으므로
 *   resizeNodeToContent 측정·computeFitView 는 폴백 경로를 탄다(노드 카드 측정은 본질적 명령형
 *   영역이라 본 테스트의 정밀 좌표 검증 범위 밖). 본 테스트는 측정 비의존 산출물
 *   (아이콘/텍스트/엣지 path 존재·형식/viewBox/칩/pill/sub-row)만 검증한다.
 *
 * 패턴: meta-docs-catalog-colresize.test.tsx 와 동형(createRoot + act + ensureDom).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MetaDocsFlow } from '../MetaDocsFlow';
import type { RawFlowNode, FlowColumn } from '../flow-layout';
import { ensureDom } from '../../../test-support/ensure-dom';

ensureDom();
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = (k: string) => k;

const NODES: RawFlowNode[] = [
  { id: 'c1', type: 'center', data: { kind: 'agent', name: 'designer', depth: 0, count: 10, invocations: 12 } },
  { id: 's1', type: 'spoke', data: { kind: 'skill', name: 'committer', depth: 1, count: 4, pct: 0.4 } },
  {
    id: 's2',
    type: 'spoke',
    data: {
      kind: 'mcp',
      name: 'playwright',
      depth: 1,
      count: 2,
      pct: 0.2,
      subRows: [{ fullName: 'mcp__pw__click', toolName: 'click', count: 3, pct: 75 }],
      pills: ['hot', 'live'],
    },
  },
];
const COLUMNS: FlowColumn[] = [{ nodeIds: ['c1'] }, { nodeIds: ['s1', 's2'] }];
const EDGES = [
  { id: 'e1', source: 'c1', target: 's1', type: 'call' },
  { id: 'e2', source: 'c1', target: 's2', type: 'call' },
];
const PAYLOAD = { nodes: NODES, edges: EDGES, columns: COLUMNS, meta: { centerName: 'designer' } };

beforeAll(() => {
  // 루트 bun test(jsdom 부재)용 window 보장. i18n 은 vitest.setup 의 기본 t(passthrough)가 담당.
  (globalThis as unknown as { window?: object }).window ??= {} as never;
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: PAYLOAD }) })),
  );
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/** 마운트 + effect fetch(.then) microtask flush 까지 대기해 SVG 가 그려지게 한다. */
async function mountFlow(): Promise<void> {
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(MetaDocsFlow, { activeRow: { type: 'agent', name: 'designer', id: 1 }, t }));
  });
  // fetch().then 체인(promise microtask) 소진.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('MetaDocsFlow effect 렌더 — 셸/툴바', () => {
  it('fetch 후 flow-svg + 줌/리셋 툴바 + center scope 렌더', async () => {
    await mountFlow();
    expect(container.querySelector('.flow-svg')).not.toBeNull();
    expect(container.querySelector('[data-flow-zoom="in"]')).not.toBeNull();
    expect(container.querySelector('[data-flow-zoom="out"]')).not.toBeNull();
    expect(container.querySelector('[data-seq-reset]')).not.toBeNull();
    expect(container.querySelector('.flow-scope')?.textContent).toContain('designer');
  });

  it('viewBox 가 4값 문자열(x y w h) 형식', async () => {
    await mountFlow();
    const vb = container.querySelector('.flow-svg')?.getAttribute('viewBox') ?? '';
    expect(vb.split(/\s+/).filter(Boolean)).toHaveLength(4);
  });

  it('flowArr marker + edges/nodes layer 셸 구조', async () => {
    await mountFlow();
    expect(container.querySelector('#flowArr')).not.toBeNull();
    expect(container.querySelector('#flowEdgesLayer')).not.toBeNull();
    expect(container.querySelector('#flowNodesLayer')).not.toBeNull();
  });
});

describe('MetaDocsFlow effect 렌더 — 노드 카드', () => {
  it('노드 3개 foreignObject 렌더 + data-node-id', async () => {
    await mountFlow();
    expect(container.querySelectorAll('foreignObject[data-node-id]').length).toBe(3);
  });

  it('center 노드 is-center, spoke 노드 is-spoke + data-clickable', async () => {
    await mountFlow();
    expect(container.querySelector('foreignObject[data-node-id="c1"] .node.is-center')).not.toBeNull();
    const spoke = container.querySelector('foreignObject[data-node-id="s1"] .node') as HTMLElement | null;
    expect(spoke?.classList.contains('is-spoke')).toBe(true);
    expect(spoke?.dataset.clickable).toBe('1');
  });

  it('spoke depth=1 → is-hot 클래스', async () => {
    await mountFlow();
    const spoke = container.querySelector('foreignObject[data-node-id="s1"] .node');
    expect(spoke?.classList.contains('is-hot')).toBe(true);
  });

  it('아이콘 svg 렌더(icon 컨테이너에 <svg>)', async () => {
    await mountFlow();
    expect(container.querySelector('foreignObject[data-node-id="s1"] .node .icon svg')).not.toBeNull();
  });

  it('center 통계 텍스트 "10 turns · 12 calls" (b 강조 10)', async () => {
    await mountFlow();
    const sub = container.querySelector('foreignObject[data-node-id="c1"] .sub');
    expect(sub?.textContent).toContain('turns');
    expect(sub?.textContent).toContain('12 calls');
    expect(sub?.querySelector('b')?.textContent).toBe('10');
  });

  it('spoke 통계 텍스트 "4 turns · 40%"', async () => {
    await mountFlow();
    const sub = container.querySelector('foreignObject[data-node-id="s1"] .sub');
    expect(sub?.textContent).toContain('40%');
    expect(sub?.querySelector('b')?.textContent).toBe('4');
  });

  it('spoke 칩(tone/label) 렌더', async () => {
    await mountFlow();
    const chip = container.querySelector('foreignObject[data-node-id="s1"] .ds-chip') as HTMLElement | null;
    expect(chip).not.toBeNull();
    expect(chip?.dataset.tone).toBe('skill');
    expect(chip?.textContent).toBe('SKILL');
  });

  it('sub-row 렌더 + data-tool-name + 이름/통계', async () => {
    await mountFlow();
    const row = container.querySelector('foreignObject[data-node-id="s2"] .sub-row') as HTMLElement | null;
    expect(row).not.toBeNull();
    expect(row?.dataset.toolName).toBe('mcp__pw__click');
    expect(row?.querySelector('.sub-row-name')?.textContent).toBe('click');
    expect(row?.querySelector('.sub-row-stats')?.textContent).toContain('3');
    expect(row?.querySelector('.sub-row-stats')?.textContent).toContain('75%');
  });

  it('pill(hot/live) 렌더', async () => {
    await mountFlow();
    const pills = container.querySelector('foreignObject[data-node-id="s2"] .meta-pills');
    expect(pills?.querySelector('.pill-hot')?.textContent).toBe('HOT');
    expect(pills?.querySelector('.pill-live')?.textContent).toBe('live');
  });
});

describe('MetaDocsFlow effect 렌더 — 종단 상태(empty/error)', () => {
  it('activeRow null → flow-empty(no-center) 안내 + flow-svg 미생성', async () => {
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(MetaDocsFlow, { activeRow: null, t }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('.flow-empty')).not.toBeNull();
    expect(container.querySelector('.flow-empty-title')?.textContent).toContain('empty-no-center');
    expect(container.querySelector('.flow-svg')).toBeNull();
  });

  it('빈 payload(nodes 0) → flow-empty(zero-turns) 안내', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: { nodes: [], edges: [], columns: [] } }) })),
    );
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(MetaDocsFlow, { activeRow: { type: 'agent', name: 'designer', id: 1 }, t }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('.flow-empty-title')).not.toBeNull();
  });

  it('fetch 실패 → flow-empty(fetch-failed) 안내', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    );
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(MetaDocsFlow, { activeRow: { type: 'agent', name: 'designer', id: 1 }, t }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('.flow-empty-title')?.textContent).toContain('fetch-failed');
  });
});

describe('MetaDocsFlow effect 렌더 — 엣지', () => {
  it('엣지 2개 path 렌더 + data-edge-id + edge-call 클래스 + marker/fill', async () => {
    await mountFlow();
    const paths = container.querySelectorAll('#flowEdgesLayer path[data-edge-id]');
    expect(paths.length).toBe(2);
    const e1 = container.querySelector('path[data-edge-id="e1"]');
    expect(e1?.classList.contains('edge')).toBe(true);
    expect(e1?.classList.contains('edge-call')).toBe(true);
    expect(e1?.getAttribute('marker-end')).toBe('url(#flowArr)');
    expect(e1?.getAttribute('fill')).toBe('none');
  });

  it('엣지 path d 가 베지어 형식(M .. C ..)', async () => {
    await mountFlow();
    const d = container.querySelector('path[data-edge-id="e1"]')?.getAttribute('d') ?? '';
    expect(d.startsWith('M ')).toBe(true);
    expect(d).toContain(' C ');
  });
});
