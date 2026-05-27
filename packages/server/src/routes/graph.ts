/**
 * routes/graph.ts — Graph projection API 라우터
 *
 * 책임:
 *   `/api/graph/*` 엔드포인트의 단일 진입점. 모든 응답을 `{nodes, edges, ...}` 형태로
 *   표준화해 프론트엔드가 백엔드 swap 에 영향받지 않게 한다.
 *
 *   본 라우터는 *그래프 DB(Ladybug) 단일 SoT* 정책 (migration-plan §B):
 *   ego 와 sequential 분리 모드는 폐기되고, `/api/graph/unified-flow` 가 두 정보를
 *   단일 응답으로 통합한다. SQLite ego 코드(`getMetaFlowEgo`/`buildEgoFlowGraph`/
 *   `adaptEgoToSequential`) 는 본 PR 에서 모두 제거됨 — graph DB 가 없으면 응답 없음.
 *
 * 의존성:
 *   - @spyglass/storage-graph (LadybugClient, mode/circuit, getUnifiedFlow)
 *   - routes/_shared (jsonResponse)
 *
 * 엔드포인트:
 *   GET /api/graph/sessions/:id/initial   — 초기 hydrate
 *   GET /api/graph/turns/:id/neighbors    — BFS depth hop
 *   GET /api/graph/turns/:id/path         — placeholder
 *   GET /api/graph/unified-flow           — 메타 문서 통합 flow (ancestor+center+descendant+after)
 *   GET /api/graph/status                 — 운영 상태
 *
 * 디자인 결정:
 *   - 모든 핸들러는 graph DB primary path. 회로 OPEN / Ladybug 미설치 시에는 빈 응답
 *     + LadybugUnavailableError 안내. SQLite fallback 0 (마이그레이션 완료 정책).
 *   - shadow 모드는 본 PR 이후 *사용처 없음* — 다음 cleanup PR 에서 mode 자체 단순화.
 *   - 본 파일 안에서만 카드 표현 정책(`enrichUnifiedFlow`) 을 적용 — storage-graph 의
 *     `unified-flow.ts` 는 raw ToolCall 단위 결과만 보장.
 */

import type { Database } from 'bun:sqlite';
import { jsonResponse } from './_shared';
import {
  getGraphMode,
  getCircuitBreaker,
  getSyncWorkerStatus,
  getLadybugClient,
  bfsTurnsNear,
  getUnifiedFlow,
  LadybugUnavailableError,
  type LadybugClient,
  type FlowBfsResult,
  type UnifiedFlowResult,
  type UnifiedFlowNode,
  type UnifiedFlowEdge,
  type UnifiedFlowColumn,
  type MetaDocKind,
} from '@spyglass/storage-graph';
import { parseMcpToolName } from '../mcp-tool-name';

// =============================================================================
// 카드 표현 정책 상수 (이전 ego 모드 SSoT 동일)
// =============================================================================

/** centerTurns / totalTurns ≥ 0.4 → 'hot' pill 부착. */
const HOT_PILL_THRESHOLD = 0.4;

// =============================================================================
// 라우터 본체
// =============================================================================

export async function graphRouter(req: Request, db: Database): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  if (!path.startsWith('/api/graph/')) return null;
  if (method !== 'GET') {
    return jsonResponse({ success: false, error: `Method ${method} not allowed on graph routes` }, 405);
  }

  if (path === '/api/graph/status') return handleStatus();

  const initialMatch = path.match(/^\/api\/graph\/sessions\/([^/]+)\/initial$/);
  if (initialMatch) {
    const sessionId = decodeURIComponent(initialMatch[1]);
    const recentTurns = parseIntParam(url.searchParams.get('recentTurns'), 10);
    return await handleSessionInitial(sessionId, recentTurns, db);
  }

  const neighborsMatch = path.match(/^\/api\/graph\/turns\/([^/]+)\/neighbors$/);
  if (neighborsMatch) {
    const turnId = decodeURIComponent(neighborsMatch[1]);
    const depth = parseIntParam(url.searchParams.get('depth'), 3);
    const dirRaw = url.searchParams.get('dir') ?? 'both';
    const dir: 'in' | 'out' | 'both' =
      dirRaw === 'in' || dirRaw === 'out' || dirRaw === 'both' ? dirRaw : 'both';
    return await handleTurnNeighbors(turnId, depth, dir, db);
  }

  const pathMatch = path.match(/^\/api\/graph\/turns\/([^/]+)\/path$/);
  if (pathMatch) {
    const fromTurn = decodeURIComponent(pathMatch[1]);
    const toTurn = url.searchParams.get('to') ?? '';
    return await handleTurnPath(fromTurn, toTurn, db);
  }

  // 통합 flow — ego(좌→우 의존성) + sequential(위→아래 인과) 단일 SoT.
  if (path === '/api/graph/unified-flow') {
    return await handleUnifiedFlow(url);
  }

  return null;
}

