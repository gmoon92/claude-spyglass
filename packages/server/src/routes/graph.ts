/**
 * routes/graph.ts — Graph projection API 라우터
 *
 * 책임:
 *   `/api/graph/*` 엔드포인트의 단일 진입점. 모든 응답을 `{nodes, edges}` 형태로
 *   표준화하여 향후 백엔드 swap(SQLite ↔ Ladybug ↔ DuckPGQ) 시 프론트엔드 변경이
 *   0 이 되도록 한다.
 *
 * 의존성:
 *   - @spyglass/storage-graph (LadybugClient, bfsTurnsNear, mode/circuit)
 *   - routes/_shared (jsonResponse, RouteHandler 타입)
 *
 * 호출 흐름 (요청 1건):
 *   apiRouter
 *     → graphRouter(req, db, url, path, method)
 *     → path 매칭 (4종)
 *     → mode 분기:
 *         - 'off'      → SQLite path (fallback adapter)
 *         - 'shadow'   → SQLite 응답 + 백그라운드 비교 로그 (응답에는 영향 없음)
 *         - 'primary'  → Ladybug path, 실패 시 자동 SQLite fallback
 *     → jsonResponse({nodes, edges})
 *
 * 엔드포인트:
 *   GET  /api/graph/sessions/:id/initial     — 초기 hydrate (최근 N turn)
 *   GET  /api/graph/turns/:id/neighbors      — center turn ±depth hop BFS
 *   GET  /api/graph/turns/:id/path           — 두 turn 사이 최단 경로 (placeholder)
 *   GET  /api/graph/status                   — 운영 상태 (mode, circuit, sync cursor)
 *   (SSE /api/graph/stream — 별도 PR 로 분리, 본 라우터에서는 미구현)
 *
 * 디자인 결정:
 *   - 본 라우터는 async — graph 쿼리가 async 이므로 metricsRouter 패턴(api.ts) 따름.
 *   - SQLite fallback 어댑터는 본 파일에 우선 placeholder 로 두고, 실제 SQL 매핑은
 *     이번 PR 범위 밖 (별도 transformRowsToGraph 어댑터 PR). off 모드에서는
 *     `{nodes:[], edges:[]}` 빈 응답 + warning 헤더 — UI 는 SQLite 라우트(`/api/sessions/*`,
 *     `/api/meta-docs/*`)를 그대로 사용.
 *   - 본 라우터 자체가 실패해도 main loop 영향 없도록 모든 핸들러에 try/catch.
 */

import type { Database } from 'bun:sqlite';
import { jsonResponse } from './_shared';
import {
  getMetaFlowEgo,
  type MetaFlowEgoCenterType,
  type MetaFlowEgoNode,
} from '@spyglass/storage';
import {
  getGraphMode,
  getCircuitBreaker,
  getSyncWorkerStatus,
  getLadybugClient,
  bfsTurnsNear,
  getSequentialFlow,
  LadybugUnavailableError,
} from '@spyglass/storage-graph';
import type {
  FlowBfsResult,
  SequentialFlowResult,
  MetaDocKind,
} from '@spyglass/storage-graph';
// MCP 그룹핑/이름파싱 SSoT — ego 모드(`meta-docs.ts`) 와 sequential 어댑터가 동일 정책 공유.
//   feedback_avoid_spaghetti: 동일 정책을 두 라우터에 흩뿌리지 않고 한 곳에서 재사용.
import { parseMcpToolName } from '../mcp-tool-name';
import { buildColumnEntities } from './meta-docs';

// =============================================================================
// 어댑터 enrich 상수 — 카드 표현 정책 (ego 모드와 동일)
// =============================================================================

/**
 * center 카드 HOT pill 임계값.
 *
 *   centerTurns / totalTurns ≥ 0.4 → 'hot' pill 부착.
 *   ego 모드(`meta-docs.ts`)의 동일 임계값과 일치해야 사용자 경험 일관성 유지.
 */
const HOT_PILL_THRESHOLD = 0.4;

