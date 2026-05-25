/**
 * topological-sort.ts — Kahn 알고리즘 (priority queue key = started_at ASC)
 *
 * 책임 (Single Responsibility):
 *   ToolCall 단위의 DAG 를 받아 (1) 위상 정렬된 layer 배열, (2) 같은 layer 안에서는
 *   시간순(started_at ASC) 좌→우 정렬을 반환한다. *순수 TypeScript* — DB / Cypher
 *   의존 0. sequential-flow.ts 가 이 결과로 응답 `layers: number[][]` 을 구성한다.
 *
 * 의존성:
 *   - 없음 (pure function 모듈).
 *
 * 호출 흐름 (sequential-flow.ts 기준):
 *   1) Cypher fetchChainTraversal + fetchTurnAfter 결과를 합쳐 GraphInput 으로 변환.
 *   2) `topologicalLayers(input)` 호출 → `{ layers, orderedIds, cycleDetected }`.
 *   3) cycleDetected === true 면 호출자가 단순 timestamp 정렬로 폴백.
 *
 * 알고리즘 (06-sequential-flowchart.md §3.3 Step 4):
 *   - Kahn 의 표준 in-degree zero 큐 방식.
 *   - 큐를 단순 FIFO 가 아닌 **priority queue** (key = started_at ASC) 로 두어
 *     같은 layer 안 결정성 보장. priority queue 구현은 binary heap 1개.
 *   - 같은 priority(동일 timestamp) 일 때 id 사전순(`id ASC`) 안정 정렬 — 결정성 100% 회.
 *   - "layer 분리" 는 Kahn 의 진행을 한 번에 in-degree 0 인 모든 노드를 한 layer
 *     로 묶는 BFS-style 변형 적용. priority queue 는 layer 내부 순서만 관장.
 *
 * 디자인 결정:
 *   - layer 구조는 **노드 id 의 배열의 배열** (`number[][]` 대신 `string[][]`).
 *     호출자(sequential-flow.ts)가 layer index → y 좌표 매핑 자유롭게 부여.
 *   - 사이클이 감지되면 (in-degree 0 큐가 비었는데 미처리 노드가 남으면) 사이클에
 *     포함된 노드를 마지막 layer 로 강제 편입하고 cycleDetected=true 반환. fail-fast
 *     하지 않는 이유 — Spyglass 도메인 (parent_tool_use_id) 은 기본 트리지만, mig-037
 *     같은 가상 ID 합성으로 사이클이 잠재 가능. UI 가 깨지면 안 됨.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/.tmp/plans/spyglass/graph-db-research/06-sequential-flowchart.md
 *   §3.3 Step 4 — Kahn topological sort with priority queue key=started_at.
 */

// =============================================================================
// 입력 / 출력 타입
// =============================================================================

/**
 * 정렬 입력 노드. id 는 ToolCall 의 `tool_use_id` 또는 합성 노드 id 무엇이든 일관.
 * started_at 은 priority queue 의 정렬 키 — ms 단위 unix epoch 권장.
 */
export interface SortableNode {
  id: string;
  started_at: number;
}

/** 정렬 입력 엣지 — DAG 방향성: from → to 가 인과 (시간상 from 이 먼저). */
export interface SortableEdge {
  from: string;
  to: string;
}

export interface TopologicalInput {
  nodes: readonly SortableNode[];
  edges: readonly SortableEdge[];
}

export interface TopologicalResult {
  /**
   * 각 layer 의 node id 배열. layer[0] 가 가장 먼저 발생한 (in-degree 0) 노드 집합.
   * 같은 layer 안의 노드는 started_at ASC 로 정렬된 좌→우 순서.
   */
  layers: string[][];
  /** layer 를 펼친 1D 시간 순서. UI 가 라벨 출력 같은 단순 시간축에 사용. */
  orderedIds: string[];
  /** 사이클 감지 여부. 호출자가 fallback 결정에 사용. */
  cycleDetected: boolean;
}

