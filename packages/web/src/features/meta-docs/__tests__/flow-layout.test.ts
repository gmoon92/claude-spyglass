/**
 * flow-layout.test.ts — column 좌표 부여 + 콘텐츠 bbox 순수 (P4-03 선행 특성화)
 *
 * 원본 meta-docs-flow.js 의 computePositions/contentBBox(flow.js:318,1142) 동치.
 * arch §4.2: lib/flow-layout.ts 순수. column/slot 매핑 결정론 회귀 게이트.
 */
import { describe, it, expect } from 'bun:test';
import {
  computePositions,
  contentBBox,
  LAYOUT,
  type RawFlowNode,
  type FlowColumn,
  type PositionedNode,
} from '../flow-layout';

const RAW: RawFlowNode[] = [
  { id: 'a', type: 'center', data: { kind: 'agent', name: 'A', count: 5 } },
  { id: 'b', type: 'spoke', data: { kind: 'skill', name: 'B', count: 2, pct: 0.4 } },
  { id: 'orphan', type: 'spoke', data: { kind: 'tool', name: 'X' } }, // 컬럼 미매핑
];
const COLUMNS: FlowColumn[] = [{ nodeIds: ['a'] }, { nodeIds: ['b'] }];

describe('computePositions — column index = x, slot = y (flow.js:318)', () => {
  it('컬럼 매핑 안 된 노드는 제외 (flow.js:325)', () => {
    const nodes = computePositions(RAW, COLUMNS);
    expect(nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });
  it('column/slot 으로 초기 x/y 부여 (flow.js:350)', () => {
    const nodes = computePositions(RAW, COLUMNS);
    const a = nodes.find((n) => n.id === 'a')!;
    const b = nodes.find((n) => n.id === 'b')!;
    expect(a.column).toBe(0);
    expect(a.x).toBe(LAYOUT.leftPad);
    expect(b.column).toBe(1);
    expect(b.x).toBe(LAYOUT.leftPad + 1 * (LAYOUT.nodeW + LAYOUT.colGap));
  });
  it('카드 표면 필드 보존 — title/count/pct/kind (flow.js:331-348)', () => {
    const nodes = computePositions(RAW, COLUMNS);
    const b = nodes.find((n) => n.id === 'b')!;
    expect(b.title).toBe('B');
    expect(b.kind).toBe('skill');
    expect(b.count).toBe(2);
    expect(b.pct).toBe(0.4);
  });
});

describe('contentBBox — 노드 geometry 합집합 (flow.js:1142)', () => {
  it('빈 노드 → null', () => {
    expect(contentBBox([])).toBeNull();
  });
  it('노드들의 최소/최대 경계', () => {
    const nodes: PositionedNode[] = [
      { ...mk('a'), x: 10, y: 20, w: 100, h: 50 },
      { ...mk('b'), x: 200, y: 0, w: 80, h: 40 },
    ];
    expect(contentBBox(nodes)).toEqual({ x: 10, y: 0, width: 200 + 80 - 10, height: 50 + 20 - 0 });
  });
});

function mk(id: string): PositionedNode {
  return {
    id, kind: 'tool', type: 'spoke', title: id, depth: 0, column: 0, slot: 0,
    layerTone: 0, x: 0, y: 0, w: 0, h: 0,
  };
}