// =============================================================================
// 라우터 본체 (async — apiRouter 의 비동기 chain 에 추가됨)
// =============================================================================

export async function graphRouter(
  req: Request,
  db: Database,
): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  if (!path.startsWith('/api/graph/')) return null;
  if (method !== 'GET') {
    return jsonResponse({ success: false, error: `Method ${method} not allowed on graph routes` }, 405);
  }

  // /api/graph/status — 진단/모니터링용. mode 와 무관하게 항상 응답.
  if (path === '/api/graph/status') {
    return handleStatus();
  }

  // /api/graph/sessions/:id/initial
  const initialMatch = path.match(/^\/api\/graph\/sessions\/([^/]+)\/initial$/);
  if (initialMatch) {
    const sessionId = decodeURIComponent(initialMatch[1]);
    const recentTurns = parseIntParam(url.searchParams.get('recentTurns'), 10);
    return await handleSessionInitial(sessionId, recentTurns, db);
  }

  // /api/graph/turns/:id/neighbors
  const neighborsMatch = path.match(/^\/api\/graph\/turns\/([^/]+)\/neighbors$/);
  if (neighborsMatch) {
    const turnId = decodeURIComponent(neighborsMatch[1]);
    const depth = parseIntParam(url.searchParams.get('depth'), 3);
    const dirRaw = url.searchParams.get('dir') ?? 'both';
    const dir: 'in' | 'out' | 'both' =
      dirRaw === 'in' || dirRaw === 'out' || dirRaw === 'both' ? dirRaw : 'both';
    return await handleTurnNeighbors(turnId, depth, dir, db);
  }

  // /api/graph/turns/:id/path?to=:targetTurnId — placeholder
  const pathMatch = path.match(/^\/api\/graph\/turns\/([^/]+)\/path$/);
  if (pathMatch) {
    const fromTurn = decodeURIComponent(pathMatch[1]);
    const toTurn = url.searchParams.get('to') ?? '';
    return await handleTurnPath(fromTurn, toTurn, db);
  }

  // /api/graph/sequential-flow?center_kind=&center_name=&depth=&fromTs=&toTs=
  //
  //   메타 문서 연관 순서도 (06 §3.3) 의 진입점. depth 7 까지 지원, 기본 3.
  //   기존 ego-graph (/api/meta-docs/flow) 와 직각 — 프론트 토글이 모드 분기.
  if (path === '/api/graph/sequential-flow') {
    return await handleSequentialFlow(url, db);
  }
  // 정적 매칭 안 됐지만 prefix /api/graph/ 라면 404.

  return jsonResponse({ success: false, error: `Unknown graph endpoint: ${path}` }, 404);
}

// =============================================================================
// 핸들러
// =============================================================================

/**
 * GET /api/graph/sessions/:id/initial — 세션 첫 hydrate.
 *
 * P1 범위: 단순히 최근 N turn 만 반환. 실제 ego-graph 구성(현재 active agent, tool
 * 등)은 별도 PR. 본 단계에서는 API 계약 형태와 fallback 동선만 정착시킨다.
 */
async function handleSessionInitial(
  sessionId: string,
  recentTurns: number,
  db: Database,
): Promise<Response> {
  const mode = getGraphMode();

  // off 모드: SQLite 폴백 — placeholder 빈 응답. UI 는 기존 `/api/sessions/:id/turns` 사용.
  if (mode === 'off') {
    return jsonResponse({
      success: true,
      data: emptyGraphResponse('mode=off — graph projection disabled'),
    });
  }

  // shadow / primary: 일단 동일하게 Ladybug 결과 시도. shadow 에선 비교 로그까지.
  const tryLadybug = async (): Promise<{ nodes: unknown[]; edges: unknown[] }> => {
    // 세션의 가장 최근 turn id 를 찾기 위해 SQLite 사용 — center 좌표는 SoT 에서.
    const stmt = db.prepare(
      `SELECT turn_id FROM requests
        WHERE session_id = ? AND type = 'prompt' AND turn_id IS NOT NULL
        ORDER BY id DESC LIMIT 1`,
    );
    const row = stmt.get(sessionId) as { turn_id: string } | undefined;
    if (!row?.turn_id) return { nodes: [], edges: [] };

    const client = await getLadybugClient();
    const result = await bfsTurnsNear(client, {
      centerTurnId: row.turn_id,
      depth: Math.min(Math.max(recentTurns - 1, 1), 5),
      direction: 'in',
    });
    return summarizeBfs(result);
  };

  return await runWithFallback(mode, tryLadybug, () => emptyGraphResponse('SQLite fallback'));
}