// =============================================================================
// 기존 핸들러 (변경 없음 — sequential-flow 시기와 동일)
// =============================================================================

async function handleSessionInitial(sessionId: string, _recentTurns: number, _db: Database): Promise<Response> {
  const mode = getGraphMode();
  if (mode === 'off' || !getCircuitBreaker().allowsTraffic()) {
    return jsonResponse({ success: true, data: emptyGraphResponse('graph mode disabled or circuit open') });
  }
  try {
    const client = await getLadybugClient();
    const result = await bfsTurnsNear(client, { centerTurnId: '__session__:' + sessionId, depth: 1, direction: 'both' });
    getCircuitBreaker().recordSuccess();
    return jsonResponse({ success: true, data: summarizeBfs(result) });
  } catch (err) {
    if (!(err instanceof LadybugUnavailableError)) getCircuitBreaker().recordFailure(err);
    return jsonResponse({ success: true, data: emptyGraphResponse(`primary failed: ${err}`) });
  }
}

async function handleTurnNeighbors(turnId: string, depth: number, dir: 'in' | 'out' | 'both', _db: Database): Promise<Response> {
  const mode = getGraphMode();
  if (mode === 'off' || !getCircuitBreaker().allowsTraffic()) {
    return jsonResponse({ success: true, data: emptyGraphResponse('graph mode disabled or circuit open') });
  }
  try {
    const client = await getLadybugClient();
    const result = await bfsTurnsNear(client, { centerTurnId: turnId, depth, direction: dir });
    getCircuitBreaker().recordSuccess();
    return jsonResponse({ success: true, data: summarizeBfs(result) });
  } catch (err) {
    if (!(err instanceof LadybugUnavailableError)) getCircuitBreaker().recordFailure(err);
    return jsonResponse({ success: true, data: emptyGraphResponse(`primary failed: ${err}`) });
  }
}

async function handleTurnPath(_fromTurn: string, _toTurn: string, _db: Database): Promise<Response> {
  return jsonResponse({
    success: true,
    data: emptyGraphResponse('endpoint planned — implementation in follow-up PR'),
  });
}

// =============================================================================
// /api/graph/unified-flow — 통합 메타 문서 흐름
// =============================================================================

const ALLOWED_KINDS: ReadonlyArray<MetaDocKind> = ['command', 'skill', 'agent', 'mcp', 'tool'];

/**
 * GET /api/graph/unified-flow — ego + sequential 통합 응답.
 *
 * 입력 (query param):
 *   center_kind, center_name (필수)
 *   depth     : 1~30 (선택, 기본 30) — Ladybug 가변 path 상한 30 과 동일.
 *               (과거 1~7 제한은 SQLite ego BFS 잔재. 그래프 DB 이관 후 무제한 정책.)
 *   fromTs, toTs : unix ms (선택)
 *   project   : 선택 (현재 미사용 — graph DB 의 project filter PR 후)
 *
 * 응답:
 *   { success: true, data: { nodes, edges, columns, meta } }
 *   center 미지정 / kind 미지원 / graph DB 미가용 시 빈 응답 + note.
 */
