/**
 * unified-flow.ts — 통합 메타 문서 흐름 (cohort 타임라인 시퀀스 복원)
 *
 * 책임:
 *   특정 메타 문서를 center 로 두고, center 가 등장한 turn 들(cohort)의 **메타 노드
 *   타임라인**을 복원해 좌(먼저)→우(나중) 순차 DAG 로 펼친 단일 응답을 만든다.
 *
 *   핵심 알고리즘 (스타 토폴로지 → 순차 DAG 전환):
 *     1) center 메타를 사용한 ToolCall(시드)들의 turn 집합을 구한다.
 *     2) 그 turn 들 안의 *상위 메타 노드*(USES→MetaDocument 가 있는 ToolCall — agent/
 *        skill/command/mcp)만 started_at 순으로 모은다. generic 도구(bash/read/write)는
 *        USES 가 없어 원천 제외 = 경로 압축.
 *     3) 각 turn 안에서 연속한 메타 노드 쌍(prev→next)을 인접 엣지로 만들고, 전 turn
 *        에 걸쳐 빈도(turn 수)를 누적한다. center 직결 fallback 없음.
 *     4) Kahn 위상정렬(topological-sort.ts)로 layer 부여 → center 기준 depth 부호
 *        (이전=음수 ancestor / center=0 / 이후=양수 descendant) + 좌→우 컬럼.
 *     5) started_at 5분위 양자화로 layerTone(0..4) 부여.
 *
 *   엣지 strength 는 인접쌍 빈도(turn 수 / 시드 turn 수)로 환산 — "X 다음 Y" 가 얼마나
 *   자주 관찰됐는지를 시각 강도로 표현.
 *
 *   SPAWNED/NEXT/PARENT_OF 엣지에 의존하지 않는다 (실데이터에서 거의 생성되지 않아
 *   스타 토폴로지의 근본 원인이었음). USES + ToolCall.{turn_id, started_at} 만 사용.
 *
 * 의존성:
 *   - client.ts (LadybugClient)
 *   - topological-sort.ts (Kahn 위상정렬)
 *
 * 호출 흐름:
 *   routes/graph.ts::handleUnifiedFlow
 *     → getUnifiedFlow(client, { centerKind, centerName, depth, fromTs, toTs, project, maxSeeds })
 *         → 1) fetchCenterSeeds        — center 메타가 사용된 ToolCall 시드 + turn 집합
 *         → 2) fetchCohortMetaTimeline — 시드 turn 들 안의 메타 노드 타임라인
 *         → 3) buildAggregatedTimeline — turn 별 인접쌍 → 빈도 집계 그래프
 *         → 4) topologicalLayers       — Kahn DAG layer
 *         → assembleResult             — { nodes, edges, columns, meta }
 *
 * 응답 계약 (UnifiedFlowResult):
 *   nodes[].id        — center 는 'center', 그 외 `${kind}::${name}` (집계 카드 단위)
 *   nodes[].data.depth — 음수=center 이전, 0=center, 양수=center 이후
 *   nodes[].data.column — viewport 좌→우 컬럼 인덱스 (0 부터)
 *   nodes[].data.layerTone — 0..4 (5분위), CSS `--card-tone-layer-N` 매핑 키
 *   edges[].strength  — 인접쌍 빈도 기반 (strong/medium/weak/sparse)
 *
 *   카드 표면 SSoT 중 count/pct/invocations/subRows/pills 는 본 쿼리가 *채우지 않는다*
 *   — routes/graph.ts 의 enrich 단계가 부착(MCP 그룹핑, HOT pill 등). 본 모듈은 노드
 *   집계 + 시퀀스 엣지(strength 포함) 까지 보장.
 */

import type { LadybugClient } from '../client';
import {
  topologicalLayers,
  type SortableNode,
  type SortableEdge,
  type TopologicalResult,
} from './topological-sort';

// =============================================================================
// 타입 — API 응답 계약
// =============================================================================

export type MetaDocKind = 'command' | 'skill' | 'agent' | 'mcp' | 'tool';