// =============================================================================
// 본 알고리즘
// =============================================================================

/**
 * Kahn 위상 정렬 — layer-by-layer 출력.
 *
 * 복잡도: O((V + E) · log V). 우선순위 큐가 log V, 각 노드/엣지를 1회씩 방문.
 * Spyglass 도메인 규모 (한 응답당 노드 ≤ 수백) 에선 무시 가능.
 *
 * @param input 노드/엣지 집합. 둘 다 readonly — 호출자 입력을 변형하지 않는다.
 */
export function topologicalLayers(input: TopologicalInput): TopologicalResult {
  const { nodes, edges } = input;
  if (nodes.length === 0) {
    return { layers: [], orderedIds: [], cycleDetected: false };
  }

  // ── 인접 리스트 + in-degree 빌드 ──────────────────────────────────────────
  const nodeMap = new Map<string, SortableNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  const outgoing = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const n of nodes) {
    outgoing.set(n.id, []);
    inDegree.set(n.id, 0);
  }
  for (const e of edges) {
    if (!nodeMap.has(e.from) || !nodeMap.has(e.to)) continue; // dangling edge 안전 무시
    outgoing.get(e.from)!.push(e.to);
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }

  // ── layer-by-layer Kahn ───────────────────────────────────────────────────
  const layers: string[][] = [];
  const orderedIds: string[] = [];
  let remaining = nodes.length;

  // 첫 layer 의 in-degree 0 노드들을 모은다.
  let currentLayer = collectZeroInDegree(nodes, inDegree);

  while (currentLayer.length > 0) {
    // 같은 layer 안에서는 started_at ASC, tie-break 로 id ASC (결정성 100%).
    const sortedLayer = sortByTimeAndId(currentLayer.map((id) => nodeMap.get(id)!));
    const layerIds = sortedLayer.map((n) => n.id);
    layers.push(layerIds);
    orderedIds.push(...layerIds);
    remaining -= layerIds.length;

    // 다음 layer 후보 — 현 layer 의 out edge 를 따라가서 in-degree 0 이 된 노드들.
    const nextCandidates: string[] = [];
    for (const id of layerIds) {
      for (const to of outgoing.get(id) ?? []) {
        const d = inDegree.get(to)! - 1;
        inDegree.set(to, d);
        if (d === 0) nextCandidates.push(to);
      }
    }
    currentLayer = nextCandidates;
  }

  // ── 사이클 폴백 ──────────────────────────────────────────────────────────
  // remaining > 0 = 사이클에 갇힌 노드 존재. fail-fast 하지 않고 마지막 layer 로 편입.
  if (remaining > 0) {
    const stragglers: SortableNode[] = [];
    for (const n of nodes) {
      if (!orderedIds.includes(n.id)) stragglers.push(n);
    }
    const sortedStragglers = sortByTimeAndId(stragglers);
    layers.push(sortedStragglers.map((n) => n.id));
    orderedIds.push(...sortedStragglers.map((n) => n.id));
    return { layers, orderedIds, cycleDetected: true };
  }

  return { layers, orderedIds, cycleDetected: false };
}

// =============================================================================
// 내부 헬퍼
// =============================================================================

/** in-degree 0 인 노드 id 만 추출. */
function collectZeroInDegree(
  nodes: readonly SortableNode[],
  inDegree: Map<string, number>,
): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if ((inDegree.get(n.id) ?? 0) === 0) out.push(n.id);
  }
  return out;
}

/**
 * 정렬 키: (started_at ASC, id ASC). priority queue 대신 단순 sort 사용 — layer 당
 * 노드 수가 작아 (보통 < 30) log V 차이가 실측 거의 없고, 안정성과 가독성이 우선.
 */
function sortByTimeAndId(nodes: SortableNode[]): SortableNode[] {
  return [...nodes].sort((a, b) => {
    if (a.started_at !== b.started_at) return a.started_at - b.started_at;
    return a.id.localeCompare(b.id);
  });
}
