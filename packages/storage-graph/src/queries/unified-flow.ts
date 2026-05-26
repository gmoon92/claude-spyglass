/**
 * unified-flow.ts — 통합 메타 문서 흐름 (ancestor + center + descendant + turn-after)
 *
 * 책임:
 *   특정 메타 문서를 center 로 두고 좌(ancestor) · 중(center) · 우(descendant) · 우끝(turn-after)
 *   순으로 펼친 단일 시각화 응답을 만든다. ego(좌→우 통계 의존성)와 sequential(위→아래 인과)을
 *   직각 결합한 단일 SoT — 본 모듈 이후 두 분리 모듈은 폐기 (migration-plan §Phase A).
 *
 *   ego 모드의 좌측 trigger 컬럼 = ancestor (center 를 호출한 ToolCall 들의 메타 문서)
 *   ego 모드의 우측 call-tree   = descendant (center 가 호출한 ToolCall 들의 메타 문서)
 *   sequential 의 시간 흐름    = layerTone (started_at 5분위 양자화로 그라데이션 부여)
 *
 *   기존 sequential-flow 와 동일 패턴 SRP: 1 함수 = 1 Cypher. self-loop 격하, walk semantic
 *   `*1..$depth`, started_at ASC 정렬. 본 모듈은 *그래프 DB 쿼리 + 순수 TS 정렬* 의 조합.
 *
 * 의존성:
 *   - client.ts (LadybugClient)
 *   - topological-sort.ts (Kahn 위상정렬 — sequential 과 동일)
 *
 * 호출 흐름:
 *   routes/graph.ts::handleUnifiedFlow
 *     → getUnifiedFlow(client, { centerKind, centerName, depth, fromTs, toTs, project, maxSeeds })
 *         → 1) fetchCenterSeeds       — center 메타가 사용된 ToolCall 시드
 *         → 2) fetchDescendantChain   — seed → PARENT_OF*1..depth → 자손
 *         → 3) fetchAncestorChain     — *부모 가변 깊이 traversal (좌측 컬럼)
 *         → 4) fetchTurnAfter         — 같은 turn 안 center 이후
 *         → 5) topologicalLayers      — Kahn DAG layer
 *         → 6) computeColumns/Tones   — 좌→우 컬럼 인덱스 + 시간 layer 색조
 *         → assembleResult            — { nodes, edges, columns, meta }
 *
 * 응답 계약 (UnifiedFlowResult):
 *   nodes[].data.depth — 음수=ancestor, 0=center 또는 seed, 양수=descendant, -1 timeline=after
 *   nodes[].data.column — viewport 좌→우 컬럼 인덱스 (0 부터)
 *   nodes[].data.layerTone — 0..4 (5분위), CSS `--card-tone-layer-N` 매핑 키
 *
 *   카드 표면 SSoT 필드 (count/pct/invocations/timeline/subRows/pills) 는 본 쿼리가 *채우지
 *   않는다* — routes/graph.ts 의 enrich 단계가 (kind, name) 단위 집계 후 부착. 본 모듈은
 *   raw ToolCall 단위 결과만 보장.
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

/** 응답 노드. sequential 의 SequentialNode 와 동일 표면 + column/layerTone 추가. */
export interface UnifiedFlowNode {
  /** 그래프 식별자 — 일반적으로 `tool_use_id` (center 는 합성 'center'). */
  id: string;
  /** 노드 카테고리. UI 색상/아이콘 매핑 키. */
  type: MetaDocKind | 'center';
  data: {
    kind: MetaDocKind;
    name: string;
    tool_use_id?: string;
    started_at: number;
    /** 음수=ancestor / 0=center 또는 직접 seed / 양수=descendant / -1=turn-after */
    depth: number;
    /** layer index (Kahn 결과) — 향후 시각 보조용 (현재 layerTone 으로 대체 가능). */
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
  /** CALL = 인과 호출 (실선), AFTER = 시간 흐름만 (점선). */
  type: 'CALL' | 'AFTER';
  /** enrich 단계가 부여하는 호출 빈도 강도 — Cypher 자체는 'medium' 기본. */
  strength?: 'strong' | 'medium' | 'weak' | 'sparse';
  data?: { via_tool_use_id?: string };
}

export interface UnifiedFlowParams {
  centerKind: MetaDocKind;
  centerName: string;
  /** 가변 깊이 상한 (1~7). ancestor/descendant 양쪽 동일하게 적용. 기본 3. */
  depth?: number;
  project?: string | null;
  fromTs?: number;
  toTs?: number;
  /** seed (center 메타가 사용된) ToolCall 최대 개수. 기본 32. */
  maxSeeds?: number;
}

export interface UnifiedFlowColumn {
  /** depth 값 — 음수=ancestor, 0=center, 양수=descendant, -1 사용은 turn-after 만. */
  depth: number;
  /** 'ancestor' | 'center' | 'descendant' | 'after' — UI 가 라벨/스타일 분기. */
  tag: 'ancestor' | 'center' | 'descendant' | 'after';
  /** 이 컬럼에 속한 node id 들 (count DESC 정렬은 enrich 단계). */
  nodeIds: string[];
}

export interface UnifiedFlowResult {
  nodes: UnifiedFlowNode[];
  edges: UnifiedFlowEdge[];
  /** 좌→우 컬럼 정의. ancestor 깊은 쪽이 0, turn-after 가 마지막. */
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

// depth 정책 (사용자 명시 2026-05-26):
//   기존 SQLite ego BFS 는 성능 한계로 depth 3 제약. graph DB 로 이관한 이후엔 호출 트리
//   *모두* 표시되도록 사실상 무제한. Ladybug 0.16 은 가변길이 path 의 상한을 30 으로
//   하드 제한 (`Upper bound of rel exceeds maximum: 30`) — 그 한도를 그대로 채택해
//   실제로는 무제한과 동일 효과 (Claude Code 호출 트리가 30 단계를 넘는 경우 극히 드묾).
const DEFAULT_DEPTH = 30;
const MAX_DEPTH = 30;
const DEFAULT_MAX_SEEDS = 32;
const TURN_AFTER_LIMIT = 16;
/** 시간 그라데이션 양자화 단계 수. CSS variable `--card-tone-layer-0..4` 와 1:1. */
const LAYER_TONE_BUCKETS = 5;

// =============================================================================
// 메인 진입점 — 5단계 알고리즘
// =============================================================================

/**
 * 통합 Flow 데이터 생성.
 *
 * 단계:
 *   1) fetchCenterSeeds        — center 메타가 사용된 ToolCall 시드
 *   2) fetchDescendantChain    — seed → PARENT_OF*1..depth → 자손 메타 문서
 *   3) fetchAncestorChain      — *부모 traversal: ancestor → ... → seed (좌측 컬럼)
 *   4) fetchTurnAfter          — 같은 turn 안 center 이후 메타 문서
 *   5) topologicalLayers       — Kahn DAG layer 분리 + started_at ASC
 *   + computeColumns/Tones     — 좌→우 컬럼 인덱스 + 시간 layer 색조
 */
export async function getUnifiedFlow(
  client: LadybugClient,
  params: UnifiedFlowParams,
): Promise<UnifiedFlowResult> {
  const started = Date.now();
  const depth = clampDepth(params.depth ?? DEFAULT_DEPTH);
  const maxSeeds = params.maxSeeds ?? DEFAULT_MAX_SEEDS;

  // ── 1) Center anchor ────────────────────────────────────────────────────
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

  const seedIds = seeds.map((s) => s.tool_use_id);

  // ── 2~4) 자손 / 조상 / turn-after ────────────────────────────────────────
  // 세 쿼리는 서로 독립이므로 병렬 실행 — Cypher 1회 비용을 RT 단축.
  const [descendantRows, ancestorRows, turnAfterRows] = await Promise.all([
    fetchDescendantChain(client, {
      seedIds,
      depth,
      centerKind: params.centerKind,
      centerName: params.centerName,
    }),
    fetchAncestorChain(client, {
      seedIds,
      depth,
      centerKind: params.centerKind,
      centerName: params.centerName,
    }),
    fetchTurnAfter(client, {
      centerKind: params.centerKind,
      centerName: params.centerName,
      seedIds,
    }),
  ]);

  // ── 5) Kahn 위상 정렬 ────────────────────────────────────────────────────
  const sortInput = buildSortInput(seeds, descendantRows, ancestorRows, turnAfterRows);
  const layered = topologicalLayers(sortInput);

  // ── 응답 조립 ────────────────────────────────────────────────────────────
  return assembleResult({
    params,
    depth,
    seeds,
    descendantRows,
    ancestorRows,
    turnAfterRows,
    layered,
    durationMs: Date.now() - started,
  });
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
 * Cypher 패턴:
 *   MATCH (md:MetaDocument {kind, name}) <-[:USES]- (seed:ToolCall)
 *   WHERE (선택적 시간/프로젝트 필터)
 *   RETURN seed.tool_use_id, seed.started_at, seed.turn_id, seed.session_id
 *   ORDER BY seed.started_at ASC
 *   LIMIT $maxSeeds
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
// Cypher 2 — fetchDescendantChain (depth 양수)
// =============================================================================

interface ChainRow {
  tool_use_id: string;
  kind: MetaDocKind;
  name: string;
  started_at: number;
  /** ancestor 는 음수, descendant 는 양수. */
  depth: number;
  chain: string[];
  /** 인접 노드 (descendant 의 경우 부모, ancestor 의 경우 자식). 엣지 source 로 사용. */
  adjacent_tool_use_id: string;
}

interface FetchChainParams {
  seedIds: string[];
  depth: number;
  centerKind: MetaDocKind;
  centerName: string;
}

/**
 * seed → PARENT_OF*1..depth → 자손 ToolCall 들.
 *
 *   - chain[0]   = seed
 *   - chain[-1]  = 자기 자신 (자손 ToolCall)
 *   - adjacent   = chain[-2] (자기 부모) — 엣지 source
 */
async function fetchDescendantChain(client: LadybugClient, p: FetchChainParams): Promise<ChainRow[]> {
  // Ladybug 0.16 의 Cypher subset 은 list comprehension `[var IN list | expr]` 을 미지원
  // (`Binder exception: Variable n is not in scope.`). 대신 `nodes(path)` 를 raw 로 받아
  // 클라이언트에서 tool_use_id 만 추출 — 결과 동일, 네트워크/직렬화 비용은 path 노드 객체
  // 자체를 들고 온다는 점만 차이.
  const cypher =
    `MATCH path = (seed:ToolCall) ` +
    `      -[:PARENT_OF*1..${p.depth}]->(child:ToolCall) ` +
    `      -[:USES]->(metadoc:MetaDocument) ` +
    `WHERE seed.tool_use_id IN $seedIds ` +
    `  AND NOT (metadoc.kind = $centerKind AND metadoc.name = $centerName) ` +
    `RETURN metadoc.kind          AS kind, ` +
    `       metadoc.name          AS name, ` +
    `       child.tool_use_id     AS tool_use_id, ` +
    `       child.started_at      AS started_at, ` +
    `       length(path)          AS depth, ` +
    `       nodes(path)           AS path_nodes ` +
    `ORDER BY child.started_at ASC, depth ASC`;

  const result = await client.query(cypher, {
    seedIds: p.seedIds,
    centerKind: p.centerKind,
    centerName: p.centerName,
  });

  return result.rows
    .map((r) => {
      const chain = extractChainFromPathNodes(r.path_nodes);
      const adjacent = chain.length >= 2 ? chain[chain.length - 2] : '';
      return {
        tool_use_id: String(r.tool_use_id),
        kind: normalizeKind(r.kind),
        name: String(r.name),
        started_at: Number(r.started_at),
        depth: Number(r.depth), // 양수 그대로
        chain,
        adjacent_tool_use_id: adjacent,
      };
    })
    .filter((r) => r.adjacent_tool_use_id.length > 0);
}

/**
 * `nodes(path)` 의 원시 노드 객체 배열에서 tool_use_id chain 만 추출.
 *
 *   각 path 노드는 Ladybug native 객체로 `{_label, _id, tool_use_id, ...}` 형태이거나
 *   plain object 인 경우(`{tool_use_id: ...}`)도 있다. 두 패턴 모두 흡수.
 *   tool_use_id 가 없는 (예: USES 끝의 MetaDocument 노드) 항목은 chain 에서 제외 — chain 은
 *   ToolCall 사이의 PARENT_OF 경로만 표현하기 때문.
 */
function extractChainFromPathNodes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const n of raw) {
    if (n && typeof n === 'object') {
      const tu = (n as Record<string, unknown>).tool_use_id;
      if (typeof tu === 'string' && tu.length > 0) out.push(tu);
    }
  }
  return out;
}

// =============================================================================
// Cypher 3 — fetchAncestorChain (depth 음수)
// =============================================================================

/**
 * *부모 가변 깊이 traversal — center seed 의 ancestor ToolCall + 그 메타 문서.
 *
 * Cypher 패턴 (방향 역전):
 *   MATCH path = (ancestor:ToolCall)
 *         -[:PARENT_OF*1..$depth]->(seed:ToolCall)
 *   MATCH (ancestor)-[:USES]->(metadoc:MetaDocument)
 *   WHERE seed.tool_use_id IN $seedIds
 *     AND NOT (metadoc.kind = $centerKind AND metadoc.name = $centerName)
 *   RETURN ...
 *
 *   - chain[0]   = ancestor (좌측 가장 깊은 쪽)
 *   - chain[-1]  = seed (자기 자신)
 *   - adjacent   = chain[1] (자기 자식, descendant 쪽) — 엣지 source 로 사용
 *
 * depth 부호는 응답에서 *음수*로 변환되어 column 매핑에 쓰임.
 */
async function fetchAncestorChain(client: LadybugClient, p: FetchChainParams): Promise<ChainRow[]> {
  // descendant 와 동일 — Ladybug list comprehension 미지원이라 nodes(path) raw 반환 후 클라
  // 사이드에서 chain 추출.
  const cypher =
    `MATCH path = (ancestor:ToolCall) ` +
    `      -[:PARENT_OF*1..${p.depth}]->(seed:ToolCall) ` +
    `MATCH (ancestor)-[:USES]->(metadoc:MetaDocument) ` +
    `WHERE seed.tool_use_id IN $seedIds ` +
    `  AND NOT (metadoc.kind = $centerKind AND metadoc.name = $centerName) ` +
    `RETURN metadoc.kind          AS kind, ` +
    `       metadoc.name          AS name, ` +
    `       ancestor.tool_use_id  AS tool_use_id, ` +
    `       ancestor.started_at   AS started_at, ` +
    `       length(path)          AS depth, ` +
    `       nodes(path)           AS path_nodes ` +
    `ORDER BY ancestor.started_at ASC, depth ASC`;

  const result = await client.query(cypher, {
    seedIds: p.seedIds,
    centerKind: p.centerKind,
    centerName: p.centerName,
  });

  return result.rows
    .map((r) => {
      const chain = extractChainFromPathNodes(r.path_nodes);
      // ancestor 는 chain[0] 자기 자신, chain[1] = 자식 (descendant 방향)
      const adjacent = chain.length >= 2 ? chain[1] : '';
      const rawDepth = Number(r.depth);
      return {
        tool_use_id: String(r.tool_use_id),
        kind: normalizeKind(r.kind),
        name: String(r.name),
        started_at: Number(r.started_at),
        depth: -Math.abs(rawDepth), // 음수로 강제
        chain,
        adjacent_tool_use_id: adjacent,
      };
    })
    .filter((r) => r.adjacent_tool_use_id.length > 0);
}

// =============================================================================
// Cypher 4 — fetchTurnAfter (sequential 과 동일)
// =============================================================================

interface TurnAfterRow {
  tool_use_id: string;
  kind: MetaDocKind;
  name: string;
  started_at: number;
  turn_id: string;
}

interface FetchTurnAfterParams {
  centerKind: MetaDocKind;
  centerName: string;
  seedIds: string[];
}

async function fetchTurnAfter(client: LadybugClient, p: FetchTurnAfterParams): Promise<TurnAfterRow[]> {
  const cypher =
    `MATCH (center_md:MetaDocument {kind: $centerKind, name: $centerName}) ` +
    `      <-[:USES]-(seed:ToolCall) ` +
    `      <-[:CALLED]-(:Agent)<-[:SPAWNED]-(t:Turn) ` +
    `WHERE seed.tool_use_id IN $seedIds ` +
    `WITH t, max(seed.started_at) AS center_at, collect(seed.tool_use_id) AS seed_ids ` +
    `MATCH (t)-[:SPAWNED]->(:Agent)-[:CALLED]->(later:ToolCall) ` +
    `      -[:USES]->(metadoc:MetaDocument) ` +
    `WHERE later.started_at > center_at ` +
    `  AND NOT later.tool_use_id IN seed_ids ` +
    `  AND NOT (metadoc.kind = $centerKind AND metadoc.name = $centerName) ` +
    `RETURN metadoc.kind          AS kind, ` +
    `       metadoc.name          AS name, ` +
    `       later.tool_use_id     AS tool_use_id, ` +
    `       later.started_at      AS started_at, ` +
    `       t.id                  AS turn_id ` +
    `ORDER BY later.started_at ASC ` +
    `LIMIT ${TURN_AFTER_LIMIT}`;

  const result = await client.query(cypher, {
    centerKind: p.centerKind,
    centerName: p.centerName,
    seedIds: p.seedIds,
  });

  return result.rows.map((r) => ({
    tool_use_id: String(r.tool_use_id),
    kind: normalizeKind(r.kind),
    name: String(r.name),
    started_at: Number(r.started_at),
    turn_id: String(r.turn_id),
  }));
}

// =============================================================================
// 응답 조립 — Cypher 결과 → UnifiedFlowResult
// =============================================================================

/** Kahn 입력 빌드 — center + seeds + descendant + ancestor + turn-after 모두 포함. */
function buildSortInput(
  seeds: SeedRow[],
  descendantRows: ChainRow[],
  ancestorRows: ChainRow[],
  turnAfterRows: TurnAfterRow[],
): { nodes: SortableNode[]; edges: SortableEdge[] } {
  const nodeMap = new Map<string, SortableNode>();
  const edges: SortableEdge[] = [];

  // center 합성 노드 — layer 0 보장. seeds 는 별도 노드로 추가하지 않고 'center' 로 흡수.
  const centerStartedAt = seeds.length > 0 ? Math.min(...seeds.map((s) => s.started_at)) : 0;
  nodeMap.set('center', { id: 'center', started_at: centerStartedAt });
  const seedIdSet = new Set(seeds.map((s) => s.tool_use_id));
  const remap = (id: string): string => (seedIdSet.has(id) ? 'center' : id);

  // descendant — 부모 → 자식 엣지. (Kahn 방향: 부모 → 자식)
  //   *seed 부모는 'center' 로 라우팅* — seed 자체는 노드 목록에 추가하지 않음.
  for (const row of descendantRows) {
    if (!nodeMap.has(row.tool_use_id)) {
      nodeMap.set(row.tool_use_id, { id: row.tool_use_id, started_at: row.started_at });
    }
    if (row.adjacent_tool_use_id) {
      const from = remap(row.adjacent_tool_use_id);
      const to = remap(row.tool_use_id);
      if (from !== to && nodeMap.has(from) && nodeMap.has(to)) {
        edges.push({ from, to });
      }
    }
  }

  // ancestor — ancestor → 자식 엣지. (Kahn 방향: ancestor 가 더 이른 시점 → 자식)
  for (const row of ancestorRows) {
    if (!nodeMap.has(row.tool_use_id)) {
      nodeMap.set(row.tool_use_id, { id: row.tool_use_id, started_at: row.started_at });
    }
    if (row.adjacent_tool_use_id) {
      const from = remap(row.tool_use_id);
      const to = remap(row.adjacent_tool_use_id);
      if (from !== to && nodeMap.has(from) && nodeMap.has(to)) {
        edges.push({ from, to });
      }
    }
  }

  // turn-after — center 와 직접 엣지 (AFTER 의미).
  for (const row of turnAfterRows) {
    if (!nodeMap.has(row.tool_use_id)) {
      nodeMap.set(row.tool_use_id, { id: row.tool_use_id, started_at: row.started_at });
    }
    edges.push({ from: 'center', to: row.tool_use_id });
  }

  return { nodes: [...nodeMap.values()], edges };
}

/** 응답 노드 빌드 + column/layerTone 부여. */
function assembleResult(args: {
  params: UnifiedFlowParams;
  depth: number;
  seeds: SeedRow[];
  descendantRows: ChainRow[];
  ancestorRows: ChainRow[];
  turnAfterRows: TurnAfterRow[];
  layered: TopologicalResult;
  durationMs: number;
}): UnifiedFlowResult {
  const layerOf = new Map<string, number>();
  args.layered.layers.forEach((ids, i) => ids.forEach((id) => layerOf.set(id, i)));

  // depth-by-node 임시 매핑 — column 계산을 위해 모든 노드의 depth 를 미리 정함.
  const depthByNode = new Map<string, number>();
  depthByNode.set('center', 0);
  for (const s of args.seeds) depthByNode.set(s.tool_use_id, 0);
  for (const row of args.descendantRows) {
    // 더 가까운 depth (작은 절댓값) 우선 — diamond 패턴 대비.
    const prev = depthByNode.get(row.tool_use_id);
    if (prev === undefined || Math.abs(row.depth) < Math.abs(prev)) {
      depthByNode.set(row.tool_use_id, row.depth);
    }
  }
  for (const row of args.ancestorRows) {
    const prev = depthByNode.get(row.tool_use_id);
    if (prev === undefined || Math.abs(row.depth) < Math.abs(prev)) {
      depthByNode.set(row.tool_use_id, row.depth);
    }
  }
  // turn-after — *descendant/ancestor 가 아직 매핑하지 않은 노드만* -1 로 표시.
  //   descendant 가 우선 (인과 분류가 더 강한 시그널). 같은 노드가 descendant 와
  //   turn-after 양쪽에 등장하는 케이스(같은 turn 의 후속 자식들) 에서 회귀 방어.
  for (const row of args.turnAfterRows) {
    if (!depthByNode.has(row.tool_use_id)) {
      depthByNode.set(row.tool_use_id, -1);
    }
  }

  // 컬럼 매핑 — depth 값별로 그룹핑. ancestor(음수 -depth..-1) → center(0) → descendant(1..+depth) → after
  const columns = buildColumns(depthByNode, args.turnAfterRows.map((r) => r.tool_use_id));
  const columnIndexByDepth = new Map<number, number>();
  const columnTagByDepth = new Map<number, UnifiedFlowColumn['tag']>();
  columns.forEach((col, idx) => {
    columnIndexByDepth.set(col.depth, idx);
    columnTagByDepth.set(col.depth, col.tag);
  });

  // 시간 그라데이션 — 모든 노드의 started_at 5분위 양자화.
  const tonesById = computeLayerTones(args.seeds, args.descendantRows, args.ancestorRows, args.turnAfterRows);

  // ── 노드 조립 ────────────────────────────────────────────────────────────
  const nodes: UnifiedFlowNode[] = [];

  // center 합성 노드 — *seeds 는 별도 노드로 두지 않고 center 1개로 흡수*.
  //   self-loop 격하 정책상 (centerKind, centerName) 노드는 결과에 1번만 존재.
  //   엣지 라우팅에서 seed.tool_use_id 는 'center' 로 remap (아래 엣지 조립 단계).
  const centerStartedAt = args.seeds.length > 0 ? Math.min(...args.seeds.map((s) => s.started_at)) : 0;
  nodes.push({
    id: 'center',
    type: 'center',
    data: {
      kind: args.params.centerKind,
      name: args.params.centerName,
      started_at: centerStartedAt,
      depth: 0,
      layer: layerOf.get('center') ?? 0,
      column: columnIndexByDepth.get(0) ?? 0,
      layerTone: tonesById.get('center') ?? 0,
    },
    _hydrated: true,
  });

  // seedId → 'center' remap (엣지 조립에서 사용).
  const seedIdSet = new Set(args.seeds.map((s) => s.tool_use_id));

  // descendant.
  for (const row of args.descendantRows) {
    const finalDepth = depthByNode.get(row.tool_use_id) ?? row.depth;
    nodes.push({
      id: row.tool_use_id,
      type: row.kind,
      data: {
        kind: row.kind,
        name: row.name,
        tool_use_id: row.tool_use_id,
        started_at: row.started_at,
        depth: finalDepth,
        layer: layerOf.get(row.tool_use_id) ?? row.depth,
        column: columnIndexByDepth.get(finalDepth) ?? 0,
        layerTone: tonesById.get(row.tool_use_id) ?? 0,
        chain: row.chain,
      },
      _hydrated: true,
    });
  }

  // ancestor.
  for (const row of args.ancestorRows) {
    const finalDepth = depthByNode.get(row.tool_use_id) ?? row.depth;
    nodes.push({
      id: row.tool_use_id,
      type: row.kind,
      data: {
        kind: row.kind,
        name: row.name,
        tool_use_id: row.tool_use_id,
        started_at: row.started_at,
        depth: finalDepth,
        layer: layerOf.get(row.tool_use_id) ?? Math.abs(row.depth),
        column: columnIndexByDepth.get(finalDepth) ?? 0,
        layerTone: tonesById.get(row.tool_use_id) ?? 0,
        chain: row.chain,
      },
      _hydrated: true,
    });
  }

  // turn-after — depth=-1 표식. column 은 'after' 마지막.
  for (const row of args.turnAfterRows) {
    nodes.push({
      id: row.tool_use_id,
      type: row.kind,
      data: {
        kind: row.kind,
        name: row.name,
        tool_use_id: row.tool_use_id,
        started_at: row.started_at,
        depth: -1,
        layer: layerOf.get(row.tool_use_id) ?? 0,
        column: columnIndexByDepth.get(-1) ?? columns.length - 1,
        layerTone: tonesById.get(row.tool_use_id) ?? LAYER_TONE_BUCKETS - 1,
        timeline: 'after',
      },
      _hydrated: true,
    });
  }

  const dedupNodes = dedupById(nodes);

  // ── 엣지 조립 — seedId 는 'center' 로 remap (별도 seed 노드 없음) ──────
  const remap = (id: string): string => (seedIdSet.has(id) ? 'center' : id);
  const edges: UnifiedFlowEdge[] = [];

  // descendant: 부모 → 자식. seed 부모는 'center' 로 라우팅.
  for (const row of args.descendantRows) {
    if (row.adjacent_tool_use_id) {
      const source = remap(row.adjacent_tool_use_id);
      const target = remap(row.tool_use_id);
      if (source === target) continue;
      edges.push({
        id: `${source}->${target}`,
        source,
        target,
        type: 'CALL',
        strength: 'medium',
        data: { via_tool_use_id: row.tool_use_id },
      });
    }
  }
  // ancestor: ancestor → 자식. 자식이 seed 면 'center' 로 라우팅.
  for (const row of args.ancestorRows) {
    if (row.adjacent_tool_use_id) {
      const source = remap(row.tool_use_id);
      const target = remap(row.adjacent_tool_use_id);
      if (source === target) continue;
      edges.push({
        id: `${source}->${target}`,
        source,
        target,
        type: 'CALL',
        strength: 'medium',
        data: { via_tool_use_id: row.tool_use_id },
      });
    }
  }
  // turn-after: center 점선.
  for (const row of args.turnAfterRows) {
    edges.push({
      id: `center~${row.tool_use_id}`,
      source: 'center',
      target: row.tool_use_id,
      type: 'AFTER',
      strength: 'sparse',
    });
  }
  const dedupEdges = dedupById(edges);

  return {
    nodes: dedupNodes,
    edges: dedupEdges,
    columns,
    meta: {
      centerKind: args.params.centerKind,
      centerName: args.params.centerName,
      depth: args.depth,
      seedCount: args.seeds.length,
      cycleDetected: args.layered.cycleDetected,
      durationMs: args.durationMs,
    },
  };
}

// =============================================================================
// 컬럼 / 색조 계산
// =============================================================================

/**
 * depth 값별 컬럼 분할 — 좌(ancestor 깊은쪽)에서 우(turn-after) 순.
 *
 * 컬럼 순서:
 *   [ancestor depth=-N..-2..-1] → [center 0] → [descendant 1..2..N] → [after]
 *
 * 빈 depth 는 컬럼에서 생략 (e.g. ancestor 가 없으면 음수 컬럼 자체가 없음).
 */
function buildColumns(
  depthByNode: Map<string, number>,
  turnAfterNodeIds: string[],
): UnifiedFlowColumn[] {
  const turnAfterSet = new Set(turnAfterNodeIds);
  const byDepth = new Map<number, string[]>();

  for (const [nodeId, d] of depthByNode.entries()) {
    if (turnAfterSet.has(nodeId)) continue; // turn-after 는 별도 처리
    const list = byDepth.get(d) ?? [];
    list.push(nodeId);
    byDepth.set(d, list);
  }

  // 정렬: 음수(ancestor) 깊은 쪽 → 0(center) → 양수(descendant) → after
  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  const columns: UnifiedFlowColumn[] = depths.map((d) => ({
    depth: d,
    tag: d < 0 ? 'ancestor' : d === 0 ? 'center' : 'descendant',
    nodeIds: byDepth.get(d) ?? [],
  }));

  if (turnAfterNodeIds.length > 0) {
    columns.push({
      depth: -1, // 표식 (음수 ancestor 와 구분은 tag 로)
      tag: 'after',
      nodeIds: turnAfterNodeIds,
    });
  }

  return columns;
}

/**
 * 모든 노드의 started_at 을 5분위로 양자화하여 layerTone (0..4) 부여.
 *
 *   - 가장 이른 20% → tone 0 (가장 어두운 톤, 'older')
 *   - 가장 늦은 20% → tone 4 (가장 밝은 톤, 'newer')
 *   - center 는 0 또는 노드 분포 중앙값으로 — 별도 강조 ('center' 카드 자체 .is-center)
 *
 * 동일 시각이 많아 분위가 무너지면 균등 분배로 폴백.
 */
function computeLayerTones(
  seeds: SeedRow[],
  descendantRows: ChainRow[],
  ancestorRows: ChainRow[],
  turnAfterRows: TurnAfterRow[],
): Map<string, number> {
  type Entry = { id: string; started_at: number };
  const entries: Entry[] = [];
  for (const s of seeds) entries.push({ id: s.tool_use_id, started_at: s.started_at });
  for (const r of descendantRows) entries.push({ id: r.tool_use_id, started_at: r.started_at });
  for (const r of ancestorRows) entries.push({ id: r.tool_use_id, started_at: r.started_at });
  for (const r of turnAfterRows) entries.push({ id: r.tool_use_id, started_at: r.started_at });

  const tones = new Map<string, number>();
  if (entries.length === 0) {
    tones.set('center', 0);
    return tones;
  }

  // 같은 노드 id 중복 시 가장 이른 started_at 만 유지.
  const dedup = new Map<string, number>();
  for (const e of entries) {
    const prev = dedup.get(e.id);
    if (prev === undefined || e.started_at < prev) dedup.set(e.id, e.started_at);
  }
  const sorted = [...dedup.entries()].sort((a, b) => a[1] - b[1]);

  // 5분위 양자화 — 균등 분배.
  const total = sorted.length;
  for (let i = 0; i < total; i++) {
    const tone = Math.min(LAYER_TONE_BUCKETS - 1, Math.floor((i * LAYER_TONE_BUCKETS) / total));
    tones.set(sorted[i][0], tone);
  }

  // center 카드는 가장 이른 시점 톤 — UI 가 별도 .is-center 강조.
  tones.set('center', 0);

  return tones;
}

// =============================================================================
// 유틸
// =============================================================================

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

function dedupById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Map<string, T>();
  for (const it of items) {
    if (!seen.has(it.id)) seen.set(it.id, it);
  }
  return [...seen.values()];
}

function normalizeKind(v: unknown): MetaDocKind {
  const s = String(v ?? '').toLowerCase();
  if (s === 'command' || s === 'skill' || s === 'agent' || s === 'mcp' || s === 'tool') return s;
  return 'tool';
}
