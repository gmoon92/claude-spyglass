/**
 * sequential-flow.ts — "메타 문서 연관 순서도 (Sequential Flowchart)" 진입점
 *
 * 책임 (Single Responsibility):
 *   특정 메타 문서를 center 로 두고, 그 메타 문서가 유발한 ToolCall 들과 자손 chain
 *   (`PARENT_OF*1..depth`) 을 시간 + 인과 순으로 펼친 순서도 데이터를 생성한다.
 *   06 보고서 §3.3 의 4단계 알고리즘을 그대로 구현 — 본 모듈은 *그래프 DB 쿼리* +
 *   *순수 TS 정렬* 의 조합으로 응답을 만든다.
 *
 * 의존성:
 *   - client.ts (LadybugClient — Cypher query/transaction 단일 진입점)
 *   - topological-sort.ts (Kahn 위상 정렬 헬퍼, started_at ASC priority)
 *   - runtime/circuit-breaker (Cypher 실패 시 회로 보고는 client.ts 가 책임)
 *
 * 호출 흐름:
 *   routes/graph.ts::handleSequentialFlow
 *     → getSequentialFlow(client, { centerKind, centerName, depth, project?, fromTs?, toTs? })
 *         → 1) fetchCenterSeeds      — Cypher 1쿼리 → seed ToolCall 집합
 *         → 2) fetchChainTraversal   — Cypher *1..depth 가변 깊이 traversal
 *         → 3) fetchTurnAfter        — 같은 turn 의 center 이후 호출
 *         → 4) topologicalLayers     — Kahn DAG layer 분리
 *         → assembleResult           — {nodes, edges, layers, meta}
 *
 * 디자인 결정 (06 §3.3):
 *   - Cypher 4쿼리로 분리 — 각 함수가 1쿼리만 발행하고 결과를 정규화. SRP 원칙.
 *   - 가변 깊이 `*1..$depth` 는 walk semantic 사용 — upper bound 명시 필수 (Kuzu/Ladybug).
 *   - self-loop 격하: center 와 동일한 (kind,name) 메타 문서는 결과에서 제외.
 *   - 응답 셰이프 `{nodes, edges, layers, meta}` — 03 보고서 (`{nodes, edges}` 표준)
 *     의 확장. layers 는 메타 정보로만 추가, 프론트는 layer index → y 좌표 매핑.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/.tmp/plans/spyglass/graph-db-research/06-sequential-flowchart.md
 *   §3.3 알고리즘 / §3.5 시각화 형태 / §4.3 검증 쿼리 V-1~V-5.
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

/** 응답 노드. 03 보고서의 `{nodes, edges}` 계약 확장 + 메타 문서 kind. */
export interface SequentialNode {
  /** 그래프 식별자 — 일반적으로 `tool_use_id` (center 는 합성 'center'). */
  id: string;
  /** 노드 카테고리. UI 색상/아이콘 매핑 키. */
  type: MetaDocKind | 'center';
  /** 그래프 DB 가 보유한 모든 property 를 그대로 위임 — 프론트가 자유롭게 사용. */
  data: {
    kind: MetaDocKind;
    name: string;
    tool_use_id?: string;
    started_at: number;
    depth: number;
    layer: number;
    /** chain 경로 (root → 자기 자신) 의 tool_use_id 들. UI traversal 시각화 용. */
    chain?: string[];

    // ─── 카드 뷰 메타데이터 (어댑터 enrich 단계가 채움 — 그래프 DB 쿼리 자체는 무관) ───
    //
    //   `routes/graph.ts`의 어댑터(SQLite/graph DB 양쪽)가 `(kind,name)` 단위
    //   distinct turn count 와 백분율을 계산해 카드 sub 영역과 그룹/HOT 표시에 쓴다.
    //   ego 모드(`meta-docs-flow-view.js`)의 카드 SSoT(spoke/group/HOT pill)와 동일 표면.
    //
    //   본 필드는 그래프 DB 쿼리(`getSequentialFlow`) 가 채우지 않는다 — ToolCall 단위
    //   raw 노드에는 의미가 없기 때문(같은 (kind,name) 노드 N개 존재 가능). 어댑터 enrich
    //   가 (kind,name) 기준 집계 후에만 부착한다.

    /** distinct turn count — 이 (kind,name) 메타 문서가 등장한 turn 수. */
    count?: number;
    /** count / centerTurns (0~1). 카드 sub 의 "N turns · M%" M 값. */
    pct?: number;
    /** center 카드의 누적 호출 수 (COUNT(*)) — center 일 때만 채움. */
    invocations?: number;
    /** 'after' = 같은 turn 후속(시간 흐름). 부재 시 호출 인과 노드. */
    timeline?: 'after' | null;
    /**
     * MCP 서버 단위 그룹 카드일 때만 채워진다.
     *
     * 같은 layer 안에서 동일 server 의 mcp 도구가 2개+ 면 어댑터가 server 그룹
     * 카드 1개로 묶고, 그 카드의 sub-row 리스트로 각 도구의 풀네임/짧은이름/turns/%
     * 를 부착. UI 의 `.sub-row[data-tool-name]` 클릭이 해당 풀네임을 center 로 재로드.
     * (meta-docs-flow-mcp-grouping — ego 모드의 동일 정책을 sequential 카드에도 적용)
     */
    subRows?: Array<{
      /** 풀네임 (e.g. 'mcp__redmine__getIssue') — 클릭 시 새 center 로 사용. */
      fullName: string;
      /** 표시용 짧은 이름 (e.g. 'getIssue'). parseMcpToolName 실패 시 풀네임 그대로. */
      toolName: string;
      count: number;
      /** 0~100 정수 — 카드 sub-row 의 우측 통계용. */
      pct: number;
    }>;
    /**
     * 카드 우상단 보조 배지. 현재는 'hot' 만 정의.
     *
     *   - 'hot' : centerTurns / totalTurns ≥ 0.4 일 때 center 카드에만 부착.
     *     ego 모드의 동일 임계값(meta-docs.ts) 과 일치.
     */
    pills?: ('hot')[];
  };
  _hydrated: true;
}