async function handleUnifiedFlow(url: URL): Promise<Response> {
  const centerKindRaw = url.searchParams.get('center_kind');
  const centerName = url.searchParams.get('center_name');
  const depthRaw = url.searchParams.get('depth');
  const fromTs = parseTs(url.searchParams.get('fromTs'));
  const toTs = parseTs(url.searchParams.get('toTs'));

  if (!centerKindRaw || !(ALLOWED_KINDS as readonly string[]).includes(centerKindRaw) || !centerName) {
    return jsonResponse({
      success: true,
      data: emptyUnifiedFlow(centerKindRaw as MetaDocKind | null, centerName, 'center_kind/name required'),
    });
  }
  const centerKind = centerKindRaw as MetaDocKind;
  // depth 정책: unified-flow.ts 의 DEFAULT_DEPTH=MAX_DEPTH=30 과 일치시킨다.
  //   - depthRaw 누락 → 30 (사실상 무제한, Ladybug 가변 path 상한)
  //   - depthRaw 존재 → [1, 30] clamp.
  const depth = depthRaw ? Math.max(1, Math.min(30, parseInt(depthRaw, 10) || 30)) : 30;

  const mode = getGraphMode();
  if (mode === 'off') {
    return jsonResponse({
      success: true,
      data: emptyUnifiedFlow(centerKind, centerName, 'graph mode is off'),
    });
  }

  const breaker = getCircuitBreaker();
  if (!breaker.allowsTraffic()) {
    return jsonResponse({
      success: true,
      data: emptyUnifiedFlow(centerKind, centerName, 'circuit open'),
    });
  }

  try {
    const client = await getLadybugClient();
    const raw = await getUnifiedFlow(client, { centerKind, centerName, depth, fromTs, toTs });
    const enriched = await enrichUnifiedFlow(raw, client, centerKind, centerName, fromTs, toTs);
    breaker.recordSuccess();
    return jsonResponse({ success: true, data: enriched });
  } catch (err) {
    if (!(err instanceof LadybugUnavailableError)) breaker.recordFailure(err);
    console.warn(`[graph-route] unified-flow failed: ${err}`);
    return jsonResponse({
      success: true,
      data: emptyUnifiedFlow(centerKind, centerName, `graph DB unavailable: ${err instanceof Error ? err.message : String(err)}`),
    });
  }
}

function emptyUnifiedFlow(
  centerKind: MetaDocKind | null,
  centerName: string | null,
  note: string,
): UnifiedFlowResult & { note: string } {
  return {
    nodes: [],
    edges: [],
    columns: [],
    meta: {
      centerKind: centerKind ?? 'tool',
      centerName: centerName ?? '',
      depth: 30,
      seedCount: 0,
      cycleDetected: false,
      durationMs: 0,
    },
    note,
  };
}

// =============================================================================
// enrichUnifiedFlow — raw ToolCall 단위 → (kind, name) 카드 단위 응답
// =============================================================================

/**
 * UnifiedFlowResult 의 raw ToolCall 단위 노드를 (kind, name) 단위 카드로 합성.
 *
 * 처리 단계:
 *   1) cohort 의 (kind, name) 단위 distinct turn count 집계 (Cypher 1회)
 *   2) centerTurns / centerInvocations / totalTurns 집계 (Cypher 1회)
 *   3) 같은 (kind, name) 의 raw 노드들을 합성 id `${kind}::${name}` 로 dedup
 *   4) 컬럼별 MCP 그룹핑 (같은 server 의 mcp 도구 2+ → group 카드 1개 + subRows)
 *   5) center 카드 HOT pill (centerTurns/totalTurns ≥ 0.4)
 *   6) 엣지 (멤버 → group) 재라우팅 + dedup + strength 결정 (pct 기반)
 *
 * 카드 표면 SSoT (이전 ego/sequential 양쪽과 동일):
 *   - count : distinct turn count
 *   - pct   : count / centerTurns (0~1)
 *   - invocations : center 만, COUNT(*)
 *   - subRows : MCP 그룹 카드의 도구 리스트
 *   - pills : ['hot'] (center 한정)
 */