/**
 * GET /api/graph/turns/:id/neighbors?depth=&dir= — 인접 turn BFS.
 * 본 엔드포인트가 본 PR 의 핵심 hook — bfsTurnsNear 를 직접 호출.
 */
async function handleTurnNeighbors(
  turnId: string,
  depth: number,
  dir: 'in' | 'out' | 'both',
  _db: Database,
): Promise<Response> {
  const mode = getGraphMode();
  if (mode === 'off') {
    return jsonResponse({
      success: true,
      data: emptyGraphResponse('mode=off — graph projection disabled'),
    });
  }

  const tryLadybug = async (): Promise<{ nodes: unknown[]; edges: unknown[] }> => {
    const client = await getLadybugClient();
    const result = await bfsTurnsNear(client, {
      centerTurnId: turnId,
      depth,
      direction: dir,
    });
    return summarizeBfs(result);
  };

  return await runWithFallback(mode, tryLadybug, () => emptyGraphResponse('SQLite fallback'));
}

/**
 * GET /api/graph/turns/:id/path?to=:targetTurnId — 두 turn 사이 경로. P1 범위 밖,
 * placeholder 응답으로 API 계약만 노출.
 */
async function handleTurnPath(
  _fromTurn: string,
  _toTurn: string,
  _db: Database,
): Promise<Response> {
  return jsonResponse({
    success: true,
    data: emptyGraphResponse('endpoint planned — implementation in follow-up PR'),
  });
}

/**
 * GET /api/graph/sequential-flow — 메타 문서 연관 순서도.
 *
 * 입력 (query param):
 *   - center_kind: 'command' | 'skill' | 'agent' | 'mcp' (필수)
 *   - center_name: string (필수)
 *   - depth     : 1~7 (선택, 기본 3)
 *   - fromTs    : unix ms (선택)
 *   - toTs      : unix ms (선택)
 *
 * 응답:
 *   { success, data: { nodes, edges, layers, meta } }
 *   center 미지정 또는 mode=off 시 빈 그래프 + note.
 *
 * 흐름:
 *   1) flag.mode == 'off' → SQLite 폴백 (현 PR 범위에선 SQLite 매핑 미구현, 빈 응답).
 *   2) flag.mode == 'shadow' → SQLite 응답이 사용자에게, Ladybug 는 백그라운드 비교.
 *   3) flag.mode == 'primary' && 회로 closed → Ladybug 응답, 실패 시 SQLite 폴백.
 */
