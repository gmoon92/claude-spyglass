/**
 * flow-graph.test.ts — flow BFS path 순수 그래프 로직 (P4-03 선행 특성화)
 *
 * 원본 meta-docs-flow-highlight.js 의 buildAdjacency/bfsCollect(highlight.js:289,301) 동치를
 * 순수 함수로 고정한다. DOM 의존 0 — highlight 정확도 + cycle 안전 회귀 게이트.
 * arch §4.2: highlight 의 BFS 는 lib/flow-graph.ts 로 1:1 추출, DOM 토글은 컴포넌트 effect.
 */
import { describe, it, expect } from 'vitest';
import {
  buildAdjacency,
  bfsCollect,
  collectFullPathNodes,
  collectEdgesBetween,
  type FlowEdge,
} from '../flow-graph';

// a → b → c, a → d (DAG)
const EDGES: FlowEdge[] = [
  { id: 'e1', source: 'a', target: 'b' },
  { id: 'e2', source: 'b', target: 'c' },
  { id: 'e3', source: 'a', target: 'd' },
];

describe('buildAdjacency — forward/backward 인접 리스트 (highlight.js:289)', () => {
  it('forward: source → [target...]', () => {
    const adj = buildAdjacency(EDGES, 'forward');
    expect(adj.get('a')?.sort()).toEqual(['b', 'd']);
    expect(adj.get('b')).toEqual(['c']);
    expect(adj.get('c')).toBeUndefined();
  });
  it('backward: target → [source...]', () => {
    const adj = buildAdjacency(EDGES, 'backward');
    expect(adj.get('c')).toEqual(['b']);
    expect(adj.get('b')).toEqual(['a']);
    expect(adj.get('d')).toEqual(['a']);
  });
});

describe('bfsCollect — 도달 노드 누적, cycle 안전 (highlight.js:301)', () => {
  it('forward 로 a 부터 모든 자손 수집', () => {
    const adj = buildAdjacency(EDGES, 'forward');
    const set = new Set<string>();
    bfsCollect(adj, 'a', set);
    expect([...set].sort()).toEqual(['b', 'c', 'd']);
  });
  it('cycle 이 있어도 무한루프 없이 종료', () => {
    const cyclic: FlowEdge[] = [
      { id: 'c1', source: 'x', target: 'y' },
      { id: 'c2', source: 'y', target: 'x' },
    ];
    const adj = buildAdjacency(cyclic, 'forward');
    const set = new Set<string>();
    bfsCollect(adj, 'x', set);
    expect([...set].sort()).toEqual(['x', 'y']);
  });
});

describe('collectFullPathNodes — 중심 + upstream + downstream (highlight.js:172-179)', () => {
  it('center b → 조상 a + 자손 c + 자기자신', () => {
    const nodes = collectFullPathNodes(EDGES, 'b');
    expect([...nodes].sort()).toEqual(['a', 'b', 'c']);
  });
  it('center a → 모든 자손 (조상 없음)', () => {
    const nodes = collectFullPathNodes(EDGES, 'a');
    expect([...nodes].sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('collectEdgesBetween — 강조 노드 사이 엣지만 (highlight.js:181-186)', () => {
  it('양 끝이 모두 강조 노드인 엣지 id set', () => {
    const nodes = new Set(['a', 'b', 'c']);
    const edges = collectEdgesBetween(EDGES, nodes);
    // e1(a→b), e2(b→c) 포함, e3(a→d) 제외 (d 미강조)
    expect([...edges].sort()).toEqual(['e1', 'e2']);
  });
});