/** 응답 노드. (kind, name) 집계 카드 단위 — center 는 합성 'center'. */
export interface UnifiedFlowNode {
  /** 그래프 식별자 — center 는 'center', 그 외 `${kind}::${name}`. */
  id: string;
  /** 노드 카테고리. UI 색상/아이콘 매핑 키. */
  type: MetaDocKind | 'center';
  data: {
    kind: MetaDocKind;
    name: string;
    tool_use_id?: string;
    started_at: number;
    /** 음수=center 이전(ancestor) / 0=center / 양수=center 이후(descendant) */
    depth: number;
    /** layer index (Kahn 결과). */
    layer: number;
    /** viewport 좌→우 컬럼 인덱스 (0..columns.length-1). */
    column: number;
    /** 시간 그라데이션 색조 양자화 결과 0..4. UI 는 `--card-tone-layer-${tone}`. */
    layerTone: number;
    /** chain 경로 (root → 자기 자신) — UI traversal 시각화. */
    chain?: string[];

    // ─── 카드 표면 SSoT (enrich 단계가 채움 — 본 쿼리는 무관) ───
    count?: number;
    pct?: number;
    invocations?: number;
    timeline?: 'after' | null;
    subRows?: Array<{
      fullName: string;
      toolName: string;
      count: number;
      pct: number;
    }>;
    pills?: ('hot')[];
  };
  _hydrated: true;
}

/** 응답 엣지. */
export interface UnifiedFlowEdge {
  id: string;
  source: string;
  target: string;
  /** CALL = 인과/순차 흐름 (실선), AFTER = 시간 흐름만 (점선). */
  type: 'CALL' | 'AFTER';
  /** 인접쌍 빈도 기반 강도. */
  strength?: 'strong' | 'medium' | 'weak' | 'sparse';
  data?: { via_tool_use_id?: string; weight?: number };
}

export interface UnifiedFlowParams {
  centerKind: MetaDocKind;
  centerName: string;
  /** 가변 깊이 상한 (1~30). 현재 타임라인 복원은 turn 범위라 meta 기록용. 기본 30. */
  depth?: number;
  project?: string | null;
  fromTs?: number;
  toTs?: number;
  /** seed (center 메타가 사용된) ToolCall 최대 개수. 기본 32. */
  maxSeeds?: number;
}

export interface UnifiedFlowColumn {
  /** depth 값 — 음수=center 이전, 0=center, 양수=center 이후. */
  depth: number;
  /** 'ancestor' | 'center' | 'descendant' — UI 가 라벨/스타일 분기. */
  tag: 'ancestor' | 'center' | 'descendant' | 'after';
  /** 이 컬럼에 속한 node id 들. */
  nodeIds: string[];
}

export interface UnifiedFlowResult {
  nodes: UnifiedFlowNode[];
  edges: UnifiedFlowEdge[];
  /** 좌→우 컬럼 정의. center 이전(음수)이 좌, 이후(양수)가 우. */
  columns: UnifiedFlowColumn[];
  meta: {
    centerKind: MetaDocKind;
    centerName: string;
    depth: number;
    seedCount: number;
    cycleDetected: boolean;
    durationMs: number;
  };
}

// =============================================================================
// 상수
// =============================================================================

const DEFAULT_DEPTH = 30;
const MAX_DEPTH = 30;
const DEFAULT_MAX_SEEDS = 32;
/** 시간 그라데이션 양자화 단계 수. CSS variable `--card-tone-layer-0..4` 와 1:1. */
const LAYER_TONE_BUCKETS = 5;
/** center 합성 노드 id. */
const CENTER_ID = 'center';

// =============================================================================
// 메인 진입점
// =============================================================================

/**
 * 통합 Flow 데이터 생성 (cohort 타임라인 시퀀스 복원).
 */