async function handleSequentialFlow(url: URL, db: Database): Promise<Response> {
  const centerKindRaw = url.searchParams.get('center_kind');
  const centerName = url.searchParams.get('center_name');
  const depthRaw = url.searchParams.get('depth');
  const fromTsRaw = url.searchParams.get('fromTs');
  const toTsRaw = url.searchParams.get('toTs');

  // 입력 검증 — 필수 파라미터 누락은 즉시 빈 응답 (프론트가 empty 안내).
  const validKinds: ReadonlyArray<MetaDocKind> = ['command', 'skill', 'agent', 'mcp', 'tool'];
  if (!centerKindRaw || !(validKinds as readonly string[]).includes(centerKindRaw) || !centerName) {
    return jsonResponse({
      success: true,
      data: {
        nodes: [],
        edges: [],
        layers: [],
        meta: { note: 'center_kind and center_name are required' },
      },
    });
  }
  const centerKind = centerKindRaw as MetaDocKind;
  const depth = depthRaw ? Math.max(1, Math.min(7, parseInt(depthRaw, 10) || 3)) : 3;
  const fromTs = parseTs(fromTsRaw);
  const toTs = parseTs(toTsRaw);

  const mode = getGraphMode();

  // SQLite fallback — 모든 mode 에서 사용자 응답으로 안전한 데이터 반환.
  //   mode=off: 즉시 SQLite 만으로 응답 (Ladybug 호출 0).
  //   mode=shadow: SQLite 응답을 보여주고 백그라운드에서 Ladybug 비교만.
  //   mode=primary + 회로 OPEN / Ladybug 실패: 자동 SQLite 폴백.
  //
  //   본 fallback 은 getMetaFlowEgo (기존 SQLite BFS) 를 그대로 사용해 ego-graph 데이터를
  //   sequential 형식(layers 배열)으로 *어댑터* 변환한다. 즉 *완전히 새 BFS 를 만들지 않고*
  //   검증된 기존 코드를 재사용 — 정확성 보장.
  const sqliteFallback = (): SequentialFlowResult => {
    return adaptEgoToSequential(db, centerKind, centerName, depth, fromTs, toTs);
  };

  if (mode === 'off') {
    const result = sqliteFallback();
    return jsonResponse({ success: true, data: result });
  }

  const tryLadybug = async (): Promise<SequentialFlowResult> => {
    const client = await getLadybugClient();
    return getSequentialFlow(client, { centerKind, centerName, depth, fromTs, toTs });
  };

  const breaker = getCircuitBreaker();
  if (mode === 'primary' && breaker.allowsTraffic()) {
    try {
      const result = await tryLadybug();
      breaker.recordSuccess();
      // graph DB 의 raw ToolCall 단위 결과에 ego 메타데이터(count/pct/subRows/pills) 매핑.
      //   raw 결과만으론 카드 표면이 비어 보이므로 후처리로 채운다. enrich 자체가 실패해도
      //   raw 결과는 그대로 반환 — 사용자 경험 회귀를 0 으로 유지.
      const enriched = enrichGraphDbResult(result, db, centerKind, centerName, fromTs, toTs);
      return jsonResponse({ success: true, data: enriched });
    } catch (err) {
      if (!(err instanceof LadybugUnavailableError)) breaker.recordFailure(err);
      console.warn(`[graph-route] sequential-flow primary failed, falling back to SQLite: ${err}`);
      return jsonResponse({ success: true, data: sqliteFallback() });
    }
  }

  if (mode === 'shadow') {
    // shadow 모드: 사용자 응답은 SQLite, 백그라운드에서 Ladybug 비교 로그.
    void (async () => {
      try {
        const r = await tryLadybug();
        breaker.recordSuccess();
        console.log(`[graph-shadow] sequential-flow nodes=${r.nodes.length} edges=${r.edges.length}`);
      } catch (err) {
        if (!(err instanceof LadybugUnavailableError)) breaker.recordFailure(err);
      }
    })();
    return jsonResponse({ success: true, data: sqliteFallback() });
  }

  // 회로 OPEN / 미지원 mode — SQLite 폴백.
  return jsonResponse({ success: true, data: sqliteFallback() });
}

/**
 * SQLite ego-graph 응답을 sequential 모드의 layer 기반 형식으로 변환.
 *
 * 매핑 규칙:
 *   - caller (depth -k..-1): 위쪽 layer 0..k-1 (가장 먼 -3 이 layer 0)
 *   - center: caller 수만큼의 layer 다음
 *   - callee (depth 1..k): center layer 다음 layer 1..k
 *
 * 노드 type 매핑:
 *   - ego 'center'         → sequential 'center'
 *   - ego 'skill'/'agent'/'mcp'/'command'  → 동일 유지
 *   - ego 'trigger'        → 'command' 로 정규화 (sequential UI 가 인식)
 *   - ego 'spoke'          → 노드 자체의 kind 가 카드에 따로 표시되므로 그대로 사용
 */