/** 응답 엣지. `kind` 는 시각 어휘 (06 §3.5 — 두꺼운 실선 vs 점선). */
export interface SequentialEdge {
  id: string;
  source: string;
  target: string;
  /** CALL = 인과 호출 (두꺼운 실선), AFTER = 시간 흐름만 (점선). */
  type: 'CALL' | 'AFTER';
  data?: { via_tool_use_id?: string };
}

export interface SequentialFlowParams {
  centerKind: MetaDocKind;
  centerName: string;
  /** 가변 깊이 상한 (1~7). 기본 3. */
  depth?: number;
  /** 프로젝트 필터 — Spyglass 의 session.project_name 기준. */
  project?: string | null;
  /** unix ms — seed ToolCall 의 started_at 필터. */
  fromTs?: number;
  toTs?: number;
  /** seed (center 가 호출된 시점) 최대 개수. 기본 32. */
  maxSeeds?: number;
}

export interface SequentialFlowResult {
  nodes: SequentialNode[];
  edges: SequentialEdge[];
  /** layers[i] = 같은 시간 layer 의 node id 배열. UI 가 y = i 매핑. */
  layers: string[][];
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

const DEFAULT_DEPTH = 3;
const MAX_DEPTH = 7;
const DEFAULT_MAX_SEEDS = 32;
const TURN_AFTER_LIMIT = 16;

// =============================================================================
// 메인 진입점 — 4단계 알고리즘
// =============================================================================

/**
 * Sequential Flowchart 데이터 생성.
 *
 * 단계 (06 §3.3):
 *   1) fetchCenterSeeds        — center 메타 문서 호출 시드 ToolCall 집합
 *   2) fetchChainTraversal     — seed → PARENT_OF*1..depth → 자손 메타 문서
 *   3) fetchTurnAfter          — 같은 turn 안 center 이후 메타 문서 (시간 흐름)
 *   4) topologicalLayers       — Kahn DAG layer 분리 + started_at ASC 정렬
 */
export async function getSequentialFlow(
  client: LadybugClient,
  params: SequentialFlowParams,
): Promise<SequentialFlowResult> {
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

  // ── 2) 가변 깊이 자손 chain ─────────────────────────────────────────────
  const chainRows = await fetchChainTraversal(client, {
    seedIds: seeds.map((s) => s.tool_use_id),
    depth,
    centerKind: params.centerKind,
    centerName: params.centerName,
  });

  // ── 3) Turn-after (같은 turn 의 center 이후 호출) ────────────────────────
  const turnAfterRows = await fetchTurnAfter(client, {
    centerKind: params.centerKind,
    centerName: params.centerName,
    seedIds: seeds.map((s) => s.tool_use_id),
  });

  // ── 4) Kahn 위상 정렬 (started_at ASC priority) ──────────────────────────
  // 노드/엣지 dedup 후 정렬 입력 구성. center 는 합성 노드 'center' 로 추가.
  const sortInput = buildSortInput(seeds, chainRows, turnAfterRows);
  const layered = topologicalLayers(sortInput);

  // ── 응답 조립 ────────────────────────────────────────────────────────────
  return assembleResult({
    params,
    depth,
    seeds,
    chainRows,
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
 * 06 §3.3 Step 1 — center 메타 문서를 호출한 ToolCall 들 (시드).
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
  // 동적 WHERE 조립 — Cypher param 으로 풀 수 없는 IS NULL/AND 분기.
  const conds: string[] = [];
  if (p.fromTs !== null) conds.push('seed.started_at >= $fromTs');
  if (p.toTs !== null) conds.push('seed.started_at <= $toTs');
  if (p.project !== null) conds.push('seed.session_id IN $projectSessionIds');
  const whereClause = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';

  // project 필터는 sessions JOIN 이 필요한 영역 — 단순화를 위해 별도 쿼리로 분기.
  // 본 PR 범위에서는 project 가 null 일 때만 정상 동작 (향후 확장).
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
    projectSessionIds: [], // 본 PR 에선 미사용 — project 분기는 향후 PR.
  });

  return result.rows.map((r) => ({
    tool_use_id: String(r.tool_use_id),
    started_at: Number(r.started_at),
    turn_id: r.turn_id === null || r.turn_id === undefined ? null : String(r.turn_id),
    session_id: String(r.session_id),
  }));
}

// =============================================================================
// Cypher 2 — fetchChainTraversal
// =============================================================================

interface ChainRow {
  tool_use_id: string;
  kind: MetaDocKind;
  name: string;
  started_at: number;
  depth: number;
  /** root seed → 자기 자신 의 tool_use_id 경로. */
  chain: string[];
  /** 부모 ToolCall 의 tool_use_id. layer Kahn 정렬 시 엣지로 사용. */
  parent_tool_use_id: string;
}

interface FetchChainTraversalParams {
  seedIds: string[];
  depth: number;
  centerKind: MetaDocKind;
  centerName: string;
}

/**
 * 06 §3.3 Step 2 — 가변 깊이 PARENT_OF traversal.
 *
 * Cypher 패턴:
 *   MATCH path = (seed:ToolCall)
 *         -[:PARENT_OF*1..$depth]->(child:ToolCall)
 *         -[:USES]->(metadoc:MetaDocument)
 *   WHERE seed.tool_use_id IN $seedIds
 *     AND NOT (metadoc.kind = $centerKind AND metadoc.name = $centerName)  // self 격하
 *   RETURN metadoc.kind, metadoc.name, child.tool_use_id, child.started_at,
 *          length(path) AS depth, [n IN nodes(path) | n.tool_use_id] AS chain
 *   ORDER BY child.started_at ASC, depth ASC
 */
async function fetchChainTraversal(
  client: LadybugClient,
  p: FetchChainTraversalParams,
): Promise<ChainRow[]> {
  // walk semantic: upper bound 필수 — $depth 가 1..MAX_DEPTH 로 클램프되어 들어옴.
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
    `       [n IN nodes(path) | n.tool_use_id] AS chain ` +
    `ORDER BY child.started_at ASC, depth ASC`;

  const result = await client.query(cypher, {
    seedIds: p.seedIds,
    centerKind: p.centerKind,
    centerName: p.centerName,
  });

  return result.rows
    .map((r) => {
      const chain = Array.isArray(r.chain) ? (r.chain as unknown[]).map(String) : [];
      const parent_tool_use_id = chain.length >= 2 ? chain[chain.length - 2] : '';
      return {
        tool_use_id: String(r.tool_use_id),
        kind: normalizeKind(r.kind),
        name: String(r.name),
        started_at: Number(r.started_at),
        depth: Number(r.depth),
        chain,
        parent_tool_use_id,
      };
    })
    .filter((r) => r.parent_tool_use_id.length > 0);
}

// =============================================================================
// Cypher 3 — fetchTurnAfter
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

/**
 * 06 §3.3 Step 3 — 같은 turn 안에서 center 호출 이후 시점의 메타 문서.
 *
 * Cypher 패턴:
 *   center 의 seed.started_at 을 기준으로, 같은 Turn 의 다른 ToolCall 중
 *   later.started_at > center_at 인 것들을 시간순.
 */
async function fetchTurnAfter(
  client: LadybugClient,
  p: FetchTurnAfterParams,
): Promise<TurnAfterRow[]> {
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
// 응답 조립 — Cypher 결과 → SequentialFlowResult
// =============================================================================

/** Kahn 입력 빌드. center 합성 노드 + seeds + chain 자손 + turn-after 자손 모두 포함. */
function buildSortInput(
  seeds: SeedRow[],
  chainRows: ChainRow[],
  turnAfterRows: TurnAfterRow[],
): { nodes: SortableNode[]; edges: SortableEdge[] } {
  const nodeMap = new Map<string, SortableNode>();
  const edges: SortableEdge[] = [];

  // 'center' 합성 노드 — layer 0 보장. started_at 은 가장 이른 seed 시각.
  const centerStartedAt = seeds.length > 0 ? Math.min(...seeds.map((s) => s.started_at)) : 0;
  nodeMap.set('center', { id: 'center', started_at: centerStartedAt });

  // seeds — center 가 호출한 ToolCall (layer 1 후보). center → seed 엣지.
  for (const s of seeds) {
    if (!nodeMap.has(s.tool_use_id)) {
      nodeMap.set(s.tool_use_id, { id: s.tool_use_id, started_at: s.started_at });
    }
    edges.push({ from: 'center', to: s.tool_use_id });
  }

  // chainRows — 부모 → 자식 엣지로 변환. 노드 dedup (한 tool_use_id 는 한 번만).
  for (const row of chainRows) {
    if (!nodeMap.has(row.tool_use_id)) {
      nodeMap.set(row.tool_use_id, { id: row.tool_use_id, started_at: row.started_at });
    }
    if (row.parent_tool_use_id && nodeMap.has(row.parent_tool_use_id)) {
      edges.push({ from: row.parent_tool_use_id, to: row.tool_use_id });
    }
  }

  // turnAfterRows — center 와 직접 엣지 (AFTER 의미). layer 분리는 시간 기반.
  for (const row of turnAfterRows) {
    if (!nodeMap.has(row.tool_use_id)) {
      nodeMap.set(row.tool_use_id, { id: row.tool_use_id, started_at: row.started_at });
    }
    edges.push({ from: 'center', to: row.tool_use_id });
  }

  return { nodes: [...nodeMap.values()], edges };
}

/** 최종 응답 셰이프 빌드 — nodes/edges/layers/meta. */
function assembleResult(args: {
  params: SequentialFlowParams;
  depth: number;
  seeds: SeedRow[];
  chainRows: ChainRow[];
  turnAfterRows: TurnAfterRow[];
  layered: TopologicalResult;
  durationMs: number;
}): SequentialFlowResult {
  // node id → layer index 매핑 (UI 가 y 좌표 부여).
  const layerOf = new Map<string, number>();
  args.layered.layers.forEach((ids, i) => ids.forEach((id) => layerOf.set(id, i)));

  // node id → SequentialNode 매핑.
  const nodes: SequentialNode[] = [];

  // center 합성 노드.
  nodes.push({
    id: 'center',
    type: 'center',
    data: {
      kind: args.params.centerKind,
      name: args.params.centerName,
      started_at: args.seeds.length > 0 ? Math.min(...args.seeds.map((s) => s.started_at)) : 0,
      depth: 0,
      layer: layerOf.get('center') ?? 0,
    },
    _hydrated: true,
  });

  // seeds — center 가 직접 호출한 ToolCall (메타 문서로 분류된 행 한정).
  for (const s of args.seeds) {
    nodes.push({
      id: s.tool_use_id,
      type: args.params.centerKind, // seed 자체는 center 의 호출 단위 — kind 위임.
      data: {
        kind: args.params.centerKind,
        name: args.params.centerName,
        tool_use_id: s.tool_use_id,
        started_at: s.started_at,
        depth: 0,
        layer: layerOf.get(s.tool_use_id) ?? 0,
      },
      _hydrated: true,
    });
  }

  // chain 자손.
  for (const row of args.chainRows) {
    nodes.push({
      id: row.tool_use_id,
      type: row.kind,
      data: {
        kind: row.kind,
        name: row.name,
        tool_use_id: row.tool_use_id,
        started_at: row.started_at,
        depth: row.depth,
        layer: layerOf.get(row.tool_use_id) ?? row.depth,
        chain: row.chain,
      },
      _hydrated: true,
    });
  }

  // turn-after 자손.
  for (const row of args.turnAfterRows) {
    nodes.push({
      id: row.tool_use_id,
      type: row.kind,
      data: {
        kind: row.kind,
        name: row.name,
        tool_use_id: row.tool_use_id,
        started_at: row.started_at,
        depth: -1, // -1 = turn-after (인과 약함, 시간 흐름만)
        layer: layerOf.get(row.tool_use_id) ?? 0,
      },
      _hydrated: true,
    });
  }

  // 동일 id 의 노드 중복 제거 — chainRows 와 turnAfterRows 가 같은 ToolCall 을 가리키는
  // 드문 케이스 방어.
  const dedupNodes = dedupById(nodes);

  // edges — CALL (chain) / AFTER (turn-after).
  const edges: SequentialEdge[] = [];
  for (const s of args.seeds) {
    edges.push({
      id: `center->${s.tool_use_id}`,
      source: 'center',
      target: s.tool_use_id,
      type: 'CALL',
    });
  }
  for (const row of args.chainRows) {
    if (row.parent_tool_use_id) {
      edges.push({
        id: `${row.parent_tool_use_id}->${row.tool_use_id}`,
        source: row.parent_tool_use_id,
        target: row.tool_use_id,
        type: 'CALL',
        data: { via_tool_use_id: row.tool_use_id },
      });
    }
  }
  for (const row of args.turnAfterRows) {
    edges.push({
      id: `center~${row.tool_use_id}`,
      source: 'center',
      target: row.tool_use_id,
      type: 'AFTER',
    });
  }
  const dedupEdges = dedupById(edges);

  return {
    nodes: dedupNodes,
    edges: dedupEdges,
    layers: args.layered.layers,
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
// 유틸 — clamp/empty/dedup/normalize
// =============================================================================

function clampDepth(d: number): number {
  if (!Number.isFinite(d) || d < 1) return DEFAULT_DEPTH;
  if (d > MAX_DEPTH) return MAX_DEPTH;
  return Math.floor(d);
}

function emptyResult(
  params: SequentialFlowParams,
  depth: number,
  startedAt: number,
): SequentialFlowResult {
  return {
    nodes: [],
    edges: [],
    layers: [],
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

/** Cypher 결과에서 받은 kind 문자열을 도메인 enum 으로 정규화. */
function normalizeKind(v: unknown): MetaDocKind {
  const s = String(v ?? '').toLowerCase();
  if (s === 'command' || s === 'skill' || s === 'agent' || s === 'mcp' || s === 'tool') return s;
  return 'tool'; // 미분류는 tool 로 폴백 — UI 에서 무채색.
}