async function enrichUnifiedFlow(
  raw: UnifiedFlowResult,
  client: LadybugClient,
  centerKind: MetaDocKind,
  centerName: string,
  fromTs: number | undefined,
  toTs: number | undefined,
): Promise<UnifiedFlowResult> {
  if (raw.nodes.length === 0) return raw;

  // ── 1) cohort (kind, name) 단위 distinct turn count ──────────────────────
  const cohortPairs = collectCohortPairs(raw.nodes, centerKind, centerName);
  const statsByKey = await fetchCohortTurnCounts(client, cohortPairs, fromTs, toTs);

  // ── 2) centerTurns / centerInvocations / totalTurns ─────────────────────
  const { centerTurns, centerInvocations, totalTurns } = await fetchCenterMetrics(
    client,
    centerKind,
    centerName,
    fromTs,
    toTs,
  );

  // ── 3) (kind, name) 합성 — raw ToolCall 단위 → 카드 단위 ────────────────
  const synth = synthesizeByKindName(raw, centerKind, centerName, statsByKey, centerTurns, centerInvocations);

  // ── 4) MCP 그룹핑 — column 별 같은 server 2+ → group ────────────────────
  const grouped = applyMcpGrouping(synth.nodes, synth.columns, centerTurns);

  // ── 5) center HOT pill ───────────────────────────────────────────────────
  const centerPills: ('hot')[] | undefined =
    totalTurns > 0 && centerTurns / totalTurns >= HOT_PILL_THRESHOLD ? ['hot'] : undefined;
  const finalNodes = grouped.nodes.map((n) =>
    n.type === 'center'
      ? { ...n, data: { ...n.data, pills: centerPills } }
      : n,
  );

  // ── 6) 엣지 재라우팅 + dedup (strength 는 unified-flow 의 인접쌍 빈도 보존) ───
  const finalEdges = reroutedEdges(raw.edges, synth.memberToCardId, grouped.memberToGroupId);

  return {
    nodes: finalNodes,
    edges: finalEdges,
    columns: grouped.columns,
    meta: raw.meta,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// enrichUnifiedFlow 내부 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

interface KindNamePair {
  kind: MetaDocKind;
  name: string;
}

function collectCohortPairs(
  nodes: UnifiedFlowNode[],
  centerKind: MetaDocKind,
  centerName: string,
): KindNamePair[] {
  const seen = new Set<string>();
  const out: KindNamePair[] = [];
  for (const n of nodes) {
    if (n.type === 'center') continue;
    if (n.data.kind === centerKind && n.data.name === centerName) continue;
    const key = `${n.data.kind}::${n.data.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: n.data.kind, name: n.data.name });
  }
  return out;
}

interface CohortStat {
  count: number;
  pct: number;
}

/**
 * cohort 의 각 (kind, name) 가 등장한 distinct turn 수.
 *
 * Cypher 패턴 (Ladybug walk semantic — 가변 IN list):
 *   UNWIND $pairs AS p
 *   MATCH (md:MetaDocument {kind: p.kind, name: p.name}) <-[:USES]- (tc:ToolCall)
 *   WHERE [시간 필터]
 *   RETURN md.kind, md.name, count(DISTINCT tc.turn_id) AS turnCount
 *
 * Ladybug 가 UNWIND 를 미지원하는 경우, kind+name 별 OR 조건으로 풀어 1쿼리에 처리:
 *   WHERE (md.kind = $k0 AND md.name = $n0) OR (md.kind = $k1 AND md.name = $n1) ...
 */
async function fetchCohortTurnCounts(
  client: LadybugClient,
  pairs: KindNamePair[],
  fromTs: number | undefined,
  toTs: number | undefined,
): Promise<Map<string, CohortStat>> {
  const map = new Map<string, CohortStat>();
  if (pairs.length === 0) return map;

  // OR 분기로 풀어내기 — UNWIND 대신 안전한 표현.
  const conds: string[] = [];
  const params: Record<string, unknown> = {};
  pairs.forEach((p, i) => {
    conds.push(`(md.kind = $k${i} AND md.name = $n${i})`);
    params[`k${i}`] = p.kind;
    params[`n${i}`] = p.name;
  });

  const timeConds: string[] = [];
  if (fromTs !== undefined) { timeConds.push('tc.started_at >= $fromTs'); params.fromTs = fromTs; }
  if (toTs !== undefined) { timeConds.push('tc.started_at <= $toTs'); params.toTs = toTs; }
  const timeClause = timeConds.length > 0 ? ` AND ${timeConds.join(' AND ')}` : '';

  const cypher =
    `MATCH (md:MetaDocument) <-[:USES]- (tc:ToolCall) ` +
    `WHERE (${conds.join(' OR ')})${timeClause} ` +
    `RETURN md.kind AS kind, md.name AS name, count(DISTINCT tc.turn_id) AS turnCount`;

  try {
    const result = await client.query(cypher, params);
    // centerTurns 가 0 이면 pct 계산 불가 — 호출자가 0 처리.
    for (const r of result.rows) {
      const key = `${String(r.kind)}::${String(r.name)}`;
      const count = Number(r.turnCount) || 0;
      map.set(key, { count, pct: 0 }); // pct 는 centerTurns 알아낸 후 채움
    }
  } catch (err) {
    console.warn(`[graph-route] fetchCohortTurnCounts failed: ${err}`);
  }
  return map;
}

async function fetchCenterMetrics(
  client: LadybugClient,
  centerKind: MetaDocKind,
  centerName: string,
  fromTs: number | undefined,
  toTs: number | undefined,
): Promise<{ centerTurns: number; centerInvocations: number; totalTurns: number }> {
  const params: Record<string, unknown> = { centerKind, centerName };
  const timeConds: string[] = [];
  if (fromTs !== undefined) { timeConds.push('tc.started_at >= $fromTs'); params.fromTs = fromTs; }
  if (toTs !== undefined) { timeConds.push('tc.started_at <= $toTs'); params.toTs = toTs; }
  const timeClause = timeConds.length > 0 ? ` WHERE ${timeConds.join(' AND ')}` : '';

  let centerTurns = 0;
  let centerInvocations = 0;
  try {
    const r = await client.query(
      `MATCH (md:MetaDocument {kind: $centerKind, name: $centerName}) <-[:USES]- (tc:ToolCall)` +
        timeClause +
        ` RETURN count(DISTINCT tc.turn_id) AS centerTurns, count(tc) AS centerInvocations`,
      params,
    );
    if (r.rows.length > 0) {
      centerTurns = Number(r.rows[0].centerTurns) || 0;
      centerInvocations = Number(r.rows[0].centerInvocations) || 0;
    }
  } catch (err) {
    console.warn(`[graph-route] fetchCenterMetrics (center) failed: ${err}`);
  }

  // totalTurns — HOT pill 분모. 전체 Turn 수 (시간 필터 적용).
  let totalTurns = 0;
  try {
    const turnParams: Record<string, unknown> = {};
    const turnConds: string[] = [];
    if (fromTs !== undefined) { turnConds.push('t.started_at >= $fromTs'); turnParams.fromTs = fromTs; }
    if (toTs !== undefined) { turnConds.push('t.started_at <= $toTs'); turnParams.toTs = toTs; }
    const turnWhere = turnConds.length > 0 ? ` WHERE ${turnConds.join(' AND ')}` : '';
    const r2 = await client.query(`MATCH (t:Turn)${turnWhere} RETURN count(DISTINCT t.id) AS totalTurns`, turnParams);
    if (r2.rows.length > 0) totalTurns = Number(r2.rows[0].totalTurns) || 0;
  } catch (err) {
    console.warn(`[graph-route] fetchCenterMetrics (total) failed: ${err}`);
  }

  return { centerTurns, centerInvocations, totalTurns };
}

interface SynthResult {
  nodes: UnifiedFlowNode[];
  columns: UnifiedFlowColumn[];
  /** raw ToolCall id → 합성 카드 id 매핑 (엣지 재라우팅 용). */
  memberToCardId: Map<string, string>;
}

/**
 * raw ToolCall 단위 노드 → (kind, name) 단위 합성 카드.
 *   - 같은 (kind, name) 의 노드들 중 *가장 작은 column 인덱스* 의 노드를 대표로 채택
 *   - count/pct/invocations 는 statsByKey 에서 부착
 *   - column.nodeIds 도 합성 id 로 재구성 (dedup)
 */
function synthesizeByKindName(
  raw: UnifiedFlowResult,
  centerKind: MetaDocKind,
  centerName: string,
  statsByKey: Map<string, CohortStat>,
  centerTurns: number,
  centerInvocations: number,
): SynthResult {
  const cardIdFor = (kind: MetaDocKind, name: string): string => `${kind}::${name}`;
  const CENTER_ID = 'center';

  const memberToCardId = new Map<string, string>();
  const cardsByKey = new Map<string, UnifiedFlowNode>();

  for (const n of raw.nodes) {
    if (n.type === 'center') {
      cardsByKey.set(CENTER_ID, {
        ...n,
        id: CENTER_ID,
        data: {
          ...n.data,
          count: centerTurns,
          pct: 1,
          invocations: centerInvocations,
        },
      });
      memberToCardId.set(n.id, CENTER_ID);
      continue;
    }
    // seed (center kind == 자기 자신) → center 카드로 흡수.
    if (n.data.kind === centerKind && n.data.name === centerName) {
      memberToCardId.set(n.id, CENTER_ID);
      continue;
    }

    const cardId = cardIdFor(n.data.kind, n.data.name);
    memberToCardId.set(n.id, cardId);

    const stat = statsByKey.get(cardId);
    const count = stat?.count ?? 0;
    const pct = centerTurns > 0 ? count / centerTurns : 0;
    statsByKey.set(cardId, { count, pct }); // pct 채움 (다른 호출자도 참조 가능)

    const existing = cardsByKey.get(cardId);
    if (!existing) {
      cardsByKey.set(cardId, {
        ...n,
        id: cardId,
        data: {
          ...n.data,
          count,
          pct,
        },
      });
    } else {
      // 더 가까운 column (center 에 가까운 쪽) 우선 — 이미 정한 카드 위치를 유지.
      // started_at 은 가장 이른 값으로 갱신.
      if (n.data.started_at < existing.data.started_at) {
        existing.data.started_at = n.data.started_at;
      }
      if (Math.abs(n.data.depth) < Math.abs(existing.data.depth)) {
        existing.data.depth = n.data.depth;
        existing.data.column = n.data.column;
        existing.data.layerTone = n.data.layerTone;
        if (n.data.timeline !== undefined) existing.data.timeline = n.data.timeline;
      }
    }
  }

  // columns 재구성 — 멤버 id 들을 합성 카드 id 로 dedup.
  const columns: UnifiedFlowColumn[] = raw.columns.map((col) => {
    const seen = new Set<string>();
    const newIds: string[] = [];
    for (const memberId of col.nodeIds) {
      const cardId = memberToCardId.get(memberId);
      if (!cardId) continue;
      if (seen.has(cardId)) continue;
      seen.add(cardId);
      newIds.push(cardId);
    }
    return { ...col, nodeIds: newIds };
  });

  return {
    nodes: [...cardsByKey.values()],
    columns,
    memberToCardId,
  };
}

/**
 * 컬럼별 MCP 그룹핑 — 같은 server 의 mcp 도구가 2+ 인 경우 group 카드 1개로 합성.
 *   - server 단위 group id `mcp-group::<server>::col<column>` 부여
 *   - 멤버는 column.nodeIds 에서 제거, group 카드 1개로 대체
 *   - 단일 멤버 server 는 group 화 하지 않음
 */
function applyMcpGrouping(
  cards: UnifiedFlowNode[],
  columns: UnifiedFlowColumn[],
  centerTurns: number,
): {
  nodes: UnifiedFlowNode[];
  columns: UnifiedFlowColumn[];
  memberToGroupId: Map<string, string>;
} {
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const memberToGroupId = new Map<string, string>();
  const newCards: UnifiedFlowNode[] = [];

  const newColumns: UnifiedFlowColumn[] = columns.map((col) => {
    // 이 컬럼 안의 mcp 카드 → server 별 grouping.
    const serverGroups = new Map<string, UnifiedFlowNode[]>();
    const orderedIds: string[] = [];
    for (const id of col.nodeIds) {
      const card = cardById.get(id);
      if (!card) continue;
      if (card.data.kind !== 'mcp') {
        orderedIds.push(id);
        continue;
      }
      const parsed = parseMcpToolName(card.data.name);
      if (!parsed) {
        orderedIds.push(id);
        continue;
      }
      const acc = serverGroups.get(parsed.server);
      if (acc) {
        acc.push(card);
      } else {
        serverGroups.set(parsed.server, [card]);
        // 그룹 placeholder 위치 보존 — server 첫 등장 위치에 group id 또는 single id 가 들어감.
        orderedIds.push(`__mcp_placeholder__::${parsed.server}`);
      }
    }

    // server 별 single/group 결정.
    const placeholderToFinalId = new Map<string, string>();
    for (const [server, members] of serverGroups.entries()) {
      const placeholder = `__mcp_placeholder__::${server}`;
      if (members.length === 1) {
        placeholderToFinalId.set(placeholder, members[0].id);
      } else {
        const groupId = `mcp-group::${server}::col${col.depth}`;
        placeholderToFinalId.set(placeholder, groupId);
        for (const m of members) memberToGroupId.set(m.id, groupId);

        // group 카드 합성.
        const totalCount = members.reduce((s, m) => s + (m.data.count ?? 0), 0);
        const pct = centerTurns > 0 ? totalCount / centerTurns : 0;
        const earliest = members.reduce(
          (mn, m) => Math.min(mn, m.data.started_at),
          Number.POSITIVE_INFINITY,
        );
        const tone = members.reduce((mn, m) => Math.min(mn, m.data.layerTone), 4);
        newCards.push({
          id: groupId,
          type: 'mcp',
          data: {
            kind: 'mcp',
            name: server,
            started_at: Number.isFinite(earliest) ? earliest : 0,
            depth: members[0].data.depth,
            layer: members[0].data.layer,
            column: members[0].data.column,
            layerTone: tone,
            count: totalCount,
            pct,
            subRows: members.map((m) => {
              const parsed = parseMcpToolName(m.data.name);
              return {
                fullName: m.data.name,
                toolName: parsed?.tool ?? m.data.name,
                count: m.data.count ?? 0,
                pct: Math.round(((m.data.pct ?? 0) * 1000)) / 10, // 0~100 정수
              };
            }),
          },
          _hydrated: true,
        });
      }
    }

    // placeholder → 최종 id 치환.
    const finalIds = orderedIds.map((id) => placeholderToFinalId.get(id) ?? id);

    return { ...col, nodeIds: finalIds };
  });

  // 살아남은 멤버 카드들 (group 으로 흡수되지 않은). center 카드도 포함.
  for (const card of cards) {
    if (memberToGroupId.has(card.id)) continue;
    newCards.push(card);
  }

  return { nodes: newCards, columns: newColumns, memberToGroupId };
}

/**
 * 엣지 재라우팅 + dedup. strength 는 unified-flow 가 부여한 *인접쌍 빈도* 를 보존한다
 * ("X 다음 Y" 가 cohort turn 들에서 얼마나 자주 관찰됐는지). 노드 pct 로 재계산하지
 * 않는다 — 그래야 시퀀스 빈도 의미가 소거되지 않는다.
 *   - raw 엣지의 source/target ((kind,name) 카드 id) → (있다면) MCP group id 로 remap
 *   - source == target (self-loop) 제거
 *   - 동일 (source, target, type) 중복 시 *더 강한* strength 유지 (MCP 그룹핑 병합 대비)
 */
function reroutedEdges(
  rawEdges: UnifiedFlowEdge[],
  memberToCardId: Map<string, string>,
  memberToGroupId: Map<string, string>,
): UnifiedFlowEdge[] {
  const remap = (id: string): string => {
    const cardId = memberToCardId.get(id) ?? id;
    return memberToGroupId.get(cardId) ?? cardId;
  };
  const rank: Record<string, number> = { sparse: 0, weak: 1, medium: 2, strong: 3 };

  const seen = new Map<string, UnifiedFlowEdge>();
  for (const e of rawEdges) {
    const source = remap(e.source);
    const target = remap(e.target);
    if (source === target) continue;
    const key = `${source}->${target}::${e.type}`;
    const strength = e.type === 'AFTER' ? 'sparse' : (e.strength ?? 'sparse');
    const candidate: UnifiedFlowEdge = {
      id: `${source}->${target}`,
      source,
      target,
      type: e.type,
      strength,
      data: e.data,
    };
    const prev = seen.get(key);
    if (!prev || rank[strength] > rank[prev.strength ?? 'sparse']) {
      seen.set(key, candidate);
    }
  }
  return [...seen.values()];
}

// =============================================================================
// /api/graph/status — 운영 진단
// =============================================================================

function handleStatus(): Response {
  const mode = getGraphMode();
  const circuit = getCircuitBreaker();
  const worker = getSyncWorkerStatus();
  return jsonResponse({
    success: true,
    data: {
      mode,
      circuit: {
        state: circuit.getState(),
        consecutiveFailures: circuit.getConsecutiveFailures(),
        fallbackRate: Number(circuit.getFallbackRate().toFixed(3)),
      },
      sync: worker,
    },
  });
}

// =============================================================================
// 유틸
// =============================================================================

function parseTs(v: string | null): number | undefined {
  if (v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function summarizeBfs(result: FlowBfsResult): { nodes: unknown[]; edges: unknown[] } {
  return { nodes: result.nodes, edges: result.edges };
}

function emptyGraphResponse(reason: string): { nodes: unknown[]; edges: unknown[]; note: string } {
  return { nodes: [], edges: [], note: reason };
}

function parseIntParam(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}