function adaptEgoToSequential(
  db: Database,
  centerKind: MetaDocKind,
  centerName: string,
  depth: number,
  fromTs: number | undefined,
  toTs: number | undefined,
): SequentialFlowResult {
  // ego API 는 'mcp'/'tool' center 미지원 — 그 경우 빈 응답.
  const allowedEgoTypes: readonly MetaDocKind[] = ['command', 'skill', 'agent'];
  if (!(allowedEgoTypes as readonly string[]).includes(centerKind)) {
    return {
      nodes: [],
      edges: [],
      layers: [],
      meta: {
        centerKind,
        centerName,
        depth,
        seedCount: 0,
        cycleDetected: false,
        durationMs: 0,
      },
    };
  }
  const egoType = centerKind as MetaFlowEgoCenterType;
  const started = Date.now();

  const ego = getMetaFlowEgo(db, {
    centerType: egoType,
    centerName,
    project: null,
    windowDays: 7,
    fromTs,
    toTs,
  });

  // 합성 ID 규칙 — MetaFlowEgoNode 에는 id 가 없으므로 (kind, name) 합성.
  const nodeId = (kind: string, name: string): string => `${kind}::${name}`;
  const CENTER_ID = 'center';

  // caller / center / callee 분리.
  const callNodes = ego.callTree.nodes;
  const callers = callNodes.filter((n) => n.depth < 0).sort((a, b) => a.depth - b.depth);
  const callees = callNodes.filter((n) => n.depth > 0).sort((a, b) => a.depth - b.depth);

  // ── layer 빌드 + MCP 그룹핑 ─────────────────────────────────────────────
  //
  //   각 layer 의 (kind,name) 노드 리스트를 buildColumnEntities 로 변환해
  //   같은 server 의 mcp 도구 2개+ 인 경우 group 노드 1개로 묶는다.
  //   - layer 배열에는 group id 가 들어간다 (멤버 id 는 layer 에 노출 안 됨).
  //   - 멤버 id → group id 매핑(`memberToGroup`)을 만들어 엣지 source/target 도 재라우팅.
  //   - group 노드는 subRows 에 멤버 정보를 보존 — UI 가 카드 안 리스트로 노출.
  //
  //   카드 표면 SSoT 는 ego 모드(`meta-docs.ts::emitSpokeEntity`) 와 동일.
  const layers: string[][] = [];
  const layerOf = new Map<string, number>();
  const memberToGroup = new Map<string, string>();
  /** group id → SequentialNode data (subRows 포함). 본문 nodes 빌드 시 사용. */
  const groupNodes = new Map<
    string,
    {
      kind: MetaDocKind;
      name: string;
      depth: number;
      count: number;
      pct: number;
      subRows: Array<{ fullName: string; toolName: string; count: number; pct: number }>;
    }
  >();

  const pushLayer = (egoNodes: MetaFlowEgoNode[], representativeDepth: number): void => {
    const entities = buildColumnEntities(egoNodes);
    const layerIds: string[] = [];
    for (const ent of entities) {
      if (ent.type === 'single') {
        const id = nodeId(ent.node.kind, ent.node.name);
        layerIds.push(id);
      } else {
        // group: mcp 서버 그룹 1개 → 합성 id 'mcp-group::<server>::L<depth>' (layer 별 unique 보장).
        const gid = `mcp-group::${ent.server}::L${representativeDepth}`;
        layerIds.push(gid);
        // 멤버 → group 매핑 + 멤버 노드는 layers/nodes 에 노출 안 됨.
        for (const m of ent.nodes) memberToGroup.set(nodeId(m.kind, m.name), gid);
        // group 노드의 카드 데이터.
        groupNodes.set(gid, {
          kind: 'mcp',
          name: ent.server,
          depth: representativeDepth,
          count: ent.totalCount,
          pct: ego.center.turns > 0 ? ent.totalCount / ego.center.turns : 0,
          subRows: ent.nodes.map((m) => {
            const parsed = parseMcpToolName(m.name);
            return {
              fullName: m.name,
              toolName: parsed?.tool ?? m.name,
              count: m.count,
              pct: Math.round((ego.center.turns > 0 ? m.count / ego.center.turns : 0) * 1000) / 10,
            };
          }),
        });
      }
    }
    layers.push(layerIds);
    for (const id of layerIds) layerOf.set(id, layers.length - 1);
  };

  const callerDepths = [...new Set(callers.map((c) => c.depth))].sort((a, b) => a - b);
  for (const d of callerDepths) pushLayer(callers.filter((c) => c.depth === d), d);

  // center 합성 노드 — callTree.nodes 에는 포함되지 않으므로 우리가 만든다.
  layers.push([CENTER_ID]);
  layerOf.set(CENTER_ID, layers.length - 1);

  const calleeDepths = [...new Set(callees.map((c) => c.depth))].sort((a, b) => a - b);
  for (const d of calleeDepths) pushLayer(callees.filter((c) => c.depth === d), d);

  // ── center pills (HOT) ──────────────────────────────────────────────────
  //   centerTurns / totalTurns ≥ 0.4 → center 카드 우상단 'HOT' 배지.
  //   ego 모드(`meta-docs.ts:651`) 와 동일 임계값.
  const centerPills: ('hot')[] | undefined =
    ego.totalTurns > 0 && ego.center.turns / ego.totalTurns >= HOT_PILL_THRESHOLD
      ? ['hot']
      : undefined;

  // ── 노드 변환 — center + 그룹 + (그룹이 아닌) single 노드들 ─────────────
  const nodes: SequentialFlowResult['nodes'] = [
    // center 합성 노드.
    {
      id: CENTER_ID,
      type: 'center',
      data: {
        kind: centerKind,
        name: centerName,
        started_at: 0,
        depth: 0,
        layer: layerOf.get(CENTER_ID) ?? 0,
        count: ego.center.turns,
        pct: 1,
        invocations: ego.center.invocations,
        pills: centerPills,
      },
      _hydrated: true as const,
    },
    // group 노드들 — subRows 포함.
    ...[...groupNodes.entries()].map(([gid, g]) => ({
      id: gid,
      type: 'mcp' as MetaDocKind,
      data: {
        kind: g.kind,
        name: g.name,
        started_at: 0,
        depth: g.depth,
        layer: layerOf.get(gid) ?? 0,
        count: g.count,
        pct: g.pct,
        subRows: g.subRows,
      },
      _hydrated: true as const,
    })),
    // single ego 노드들 — group 으로 흡수된 멤버는 제외.
    ...callNodes
      .filter((n) => !memberToGroup.has(nodeId(n.kind, n.name)))
      .map((n) => {
        const id = nodeId(n.kind, n.name);
        return {
          id,
          type: n.kind as MetaDocKind,
          data: {
            kind: n.kind as MetaDocKind,
            name: n.name,
            started_at: 0,
            depth: n.depth,
            layer: layerOf.get(id) ?? 0,
            count: n.count,
            pct: n.pct,
            timeline: n.timeline,
          },
          _hydrated: true as const,
        };
      }),
  ];

  // ── 엣지 변환 + 멤버→group 리매핑 + self-loop 제거 + dedup ─────────────
  const remap = (id: string): string => memberToGroup.get(id) ?? id;
  const rawEdges = ego.callTree.edges.map((e) => {
    const fromId = remap(nodeId(e.fromKind, e.fromName));
    const toId = remap(nodeId(e.toKind, e.toName));
    return {
      id: `${fromId}->${toId}`,
      source: fromId,
      target: toId,
      type: (e.relation === 'call' ? 'CALL' : 'AFTER') as 'CALL' | 'AFTER',
    };
  });
  const edges: SequentialFlowResult['edges'] = [];
  const hasEdge = new Set<string>();
  for (const e of rawEdges) {
    if (e.source === e.target) continue; // 같은 group 안 멤버끼리 엣지는 시각적 자기루프 — 제거.
    if (hasEdge.has(e.id)) continue;
    hasEdge.add(e.id);
    edges.push(e);
  }

  // ── center ↔ depth ±1 trunk 엣지 보강 (group/single 모두 적용) ─────────
  for (const c of callers.filter((n) => n.depth === -1)) {
    const id = remap(nodeId(c.kind, c.name));
    const eid = `${id}->${CENTER_ID}`;
    if (!hasEdge.has(eid)) {
      edges.push({ id: eid, source: id, target: CENTER_ID, type: 'CALL' });
      hasEdge.add(eid);
    }
  }
  for (const c of callees.filter((n) => n.depth === 1)) {
    const id = remap(nodeId(c.kind, c.name));
    const eid = `${CENTER_ID}->${id}`;
    if (!hasEdge.has(eid)) {
      edges.push({ id: eid, source: CENTER_ID, target: id, type: 'CALL' });
      hasEdge.add(eid);
    }
  }

  return {
    nodes,
    edges,
    layers,
    meta: {
      centerKind,
      centerName,
      depth,
      seedCount: ego.center.invocations,
      cycleDetected: false,
      durationMs: Date.now() - started,
    },
  };
}

