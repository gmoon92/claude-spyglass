/**
 * flow-bfs.ts — Flow BFS Cypher 쿼리 진입점 (Tier 2 P1 첫 hook)
 *
 * 책임:
 *   Spyglass 의 핵심 시각화 패턴인 "T19 → T18 → T17 인접 turn 탐색" 을 Ladybug
 *   Cypher 로 수행한다. 본 모듈은 *깊이 제한된 BFS 결과* 만 반환하고, SQLite path
 *   fallback 책임은 호출자(routes/graph.ts)에게 위임한다.
 *
 * 의존성:
 *   - client.ts (LadybugClient — 단일 query 진입점)
 *   - runtime/circuit-breaker (실패 보고)
 *
 * 호출 흐름:
 *   routes/graph.ts::initial 또는 neighbors 핸들러
 *     → (mode === 'shadow') 백그라운드 호출 또는
 *     → (mode === 'primary' && circuit closed) 주 경로 호출
 *     → bfsTurnsNear(client, {...}) → { nodes, edges }
 *
 * 디자인 결정:
 *   - 본 모듈은 *순수 read* — Ladybug 에 write 하지 않는다.
 *   - 응답은 `{ nodes: GraphNode[], edges: GraphEdge[] }` — 03 보고서가 권한 API 계약.
 *     이 계약은 향후 SQLite path 도 동일 형태로 normalize 되어야 프론트 zero-change.
 *   - depth 상한은 기본 3, 최대 5 — 그 이상은 Spyglass 도메인에서 의미가 적고
 *     Ladybug walk semantic 의 비용도 커진다.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/.tmp/plans/spyglass/graph-db-research/01-database-architecture.md
 *   §5.1 T19→T18→T17 Cypher 패턴.
 */

import type { LadybugClient } from '../client';

// =============================================================================
// 공용 응답 타입 — API 계약 (호출자 routes/graph.ts 가 동일 형태로 SQLite path 변환)
// =============================================================================

export interface GraphNode {
  id: string;
  type: 'session' | 'turn' | 'agent' | 'tool_call' | 'event' | 'badge' | 'meta_doc';
  data: Record<string, unknown>;
  _hydrated: true;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  data?: Record<string, unknown>;
}

export interface FlowBfsParams {
  centerTurnId: string;
  /** 양방향 BFS 최대 depth (1~5). 기본 3. */
  depth?: number;
  /** 'in' = 이전 turn 방향만, 'out' = 다음 turn 방향만, 'both' = 둘 다. 기본 'both'. */
  direction?: 'in' | 'out' | 'both';
}

export interface FlowBfsResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** 쿼리 소요 시간 (ms). shadow 모드의 lag 측정에 사용. */
  durationMs: number;
}

// =============================================================================
// 메인 — center turn 주변 N-hop BFS
// =============================================================================

const DEFAULT_DEPTH = 3;
const MAX_DEPTH = 5;

/**
 * center turn 에서 NEXT 체인 양방향으로 depth hop 까지 turn 들을 모은다.
 * Kuzu walk semantic 상 `*1..k` 는 upper bound 명시 필수.
 *
 * Cypher:
 *   - 양방향: `MATCH (center)-[:NEXT*1..k]-(other)` (방향 없는 매치)
 *   - 단방향(out): `MATCH (center)-[:NEXT*1..k]->(other)`
 *   - 단방향(in):  `MATCH (center)<-[:NEXT*1..k]-(other)`
 */
export async function bfsTurnsNear(
  client: LadybugClient,
  params: FlowBfsParams,
): Promise<FlowBfsResult> {
  const depth = clampDepth(params.depth ?? DEFAULT_DEPTH);
  const direction = params.direction ?? 'both';
  const started = Date.now();

  // center turn 노드 1개는 항상 응답에 포함 — depth 0 의미.
  const centerCypher = `MATCH (c:Turn {id: $centerId}) RETURN c.id AS id, c.session_id AS session_id, c.ordinal AS ordinal, c.started_at AS started_at`;
  const centerResult = await client.query(centerCypher, { centerId: params.centerTurnId });
  if (centerResult.rows.length === 0) {
    return { nodes: [], edges: [], durationMs: Date.now() - started };
  }

  // 인접 turn + 그 사이 NEXT 엣지를 한 번에 가져오기 위해 `WITH` + UNWIND 사용.
  // walk semantic — `*1..depth` upper bound 명시.
  const dirArrow = direction === 'out' ? '->' : direction === 'in' ? '<-' : '-';
  const dirPrefix = direction === 'in' ? '<-' : '-';
  const dirSuffix = direction === 'out' ? '->' : '-';
  const traversalCypher =
    `MATCH path = (center:Turn {id: $centerId})${dirPrefix}[:NEXT*1..${depth}]${dirSuffix}(other:Turn)
     WITH DISTINCT other
     RETURN other.id AS id, other.session_id AS session_id, other.ordinal AS ordinal, other.started_at AS started_at`;
  // dirArrow 변수는 placeholder — Cypher 가 위 dirPrefix/dirSuffix 조합으로 표현 가능.
  void dirArrow;

  const traversal = await client.query(traversalCypher, { centerId: params.centerTurnId });

  // NEXT 엣지 추출 — Spyglass UI 는 인접 노드 쌍을 알아야 카메라 이동 경로를 그릴 수 있다.
  const edgesCypher =
    `MATCH (a:Turn)-[r:NEXT]->(b:Turn)
     WHERE a.id IN $turnIds AND b.id IN $turnIds
     RETURN a.id AS source, b.id AS target, r.gap_ms AS gap_ms`;
  const allTurnIds: string[] = [
    String((centerResult.rows[0] as Record<string, unknown>).id),
    ...traversal.rows.map((r) => String((r as Record<string, unknown>).id)),
  ];
  const edgesResult = await client.query(edgesCypher, { turnIds: allTurnIds });

  // 응답 빌드 — 표준 GraphNode/Edge 형태.
  const nodes: GraphNode[] = [];
  for (const r of [...centerResult.rows, ...traversal.rows]) {
    const row = r as Record<string, unknown>;
    nodes.push({
      id: String(row.id),
      type: 'turn',
      data: {
        session_id: row.session_id,
        ordinal: row.ordinal,
        started_at: row.started_at,
      },
      _hydrated: true,
    });
  }
  const edges: GraphEdge[] = edgesResult.rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: `${row.source}->${row.target}`,
      source: String(row.source),
      target: String(row.target),
      type: 'NEXT',
      data: row.gap_ms !== null && row.gap_ms !== undefined ? { gap_ms: row.gap_ms } : undefined,
    };
  });

  return { nodes, edges, durationMs: Date.now() - started };
}

// =============================================================================
// 유틸
// =============================================================================

function clampDepth(d: number): number {
  if (!Number.isFinite(d) || d < 1) return DEFAULT_DEPTH;
  if (d > MAX_DEPTH) return MAX_DEPTH;
  return Math.floor(d);
}