export async function getUnifiedFlow(
  client: LadybugClient,
  params: UnifiedFlowParams,
): Promise<UnifiedFlowResult> {
  const started = Date.now();
  const depth = clampDepth(params.depth ?? DEFAULT_DEPTH);
  const maxSeeds = params.maxSeeds ?? DEFAULT_MAX_SEEDS;

  // ── 1) Center anchor — 시드 + turn 집합 ───────────────────────────────────
  const seeds = await fetchCenterSeeds(client, {
    centerKind: params.centerKind,
    centerName: params.centerName,
    project: params.project ?? null,
    fromTs: params.fromTs ?? null,
    toTs: params.toTs ?? null,
    maxSeeds,
  });

  if (seeds.length === 0) {
    return emptyResult(params, depth, started);
  }

  const centerStartedAt = Math.min(...seeds.map((s) => s.started_at));
  const seedTurnIds = [...new Set(seeds.map((s) => s.turn_id).filter((t): t is string => t !== null))];

  // turn 정보가 전혀 없으면 center 단일 노드만 반환 (degenerate).
  if (seedTurnIds.length === 0) {
    return centerOnlyResult(params, centerStartedAt, depth, started);
  }

  // ── 2) cohort 타임라인 — 시드 turn 들 안의 메타 노드 ───────────────────────
  const timelineRows = await fetchCohortMetaTimeline(client, { turnIds: seedTurnIds });

  // ── 3) turn 별 인접쌍 → 빈도 집계 ─────────────────────────────────────────
  const built = buildAggregatedTimeline(
    timelineRows,
    params.centerKind,
    params.centerName,
    centerStartedAt,
    seedTurnIds.length,
  );

  // center 가 어떤 이유로든 타임라인에 안 잡혔으면 보강.
  if (!built.nodes.has(CENTER_ID)) {
    built.nodes.set(CENTER_ID, {
      id: CENTER_ID,
      kind: params.centerKind,
      name: params.centerName,
      started_at: centerStartedAt,
      turnCount: seedTurnIds.length,
    });
  }

  // ── 4) Kahn 위상 정렬 ─────────────────────────────────────────────────────
  // layering 입력은 *DAG 스냅샷* 이어야 한다. 코호트 집계는 여러 turn 의 인접쌍을 합치므로
  // pm→Explore 와 Explore→pm 같은 양방향 엣지(cycle)가 필연적으로 생기고, cycle 이 하나라도
  // 있으면 topologicalLayers 가 cycle 노드 전부를 단일 layer 로 덤프 → depth 0 한 열 수직 밀집.
  //
  // 해법: layering *계산용* 엣지를 노드 started_at 기준으로 방향 통일(이른 쪽→늦은 쪽,
  // 동시각은 id tie-break)하고 중복 제거한다. started_at 이 strict total order 이므로
  // cycle 이 수학적으로 차단되고, Kahn 의 longest-path layer 분산이 시간/인과 깊이대로
  // 좌→우로 펼쳐진다. 렌더링 엣지(화살표)는 built.edges 원본을 그대로 쓰므로 의미 불변.
  const sortNodes: SortableNode[] = [...built.nodes.values()].map((n) => ({ id: n.id, started_at: n.started_at }));
  const sortEdges: SortableEdge[] = buildAcyclicLayeringEdges([...built.edges.values()], built.nodes);
  const layered = topologicalLayers({ nodes: sortNodes, edges: sortEdges });

  return assembleResult({ params, depth, built, layered, seedCount: seeds.length, durationMs: Date.now() - started });
}

// =============================================================================
// Cypher 1 — fetchCenterSeeds
// =============================================================================

interface SeedRow {
  tool_use_id: string;
  started_at: number;
  turn_id: string | null;
  session_id: string;
}

interface FetchCenterSeedsParams {
  centerKind: MetaDocKind;
  centerName: string;
  project: string | null;
  fromTs: number | null;
  toTs: number | null;
  maxSeeds: number;
}

/**
 * center 메타 문서를 사용한 ToolCall 들 (시드).
 *
 *   MATCH (md:MetaDocument {kind, name}) <-[:USES]- (seed:ToolCall)
 *   WHERE (선택적 시간 필터)
 *   RETURN seed.tool_use_id, seed.started_at, seed.turn_id, seed.session_id
 *   ORDER BY seed.started_at ASC LIMIT $maxSeeds
 */