// =============================================================================
// graph DB 결과 enrich — ToolCall 단위 → 카드 뷰용 (kind,name) 집계
// =============================================================================

/**
 * `getSequentialFlow` 의 raw 결과(ToolCall 단위 노드)에 카드 표현 메타데이터를 부착.
 *
 * 왜 필요한가:
 *   graph DB 쿼리는 ToolCall 1건 = 노드 1건 의미론으로 각 호출 인스턴스를 그대로 반환.
 *   카드 뷰는 `(kind, name)` 단위 dedup + distinct turn count + 백분율을 요구한다.
 *   두 의미론을 이어주는 어댑터 계층이 본 함수.
 *
 * 후처리 책임:
 *   1) `getMetaFlowEgo` 를 한 번 호출해 (kind,name) → {count, pct} 매핑을 얻는다.
 *      SoT 는 SQLite ego 쿼리 — sequential 어댑터와 동일 데이터.
 *   2) graph DB 노드의 (kind,name) 으로 ego 매핑을 조회해 `data.count/pct` 부착.
 *      매칭 실패는 무시(노드 그대로 유지) — graph DB 에만 있는 신선한 노드 방어.
 *   3) center 노드에 invocations + HOT pill 부착.
 *   4) MCP 그룹핑은 본 PR 에선 보류 — graph DB 의 ToolCall 단위와 (kind,name) 단위 그룹핑은
 *      semantic 차이가 커서 별도 PR 에서 처리. 현재 단계는 표면 호환성(필드 존재)만 보장.
 */
