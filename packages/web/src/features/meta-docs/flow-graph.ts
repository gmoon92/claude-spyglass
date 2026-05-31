/**
 * features/meta-docs/flow-graph.ts — flow BFS path 순수 그래프 로직 (P4-03)
 *
 * 원본: assets/js/meta-docs-flow-highlight.js buildAdjacency/bfsCollect(highlight.js:289,301) +
 *   applyFullPathSelection 의 노드/엣지 수집부(highlight.js:172-186)를 순수 함수로 1:1 추출.
 *   DOM 클래스 토글(.is-highlighted/.is-flowing/.has-selection)은 MetaDocsFlow effect 가 담당(arch §4.2).
 *
 * 의존성: 없음(순수). highlight.js:20 "의존성 없음" 유지.
 *
 * @module features/meta-docs/flow-graph
 */

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
}

/** forward = source→target(자손), backward = target→source(조상). (highlight.js:289) */
export function buildAdjacency(edges: FlowEdge[], dir: 'forward' | 'backward'): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const key = dir === 'forward' ? e.source : e.target;
    const val = dir === 'forward' ? e.target : e.source;
    if (!adj.has(key)) adj.set(key, []);
    adj.get(key)!.push(val);
  }
  return adj;
}

/** start 부터 BFS 로 도달 가능한 노드 id 를 set 에 누적. cycle 안전. (highlight.js:301) */
export function bfsCollect(adj: Map<string, string[]>, start: string, set: Set<string>): void {
  const queue: string[] = [start];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const neighbors = adj.get(cur) || [];
    for (const n of neighbors) {
      if (set.has(n)) continue;
      set.add(n);
      queue.push(n);
    }
  }
}

/**
 * 중심 노드의 모든 조상(upstream) + 자손(downstream) + 자기자신 노드 set. (highlight.js:172-179)
 * click selection 의 full-path 강조 노드 집합 — DOM 무관 순수.
 */
export function collectFullPathNodes(edges: FlowEdge[], centerNodeId: string): Set<string> {
  const adjOut = buildAdjacency(edges, 'forward');
  const adjIn = buildAdjacency(edges, 'backward');
  const nodes = new Set<string>();
  nodes.add(centerNodeId);
  bfsCollect(adjIn, centerNodeId, nodes);
  bfsCollect(adjOut, centerNodeId, nodes);
  return nodes;
}

/**
 * 엣지 hover 시작점(양끝 fromId/toId)에서 조상/자손 path 노드 set. (highlight.js:222-229)
 * fromId 의 조상(backward) + toId 의 자손(forward) + 양끝 자신.
 */
export function collectHoverPathNodes(edges: FlowEdge[], fromId: string, toId: string): Set<string> {
  const adjOut = buildAdjacency(edges, 'forward');
  const adjIn = buildAdjacency(edges, 'backward');
  const nodes = new Set<string>();
  bfsCollect(adjIn, fromId, nodes);
  bfsCollect(adjOut, toId, nodes);
  nodes.add(fromId);
  nodes.add(toId);
  return nodes;
}

/** 양 끝이 모두 강조 노드인 엣지 id set — 외곽 엣지(한쪽만 강조) 제외. (highlight.js:181-186) */
export function collectEdgesBetween(edges: FlowEdge[], highlightedNodes: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const e of edges) {
    if (highlightedNodes.has(e.source) && highlightedNodes.has(e.target)) {
      out.add(e.id);
    }
  }
  return out;
}
