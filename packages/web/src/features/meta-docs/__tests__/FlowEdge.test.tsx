/**
 * FlowEdge.test.tsx — floating edge 의 박스 변환 + className 조합 검증.
 *
 * useInternalNode/BaseEdge 를 mock 해 측정 노드 박스를 주입하고, 실제 computeEdgeD(SSoT)로 path 가 산출되는지 +
 *   data(edgeType/strength/highlighted/flowing) → className 매핑 + 미측정 노드 시 null 을 단언한다.
 *   (computeEdgeD 의 베지어 정확성 자체는 flow-edge.test.ts 가 별도 검증 — 여기선 결선만.)
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

/** 측정 노드 stub — internals.positionAbsolute + measured. */
const NODES: Record<string, unknown> = {
  s: { internals: { positionAbsolute: { x: 0, y: 0 } }, measured: { width: 180, height: 56 } },
  t: { internals: { positionAbsolute: { x: 400, y: 0 } }, measured: { width: 180, height: 56 } },
  unmeasured: { internals: { positionAbsolute: { x: 0, y: 0 } }, measured: {} },
};

vi.mock('@xyflow/react', () => ({
  useInternalNode: (id: string) => NODES[id],
  BaseEdge: ({ path, className, markerEnd }: { path: string; className?: string; markerEnd?: string }): ReactElement => (
    <path data-testid="edge" d={path} className={className} markerEnd={markerEnd} />
  ),
}));

// mock 이후 import(호이스팅된 vi.mock 이 먼저 적용되도록 동적 require 회피 — vitest 가 자동 호이스팅).
import { FlowEdge } from '../FlowEdge';
import type { FlowFlowEdge } from '../flow-adapter';

function render(props: Partial<{ source: string; target: string; data: FlowFlowEdge['data'] }>): string {
  const full = {
    id: 'e1',
    source: props.source ?? 's',
    target: props.target ?? 't',
    data: props.data ?? { edgeType: 'call' },
  } as unknown as Parameters<typeof FlowEdge>[0];
  return renderToStaticMarkup(<FlowEdge {...full} />);
}

describe('FlowEdge', () => {
  it('측정 노드 → computeEdgeD path(M..C..) + 기본 className(edge edge-call)', () => {
    const html = render({ data: { edgeType: 'call' } });
    expect(html).toContain('data-testid="edge"');
    expect(html).toMatch(/d="M [\d.]+ [\d.]+ C/); // 3차 베지어 path
    expect(html).toContain('class="edge edge-call"');
    expect(html).toContain('marker-end="url(#flowArr)"');
  });

  it('edgeType after + strength → edge-after is-strength-weak', () => {
    const html = render({ data: { edgeType: 'after', strength: 'weak' } });
    expect(html).toContain('edge-after');
    expect(html).toContain('is-strength-weak');
  });

  it('highlighted + flowing 플래그 → is-highlighted is-flowing', () => {
    const html = render({ data: { edgeType: 'call', highlighted: true, flowing: true } });
    expect(html).toContain('is-highlighted');
    expect(html).toContain('is-flowing');
  });

  it('미측정 노드 → null(렌더 안 함)', () => {
    const html = render({ source: 'unmeasured', data: { edgeType: 'call' } });
    expect(html).toBe('');
  });
});