function enrichGraphDbResult(
  raw: SequentialFlowResult,
  db: Database,
  centerKind: MetaDocKind,
  centerName: string,
  fromTs: number | undefined,
  toTs: number | undefined,
): SequentialFlowResult {
  // ego 가 지원하지 않는 center kind 면 raw 그대로 (집계 불가).
  const allowedEgoTypes: readonly MetaDocKind[] = ['command', 'skill', 'agent'];
  if (!(allowedEgoTypes as readonly string[]).includes(centerKind)) {
    return raw;
  }

  let ego;
  try {
    ego = getMetaFlowEgo(db, {
      centerType: centerKind as MetaFlowEgoCenterType,
      centerName,
      project: null,
      windowDays: 7,
      fromTs,
      toTs,
    });
  } catch (err) {
    // ego 실패해도 graph DB raw 결과는 유효. 카드 sub 가 비어 보일 뿐 critical 회귀 아님.
    console.warn(`[graph-route] enrich: getMetaFlowEgo failed, returning raw result: ${err}`);
    return raw;
  }

  // (kind,name) → {count, pct} 매핑. center 자신은 별도 처리.
  const statsBy = new Map<string, { count: number; pct: number; timeline: 'after' | null }>();
  for (const n of ego.callTree.nodes) {
    statsBy.set(`${n.kind}::${n.name}`, { count: n.count, pct: n.pct, timeline: n.timeline });
  }

  // center 카드 HOT pill.
  const centerPills: ('hot')[] | undefined =
    ego.totalTurns > 0 && ego.center.turns / ego.totalTurns >= HOT_PILL_THRESHOLD
      ? ['hot']
      : undefined;

  // 노드별 enrich — 원본을 mutate 하지 않고 새 객체 반환.
  const nodes = raw.nodes.map((n) => {
    if (n.type === 'center') {
      return {
        ...n,
        data: {
          ...n.data,
          count: ego.center.turns,
          pct: 1,
          invocations: ego.center.invocations,
          pills: centerPills,
        },
      };
    }
    const key = `${n.data.kind}::${n.data.name}`;
    const stat = statsBy.get(key);
    if (!stat) return n;
    return {
      ...n,
      data: {
        ...n.data,
        count: stat.count,
        pct: stat.pct,
        timeline: stat.timeline,
      },
    };
  });

  return { ...raw, nodes };
}