async function fetchCenterSeeds(
  client: LadybugClient,
  p: FetchCenterSeedsParams,
): Promise<SeedRow[]> {
  const conds: string[] = [];
  if (p.fromTs !== null) conds.push('seed.started_at >= $fromTs');
  if (p.toTs !== null) conds.push('seed.started_at <= $toTs');
  if (p.project !== null) conds.push('seed.session_id IN $projectSessionIds');
  const whereClause = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';

  const cypher =
    `MATCH (md:MetaDocument {kind: $centerKind, name: $centerName}) ` +
    `<-[:USES]-(seed:ToolCall) ` +
    `${whereClause} ` +
    `RETURN seed.tool_use_id AS tool_use_id, seed.started_at AS started_at, ` +
    `       seed.turn_id AS turn_id, seed.session_id AS session_id ` +
    `ORDER BY seed.started_at ASC ` +
    `LIMIT ${p.maxSeeds}`;

  const result = await client.query(cypher, {
    centerKind: p.centerKind,
    centerName: p.centerName,
    fromTs: p.fromTs,
    toTs: p.toTs,
    projectSessionIds: [],
  });

  return result.rows.map((r) => ({
    tool_use_id: String(r.tool_use_id),
    started_at: Number(r.started_at),
    turn_id: r.turn_id === null || r.turn_id === undefined ? null : String(r.turn_id),
    session_id: String(r.session_id),
  }));
}

// =============================================================================
// Cypher 2 — fetchCohortMetaTimeline
// =============================================================================

interface TimelineRow {
  session_id: string;
  turn_id: string;
  tool_use_id: string;
  started_at: number;
  kind: MetaDocKind;
  name: string;
}

interface FetchCohortTimelineParams {
  turnIds: string[];
}

/**
 * 시드 turn 들 안에서 USES→MetaDocument 가 있는 ToolCall 만 시간순 반환.
 *
 *   MATCH (tc:ToolCall)-[:USES]->(md:MetaDocument)
 *   WHERE tc.turn_id IN $turnIds
 *   RETURN tc.session_id, tc.turn_id, tc.tool_use_id, tc.started_at, md.kind, md.name
 *   ORDER BY tc.started_at ASC
 *
 * USES 가 없는 generic 도구(bash/read/write)는 원천 제외 = 경로 압축.
 * PARENT_OF/SPAWNED/NEXT 미사용 — 실데이터 결손과 무관하게 동작.
 */
async function fetchCohortMetaTimeline(
  client: LadybugClient,
  p: FetchCohortTimelineParams,
): Promise<TimelineRow[]> {
  const cypher =
    `MATCH (tc:ToolCall)-[:USES]->(md:MetaDocument) ` +
    `WHERE tc.turn_id IN $turnIds ` +
    `RETURN tc.session_id AS session_id, tc.turn_id AS turn_id, ` +
    `       tc.tool_use_id AS tool_use_id, tc.started_at AS started_at, ` +
    `       md.kind AS kind, md.name AS name ` +
    `ORDER BY tc.started_at ASC`;

  const result = await client.query(cypher, { turnIds: p.turnIds });

  return result.rows
    .map((r) => ({
      session_id: String(r.session_id),
      turn_id: String(r.turn_id),
      tool_use_id: String(r.tool_use_id),
      started_at: Number(r.started_at),
      kind: normalizeKind(r.kind),
      name: String(r.name),
    }))
    .filter((r) => r.name.length > 0);
}

// =============================================================================
// 집계 — turn 별 인접쌍 → 빈도 그래프
// =============================================================================

interface AggNode {
  id: string;
  kind: MetaDocKind;
  name: string;
  started_at: number;
  /** 이 노드가 등장한 distinct turn 수. */
  turnCount: number;
}

interface AggEdge {
  from: string;
  to: string;
  /** 이 인접쌍이 관찰된 distinct turn 집합. */
  turnSet: Set<string>;
}

interface AggregatedTimeline {
  nodes: Map<string, AggNode>;
  edges: Map<string, AggEdge>;
  seedTurnCount: number;
}

/**
 * 타임라인 rows → turn 별로 정렬한 뒤 연속 메타 노드 쌍을 인접 엣지로 누적.
 *
 *   - center(centerKind/centerName) 는 'center' key 로 흡수.
 *   - 그 외는 `${kind}::${name}` key (집계 카드 단위).
 *   - 연속 동일 key(자기 반복) 는 self-loop 회피로 엣지 생략, 노드 turnCount 만 증가.
 *   - 엣지 turnSet = 그 쌍이 등장한 turn 집합 → strength 빈도 환산용.
 */
