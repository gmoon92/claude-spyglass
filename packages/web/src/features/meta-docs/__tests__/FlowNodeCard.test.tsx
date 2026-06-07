/**
 * FlowNodeCard.test.tsx — xyflow 커스텀 노드 카드의 시각 산출물 + 재중심 콜백 검증.
 *
 * 구 makeNodeFO(명령형) 의 산출물(아이콘/title/ds-chip/sub/sub-row/meta-pills/className/tone)을
 *   JSX 컴포넌트가 동등하게 낸다는 특성화. Handle 이 ReactFlowProvider 컨텍스트를 요구하므로 Provider 로 감싼다
 *   (vitest.setup 의 ResizeObserver/DOMMatrix stub 가 jsdom 공백 보정).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { ensureDom } from '../../../test-support/ensure-dom';
import { FlowNodeCard, FlowRecenterContext } from '../FlowNodeCard';
import type { FlowCardNode, FlowNodeData } from '../flow-adapter';
import type { FlowActiveRow } from '../flow-types';

ensureDom();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

/** NodeProps 부분 객체 — 카드 렌더에 필요한 id/data 만 채우고 나머지는 캐스팅. */
function nodeProps(data: FlowNodeData): NodeProps<FlowCardNode> {
  return { id: String(data.id ?? 'n'), data, type: 'card', selected: false, isConnectable: false, dragging: false, zIndex: 0, positionAbsoluteX: 0, positionAbsoluteY: 0, deletable: true, selectable: true, draggable: true } as unknown as NodeProps<FlowCardNode>;
}

function renderCard(data: FlowNodeData, recenter?: (row: FlowActiveRow) => void): void {
  act(() =>
    root.render(
      <ReactFlowProvider>
        <FlowRecenterContext.Provider value={recenter ?? null}>
          <FlowNodeCard {...nodeProps(data)} />
        </FlowRecenterContext.Provider>
      </ReactFlowProvider>,
    ),
  );
}

const centerData = {
  id: 'center', kind: 'skill', type: 'center', title: 'commit', depth: 0, column: 0, slot: 0,
  layerTone: 2, count: 12, invocations: 12, pills: ['hot'], w: 180, h: 56,
} as unknown as FlowNodeData;

const spokeData = {
  id: 's1', kind: 'agent', type: 'agent', title: 'backend', depth: 1, column: 1, slot: 0,
  layerTone: 0, count: 4, pct: 0.25, w: 180, h: 56,
} as unknown as FlowNodeData;

describe('FlowNodeCard — center 카드', () => {
  beforeEach(() => renderCard(centerData));

  it('.node.is-center + data-kind + tone style', () => {
    const node = container.querySelector('.node') as HTMLElement;
    expect(node).not.toBeNull();
    expect(node.classList.contains('is-center')).toBe(true);
    expect(node.classList.contains('is-spoke')).toBe(false);
    expect(node.dataset.kind).toBe('skill');
    expect(node.style.getPropertyValue('--card-tone-layer')).toBe('2');
  });

  it('아이콘 SVG + title + HOT pill, center 는 ds-chip 없음', () => {
    expect(container.querySelector('.icon svg')).not.toBeNull();
    expect(container.querySelector('.title')?.textContent).toBe('commit');
    expect(container.querySelector('.meta-pills .pill-hot')?.textContent).toBe('HOT');
    expect(container.querySelector('.ds-chip')).toBeNull();
  });

  it('sub: invocations===count 면 calls 꼬리말 없음(turns 만)', () => {
    const sub = container.querySelector('.sub') as HTMLElement;
    expect(sub.querySelector('b')?.textContent).toBe('12');
    expect(sub.textContent).toContain('turns');
    expect(sub.textContent).not.toContain('calls');
  });
});

describe('FlowNodeCard — spoke 카드', () => {
  it('.is-spoke + .is-hot(depth=1) + ds-chip(AGENT) + sub(% 꼬리말)', () => {
    renderCard(spokeData);
    const node = container.querySelector('.node') as HTMLElement;
    expect(node.classList.contains('is-spoke')).toBe(true);
    expect(node.classList.contains('is-hot')).toBe(true);
    expect(node.dataset.clickable).toBe('1');
    const chip = container.querySelector('.ds-chip') as HTMLElement;
    expect(chip.textContent).toBe('AGENT');
    expect(chip.dataset.tone).toBe('agent');
    expect(container.querySelector('.sub')?.textContent).toContain('25%');
  });
});

describe('FlowNodeCard — sub-row 재중심', () => {
  it('sub-row click → onRecenter({mcp, fullName})', () => {
    const calls: FlowActiveRow[] = [];
    const data = {
      id: 'mcpgrp', kind: 'mcp', type: 'mcp', title: 'playwright', depth: 1, column: 1, slot: 0, layerTone: 0,
      count: 32, pct: 0.4, w: 180, h: 56,
      subRows: [{ fullName: 'mcp__playwright__browser_close', toolName: 'browser_close', count: 16, pct: 20.3 }],
    } as unknown as FlowNodeData;
    renderCard(data, (row) => calls.push(row));
    const subRow = container.querySelector('.sub-row') as HTMLElement;
    expect(subRow.querySelector('.sub-row-name')?.textContent).toBe('browser_close');
    expect(subRow.classList.contains('nodrag')).toBe(true);
    act(() => {
      subRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(calls).toEqual([{ type: 'mcp', name: 'mcp__playwright__browser_close', id: null }]);
  });
});
