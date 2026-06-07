/**
 * flow-adapter.test.ts — unified-flow payload → xyflow Node[]/Edge[] 변환 검증.
 *
 * 검증: 컬럼 기반 좌표(computePositions SSoT) 보존, data 표시필드 보존(좌표 제외), 엣지 type 소문자화 +
 *   strength 보존, 컬럼 미매핑 노드 제외, graph-edge 추출.
 */
import { describe, it, expect } from 'vitest';
import {
  toFlowNodes,
  toFlowEdges,
  toGraphEdges,
  FLOW_NODE_TYPE,
  FLOW_EDGE_TYPE,
  type UnifiedFlowPayload,
} from '../flow-adapter';
import { LAYOUT } from '../flow-layout';

const payload: UnifiedFlowPayload = {
  nodes: [
    { id: 'center', type: 'center', data: { kind: 'skill', name: 'commit', depth: 0, layerTone: 2, count: 12, invocations: 12, pills: ['hot'] } },
    { id: 'a', type: 'skill', data: { kind: 'skill', name: 'doc', depth: 1, layerTone: 0, count: 3, pct: 0.25 } },
    { id: 'orphan', type: 'tool', data: { kind: 'tool', name: 'ghost' } }, // 컬럼 미매핑 → 제외
  ],
  edges: [
    { id: 'e1', source: 'center', target: 'a', type: 'CALL', strength: 'strong' },
    { id: 'e2', source: 'a', target: 'center', type: 'AFTER' },
  ],
  columns: [{ nodeIds: ['center'] }, { nodeIds: ['a'] }],
  meta: { centerName: 'commit' },
};

describe('toFlowNodes', () => {
  const nodes = toFlowNodes(payload);

  it('컬럼 매핑된 노드만 변환(orphan 제외)', () => {
    expect(nodes.map((n) => n.id).sort()).toEqual(['a', 'center']);
  });

  it('type=card, position 은 computePositions 컬럼 좌표', () => {
    const center = nodes.find((n) => n.id === 'center')!;
    const a = nodes.find((n) => n.id === 'a')!;
    expect(center.type).toBe(FLOW_NODE_TYPE);
    expect(center.position).toEqual({ x: LAYOUT.leftPad, y: LAYOUT.topPad });
    // a 는 컬럼 1, 슬롯 0 → x 가 한 컬럼만큼 이동.
    expect(a.position.x).toBe(LAYOUT.leftPad + (LAYOUT.nodeW + LAYOUT.colGap));
    expect(a.position.y).toBe(LAYOUT.topPad);
  });

  it('data 에 표시필드 보존(좌표 제외)', () => {
    const center = nodes.find((n) => n.id === 'center')!;
    expect(center.data.kind).toBe('skill');
    expect(center.data.title).toBe('commit');
    expect(center.data.layerTone).toBe(2);
    expect(center.data.count).toBe(12);
    expect(center.data.invocations).toBe(12);
    expect(center.data.pills).toEqual(['hot']);
    // 좌표는 position 으로 분리 — data 에 x/y 없음.
    expect('x' in center.data).toBe(false);
    expect('y' in center.data).toBe(false);
  });
});

describe('toFlowEdges', () => {
  const edges = toFlowEdges(payload);

  it('type=flow, edgeType 소문자화, strength 보존', () => {
    const e1 = edges.find((e) => e.id === 'e1')!;
    expect(e1.type).toBe(FLOW_EDGE_TYPE);
    expect(e1.source).toBe('center');
    expect(e1.target).toBe('a');
    expect(e1.data!.edgeType).toBe('call');
    expect(e1.data!.strength).toBe('strong');
  });

  it('strength 없으면 미부여', () => {
    const e2 = edges.find((e) => e.id === 'e2')!;
    expect(e2.data!.edgeType).toBe('after');
    expect('strength' in e2.data!).toBe(false);
  });
});

describe('toGraphEdges', () => {
  it('xyflow 엣지 → flow-graph {id,source,target} 추출', () => {
    const g = toGraphEdges(toFlowEdges(payload));
    expect(g).toEqual([
      { id: 'e1', source: 'center', target: 'a' },
      { id: 'e2', source: 'a', target: 'center' },
    ]);
  });
});