function buildAggregatedTimeline(
  rows: TimelineRow[],
  centerKind: MetaDocKind,
  centerName: string,
  centerStartedAt: number,
  seedTurnCount: number,
): AggregatedTimeline {
  const keyOf = (kind: MetaDocKind, name: string): string =>
    kind === centerKind && name === centerName ? CENTER_ID : `${kind}::${name}`;

  // turn 별 그룹.
  const byTurn = new Map<string, TimelineRow[]>();
  for (const r of rows) {
    const list = byTurn.get(r.turn_id);
    if (list) list.push(r);
    else byTurn.set(r.turn_id, [r]);
  }

  const nodes = new Map<string, AggNode>();
  const edges = new Map<string, AggEdge>();

  for (const [turnId, list] of byTurn.entries()) {
    list.sort((a, b) =>
      a.started_at !== b.started_at ? a.started_at - b.started_at : a.tool_use_id.localeCompare(b.tool_use_id),
    );

    const seenInTurn = new Set<string>();
    let prevKey: string | null = null;

    for (const r of list) {
      const key = keyOf(r.kind, r.name);

      // 노드 누적.
      const existing = nodes.get(key);
      if (!existing) {
        nodes.set(key, {
          id: key,
          kind: key === CENTER_ID ? centerKind : r.kind,
          name: key === CENTER_ID ? centerName : r.name,
          started_at: key === CENTER_ID ? centerStartedAt : r.started_at,
          turnCount: 1,
        });
        seenInTurn.add(key);
      } else {
        if (key !== CENTER_ID && r.started_at < existing.started_at) existing.started_at = r.started_at;
        if (!seenInTurn.has(key)) {
          existing.turnCount += 1;
          seenInTurn.add(key);
        }
      }

      // 인접 엣지 (자기 반복 제외).
      if (prevKey !== null && prevKey !== key) {
        const ekey = `${prevKey}->${key}`;
        const e = edges.get(ekey);
        if (e) e.turnSet.add(turnId);
        else edges.set(ekey, { from: prevKey, to: key, turnSet: new Set([turnId]) });
      }
      prevKey = key;
    }
  }

  return { nodes, edges, seedTurnCount };
}

/**
 * layering 전용 DAG 엣지 생성 — 렌더링 엣지(built.edges)와 분리된 *계산용* 스냅샷.
 *
 * **원본 엣지 방향을 보존**한 채 cycle 만 최소로 끊는다(DFS back-edge 제거). 절대 시각으로
 * 방향을 통일하면 안 되는 이유: center 의 집계 started_at 은 시드의 *최소*(가장 이른 호출)라
 * 거의 전역 최소가 되고, 그러면 commit→push→center 같은 ancestor 체인까지 "center 이후"로
 * 뒤집혀 ancestor(좌측 음수 depth)가 사라진다. 인과 방향(turn 내 인접 순서)은 집계 엣지가
 * 이미 담고 있으므로 그것을 신뢰하고, 진짜 cycle(양방향 back-reference)만 제거한다.
 *
 * 알고리즘: 노드를 (started_at, id) 순으로 DFS. 현재 재귀 스택(GRAY)에 있는 노드로 향하는
 * 엣지(back-edge)만 드롭하고 나머지(tree/forward/cross)는 원본 방향 그대로 유지 → DAG 보장.
 * 정렬 기반이라 결과 결정성 100%.
 *
 * @param edges  집계 엣지 (양방향/중복 가능).
 * @param nodes  노드 맵 (결정적 정렬용 started_at 조회).
 * @returns      원본 방향 보존·back-edge 제거된 acyclic SortableEdge 배열.
 */