/** ms 정수 파싱 — 비유효 입력은 undefined. */
function parseTs(v: string | null): number | undefined {
  if (v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * GET /api/graph/status — 운영 모드 + 회로 상태 + sync 진행 + bootstrap 여부.
 * 본 엔드포인트는 mode='off' 에서도 응답해야 한다 — 사용자가 운영 상태 확인할 권리.
 */
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
// 공용 — 모드 분기 + fallback
// =============================================================================

/**
 * mode 에 따라 Ladybug 시도 / SQLite 폴백 / shadow diff 로깅을 한 곳에 모은다 —
 * 각 핸들러가 try/catch 를 흩뿌리지 않도록 (메모리: feedback_avoid_spaghetti).
 */
async function runWithFallback(
  mode: ReturnType<typeof getGraphMode>,
  tryLadybug: () => Promise<{ nodes: unknown[]; edges: unknown[] }>,
  sqliteFallback: () => { nodes: unknown[]; edges: unknown[] },
): Promise<Response> {
  const breaker = getCircuitBreaker();

  // primary — Ladybug 가 주, 실패 시 SQLite fallback.
  if (mode === 'primary' && breaker.allowsTraffic()) {
    try {
      const result = await tryLadybug();
      breaker.recordSuccess();
      return jsonResponse({ success: true, data: result });
    } catch (err) {
      if (!(err instanceof LadybugUnavailableError)) {
        // LadybugUnavailableError 는 이미 회로 보고됨. 그 외만 보고.
        breaker.recordFailure(err);
      }
      console.warn(`[graph-route] primary path failed, falling back to SQLite: ${err}`);
      return jsonResponse({
        success: true,
        data: sqliteFallback(),
      });
    }
  }

  // shadow — SQLite 응답이 사용자에게, Ladybug 는 백그라운드 비교만.
  if (mode === 'shadow') {
    // fire-and-forget — 응답 latency 에 영향 없음.
    void runShadowCompare(tryLadybug);
    return jsonResponse({ success: true, data: sqliteFallback() });
  }

  // off / circuit open — SQLite only.
  return jsonResponse({ success: true, data: sqliteFallback() });
}

/**
 * shadow 모드 백그라운드 비교 — 응답에는 영향 0. 결과는 로그만.
 * 향후 텔레메트리에서 diff 통계를 집계할 때 본 함수가 출력 대상.
 */
async function runShadowCompare(
  tryLadybug: () => Promise<{ nodes: unknown[]; edges: unknown[] }>,
): Promise<void> {
  const breaker = getCircuitBreaker();
  if (!breaker.allowsTraffic()) return; // 회로 OPEN — 비교 자체 skip.
  try {
    const r = await tryLadybug();
    breaker.recordSuccess();
    console.log(`[graph-shadow] result nodes=${r.nodes.length} edges=${r.edges.length}`);
  } catch (err) {
    if (!(err instanceof LadybugUnavailableError)) breaker.recordFailure(err);
    console.warn(`[graph-shadow] comparison failed: ${err}`);
  }
}

// =============================================================================
// 유틸
// =============================================================================

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