function buildAcyclicLayeringEdges(
  edges: AggEdge[],
  nodes: Map<string, AggNode>,
): SortableEdge[] {
  const rank = (id: string): number => nodes.get(id)?.started_at ?? 0;

  // 인접 리스트 (원본 방향). 결정성 위해 started_at→id 로 정렬.
  const adj = new Map<string, string[]>();
  for (const id of nodes.keys()) adj.set(id, []);
  const dedup = new Set<string>();
  for (const e of edges) {
    if (e.from === e.to) continue;
    if (!adj.has(e.from) || !adj.has(e.to)) continue;
    const key = `${e.from}->${e.to}`;
    if (dedup.has(key)) continue;
    dedup.add(key);
    adj.get(e.from)!.push(e.to);
  }
  const cmp = (a: string, b: string): number => (rank(a) !== rank(b) ? rank(a) - rank(b) : a.localeCompare(b));
  for (const list of adj.values()) list.sort(cmp);
  const startOrder = [...adj.keys()].sort(cmp);

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const id of adj.keys()) color.set(id, WHITE);

  const kept: SortableEdge[] = [];
  for (const root of startOrder) {
    if (color.get(root) !== WHITE) continue;
    // 명시 스택 DFS (깊은 체인에서 재귀 한계 회피).
    const stack: Array<{ id: string; i: number }> = [{ id: root, i: 0 }];
    color.set(root, GRAY);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const neighbors = adj.get(top.id)!;
      if (top.i < neighbors.length) {
        const to = neighbors[top.i++];
        const c = color.get(to);
        if (c === GRAY) continue; // back-edge → cycle 유발 → 드롭.
        kept.push({ from: top.id, to });
        if (c === WHITE) {
          color.set(to, GRAY);
          stack.push({ id: to, i: 0 });
        }
      } else {
        color.set(top.id, BLACK);
        stack.pop();
      }
    }
  }
  return kept;
}

// =============================================================================
// 응답 조립
// =============================================================================

function assembleResult(args: {
  params: UnifiedFlowParams;
  depth: number;
  built: AggregatedTimeline;
  layered: TopologicalResult;
  seedCount: number;
  durationMs: number;
}): UnifiedFlowResult {
  const { built, layered } = args;

  const layerOf = new Map<string, number>();
  layered.layers.forEach((ids, i) => ids.forEach((id) => layerOf.set(id, i)));
  const centerLayer = layerOf.get(CENTER_ID) ?? 0;

  // depth = layer - centerLayer (center=0, 이전=음수, 이후=양수).
  const depthByNode = new Map<string, number>();
  for (const n of built.nodes.values()) {
    depthByNode.set(n.id, (layerOf.get(n.id) ?? centerLayer) - centerLayer);
  }
  depthByNode.set(CENTER_ID, 0);

  // 컬럼 — depth 값별 그룹핑, 좌(음수)→center(0)→우(양수).
  const columns = buildColumns(depthByNode);
  const columnIndexByDepth = new Map<number, number>();
  columns.forEach((col, idx) => columnIndexByDepth.set(col.depth, idx));

  // 시간 색조 — started_at 5분위 양자화.
  const tones = computeLayerTones([...built.nodes.values()]);

  // 노드 조립.
  const nodes: UnifiedFlowNode[] = [];
  for (const n of built.nodes.values()) {
    const d = depthByNode.get(n.id) ?? 0;
    const isCenter = n.id === CENTER_ID;
    nodes.push({
      id: n.id,
      type: isCenter ? 'center' : n.kind,
      data: {
        kind: n.kind,
        name: n.name,
        started_at: n.started_at,
        depth: d,
        layer: layerOf.get(n.id) ?? 0,
        column: columnIndexByDepth.get(d) ?? 0,
        layerTone: tones.get(n.id) ?? 0,
      },
      _hydrated: true,
    });
  }

  // 엣지 조립 — 인접쌍 빈도 → strength.
  const edges: UnifiedFlowEdge[] = [];
  for (const e of built.edges.values()) {
    const weight = e.turnSet.size;
    const pct = built.seedTurnCount > 0 ? weight / built.seedTurnCount : 0;
    edges.push({
      id: `${e.from}->${e.to}`,
      source: e.from,
      target: e.to,
      type: 'CALL',
      strength: strengthFromPct(pct),
      data: { weight },
    });
  }

  return {
    nodes,
    edges,
    columns,
    meta: {
      centerKind: args.params.centerKind,
      centerName: args.params.centerName,
      depth: args.depth,
      seedCount: args.seedCount,
      cycleDetected: layered.cycleDetected,
      durationMs: args.durationMs,
    },
  };
}

/**
 * depth 값별 컬럼 분할 — 좌(center 이전, 음수)에서 우(center 이후, 양수) 순.
 * 빈 depth 는 컬럼에서 생략.
 */
function buildColumns(depthByNode: Map<string, number>): UnifiedFlowColumn[] {
  const byDepth = new Map<number, string[]>();
  for (const [nodeId, d] of depthByNode.entries()) {
    const list = byDepth.get(d);
    if (list) list.push(nodeId);
    else byDepth.set(d, [nodeId]);
  }
  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  return depths.map((d) => ({
    depth: d,
    tag: d < 0 ? 'ancestor' : d === 0 ? 'center' : 'descendant',
    nodeIds: byDepth.get(d) ?? [],
  }));
}

/**
 * 모든 노드의 started_at 을 5분위로 양자화하여 layerTone (0..4) 부여.
 * 동일 시각 다수로 분위가 무너지면 균등 분배 폴백.
 */
function computeLayerTones(nodes: AggNode[]): Map<string, number> {
  const tones = new Map<string, number>();
  if (nodes.length === 0) {
    tones.set(CENTER_ID, 0);
    return tones;
  }
  const sorted = [...nodes].sort((a, b) => a.started_at - b.started_at);
  const total = sorted.length;
  for (let i = 0; i < total; i++) {
    const tone = Math.min(LAYER_TONE_BUCKETS - 1, Math.floor((i * LAYER_TONE_BUCKETS) / total));
    tones.set(sorted[i].id, tone);
  }
  tones.set(CENTER_ID, tones.get(CENTER_ID) ?? 0);
  return tones;
}

// =============================================================================
// 유틸
// =============================================================================

/** pct(인접쌍 turn 비율) → strength. routes/graph.ts pctToStrength 와 동일 임계값. */
function strengthFromPct(pct: number): 'strong' | 'medium' | 'weak' | 'sparse' {
  if (pct >= 0.5) return 'strong';
  if (pct >= 0.2) return 'medium';
  if (pct >= 0.05) return 'weak';
  return 'sparse';
}

function clampDepth(d: number): number {
  if (!Number.isFinite(d) || d < 1) return DEFAULT_DEPTH;
  if (d > MAX_DEPTH) return MAX_DEPTH;
  return Math.floor(d);
}

function emptyResult(
  params: UnifiedFlowParams,
  depth: number,
  startedAt: number,
): UnifiedFlowResult {
  return {
    nodes: [],
    edges: [],
    columns: [],
    meta: {
      centerKind: params.centerKind,
      centerName: params.centerName,
      depth,
      seedCount: 0,
      cycleDetected: false,
      durationMs: Date.now() - startedAt,
    },
  };
}

/** 시드는 있으나 turn 정보가 없는 degenerate — center 노드 1개만. */
function centerOnlyResult(
  params: UnifiedFlowParams,
  centerStartedAt: number,
  depth: number,
  startedAt: number,
): UnifiedFlowResult {
  return {
    nodes: [
      {
        id: CENTER_ID,
        type: 'center',
        data: {
          kind: params.centerKind,
          name: params.centerName,
          started_at: centerStartedAt,
          depth: 0,
          layer: 0,
          column: 0,
          layerTone: 0,
        },
        _hydrated: true,
      },
    ],
    edges: [],
    columns: [{ depth: 0, tag: 'center', nodeIds: [CENTER_ID] }],
    meta: {
      centerKind: params.centerKind,
      centerName: params.centerName,
      depth,
      seedCount: 1,
      cycleDetected: false,
      durationMs: Date.now() - startedAt,
    },
  };
}

function normalizeKind(v: unknown): MetaDocKind {
  const s = String(v ?? '').toLowerCase();
  if (s === 'command' || s === 'skill' || s === 'agent' || s === 'mcp' || s === 'tool') return s;
  return 'tool';
}
