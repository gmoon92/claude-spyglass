/**
 * /api/meta-docs/* 라우트 — Behavior Definitions 카탈로그 + 히팅률 (v24)
 *
 * 책임:
 *  - 클라이언트(웹 UI)가 카탈로그+사용 집계를 한 표로 받아볼 수 있게 LEFT JOIN 결과를 노출.
 *  - 명시적 refresh 요청을 받아 동기화를 다시 돌릴 수 있는 백도어 제공.
 *
 * 라우트:
 *  - GET  /api/meta-docs                     — 카탈로그 + 사용 집계 목록
 *      ?type=agent|skill|command (선택)
 *      ?source_root=<absolute path|null>     ('null'이면 글로벌만)
 *      ?includeDeleted=1                     (기본 false)
 *      ?fromTs=<unixMs>                      (선택 — 사용 집계 시간 윈도우 시작)
 *      ?toTs=<unixMs>                        (선택 — 사용 집계 시간 윈도우 끝)
 *        ※ fromTs/toTs 중 하나라도 주어지면 invocations/last_used_at/total_tokens가
 *          해당 윈도우의 requests만 GROUP BY한 결과로 계산된다.
 *          미지정 시 v_meta_doc_usage VIEW(전체 기간) 사용.
 *  - POST /api/meta-docs/refresh             — 동기화 재실행
 *      body: {
 *        scope?: 'global'|'project'|'all',
 *        cwd?: string,                  // 단일 cwd (project 동기화)
 *        includeKnownCwds?: boolean,    // 알려진 모든 cwd 일괄 동기화 (모집단 확장)
 *        force?: boolean,               // throttle 우회
 *      }
 *      응답:
 *        { success: true, data: {
 *            global?:  SyncResult,
 *            project?: SyncResult,                     // body.cwd가 주어졌을 때만
 *            cwds?:    Array<{cwd, result?, error?}>,  // includeKnownCwds=true일 때만
 *        } }
 *
 * 호출자: api.ts → SYNC_ROUTERS
 *
 * 의존성: storage 카탈로그 함수, meta-docs/synchronizer.
 */

import type { Database } from 'bun:sqlite';
import {
  listMetaDocsWithUsage,
  getMetaFlowEgo,
  type MetaDocType,
  type MetaFlowEgo,
  type MetaFlowEgoCenterType,
  type MetaFlowEgoNode,
  type MetaFlowEgoNodeKind,
} from '@spyglass/storage';
import { jsonResponse } from './_shared';
import { syncCwd, syncGlobalOnce, syncAllKnownCwds } from '../meta-docs';
import { parseMcpToolName } from '../mcp-tool-name';

const ALLOWED_TYPES: MetaDocType[] = ['agent', 'skill', 'command'];
const ALLOWED_CENTER_TYPES: MetaFlowEgoCenterType[] = ['command', 'skill', 'agent'];

// ── Ego-Flow 레이아웃 상수 ──────────────────────────────────────────────────
// 메타 문서 탭 상단 영역에 들어가는 컴팩트한 ego-graph용 시드 viewBox.
// 컬럼 배치는 등장한 depth 집합으로부터 동적으로 계산한다(meta-docs-flow-dynamic-columns).
// 클라이언트의 computeRelaxedLayout(meta-docs-flow-view.js)이 최종 x 좌표·viewW를 갱신하므로
// 여기서는 "시드" 값만 발행한다(클라이언트 렌더 전 fallback 용도).
//
// meta-docs-flow-bidir (2026-05-21):
//   - 좌측 triggers 컬럼을 폐기. 슬래시 커맨드는 부모 BFS 가상 노드로 흡수.
//   - 부모 BFS 컬럼(depth<0) — "이 메타 문서를 누가 호출했나" 시각화.
//   - turn-after 컬럼 — 같은 turn 의 center 이후 시점 메타 문서(시간 흐름).
//
// meta-docs-flow-dynamic-columns (2026-05-21):
//   - 컬럼 수는 BFS가 발견한 depth 집합에 따라 가변(이전: 좌3+우3 고정).
//   - 컬럼당 카드 상한은 TOP_N(64). storage BFS 안전 상한(32)과 정합.
const EGO_LAYOUT = {
  viewH: 360,
  /** 컬럼 가로 폭(픽셀). */
  colW: 180,
  /** 컬럼 간격(픽셀). */
  colGap: 60,
  /** 좌측 여백(픽셀). */
  marginX: 30,
  /** 컬럼 헤더 y 좌표(픽셀). */
  headerY: 20,
  /** 컬럼 내 첫 카드 y 시작 좌표. */
  cardYStart: 50,
  /** 카드 간 수직 간격(픽셀). */
  cardYStep: 62,
  /** 카드 높이. */
  cardH: 56,
  /** center 카드 크기. */
  centerW: 220,
  centerH: 110,
  /** 컬럼당 최대 카드 수 — 누락 방지를 위한 안전 상한. */
  topN: 64,
} as const;

/** 컬럼 x 좌표 — depth가 정수로 들어오면 좌→우 순서대로 누적 계산. */
function columnX(orderIndex: number): number {
  return EGO_LAYOUT.marginX + orderIndex * (EGO_LAYOUT.colW + EGO_LAYOUT.colGap);
}

/**
 * 비동기 라우터(metricsRouter와 동일 패턴) — POST 본문 파싱이 await가 필요해서 RouteHandler(sync)에 안 맞음.
 * api.ts에서 별도 await 분기로 호출한다.
 */
/**
 * Unix ms 타임스탬프 쿼리 파라미터 파서.
 * - null/빈 문자열 → undefined (기간 미지정으로 해석)
 * - Number.isFinite 실패 → undefined (기존 폴백 유지)
 * - 그 외 → 숫자 변환값
 * meta-docs-date-range-filter (2026-05-21): /api/meta-docs와 /api/meta-docs/flow가 동일 규칙으로 파싱.
 */
function parseTs(v: string | null): number | undefined {
  if (v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export async function metaDocsRouter(req: Request, db: Database): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // GET /api/meta-docs
  if (path === '/api/meta-docs' && method === 'GET') {
    const typeParam = url.searchParams.get('type');
    const sourceRootParam = url.searchParams.get('source_root');
    const projectParam = url.searchParams.get('project');
    const includeDeleted = url.searchParams.get('includeDeleted') === '1';
    // meta-docs-date-range-filter (2026-05-21): 카탈로그 사용 집계도 화면 상단 #dateFilter의
    // active-range를 따라가도록 fromTs/toTs를 받는다. flow 라우트와 동일한 파싱 규칙 적용.
    const fromTs = parseTs(url.searchParams.get('fromTs'));
    const toTs   = parseTs(url.searchParams.get('toTs'));

    const type = typeParam && (ALLOWED_TYPES as string[]).includes(typeParam)
      ? (typeParam as MetaDocType)
      : undefined;

    let source_root: string | null | undefined;
    if (sourceRootParam === null) source_root = undefined;
    else if (sourceRootParam === 'null' || sourceRootParam === '') source_root = null;
    else source_root = sourceRootParam;

    // meta-docs-project-filter-parity (2026-05-21):
    //   ego-graph(GET /api/meta-docs/flow)와 동일한 project 파라미터를 받아 사용 집계를
    //   sessions JOIN으로 좁힌다. 빈 문자열/'null'은 미지정으로 해석.
    const project = projectParam && projectParam !== '' && projectParam !== 'null'
      ? projectParam
      : undefined;

    const data = listMetaDocsWithUsage(db, { type, source_root, includeDeleted, fromTs, toTs, project });
    return jsonResponse({ success: true, data, meta: { total: data.length } });
  }

  // GET /api/meta-docs/flow (ego-graph 모드 — ADR meta-docs-flow rev. 2026-05-21)
  //
  // 입력:
  //   ?project=<name>         프로젝트 단위(없으면 전체)
  //   ?windowDays=<N>         시간 윈도우(기본 7)
  //   ?fromTs=<unixMs>        명시적 기간 시작 (선택 — 주어지면 windowDays보다 우선)
  //   ?toTs=<unixMs>          명시적 기간 끝 (선택 — 주어지면 windowDays보다 우선)
  //   ?center_type=command|skill|agent   중심 메타 문서 타입(필수 — 세트로)
  //   ?center_name=<string>              중심 메타 문서 이름(필수 — 세트로)
  //
  // 출력:
  //   { success, data: { nodes, edges, sectionLabels, meta } }
  //   center 미지정 시: nodes=[], edges=[], sectionLabels=[] (프론트 empty 상태로 안내)
  if (path === '/api/meta-docs/flow' && method === 'GET') {
    const projectParam = url.searchParams.get('project');
    const windowDaysParam = url.searchParams.get('windowDays');
    const fromTsParam = url.searchParams.get('fromTs');
    const toTsParam   = url.searchParams.get('toTs');
    const centerTypeParam = url.searchParams.get('center_type');
    const centerNameParam = url.searchParams.get('center_name');

    const project = projectParam && projectParam !== '' && projectParam !== 'null'
      ? projectParam
      : null;
    const windowDays = windowDaysParam ? parseInt(windowDaysParam, 10) : 7;

    // 기간 검색 — fromTs/toTs가 주어지면 윈도우(windowDays)보다 우선한다.
    // 부적합 입력(NaN)은 undefined 처리해 기존 윈도우 폴백을 유지.
    // parseTs는 라우터 상단 SSoT 헬퍼를 재사용 (meta-docs-date-range-filter 2026-05-21).
    const fromTs = parseTs(fromTsParam);
    const toTs   = parseTs(toTsParam);

    const centerType = centerTypeParam
      && (ALLOWED_CENTER_TYPES as string[]).includes(centerTypeParam)
      ? (centerTypeParam as MetaFlowEgoCenterType)
      : null;
    const centerName = centerNameParam && centerNameParam !== '' ? centerNameParam : null;

    // center 미지정 — 빈 그래프(프론트가 empty 안내 책임).
    if (!centerType || !centerName) {
      return jsonResponse({
        success: true,
        data: {
          nodes: [],
          edges: [],
          sectionLabels: [],
          meta: {
            project,
            windowDays,
            fromTs,
            toTs,
            center: null,
            centerTurns: 0,
            centerInvocations: 0,
            totalTurns: 0,
          },
        },
      });
    }

    const ego = getMetaFlowEgo(db, {
      centerType,
      centerName,
      project,
      windowDays,
      fromTs,
      toTs,
    });
    const graph = buildEgoFlowGraph(ego, project, windowDays, fromTs, toTs);
    return jsonResponse({ success: true, data: graph });
  }

  // POST /api/meta-docs/refresh
  if (path === '/api/meta-docs/refresh' && method === 'POST') {
    return refreshHandler(req, db);
  }

  return null;
}

// ============================================================================
// Ego-Flow 그래프 변환 — getMetaFlowEgo 결과를 시각 스키마로 매핑.
// ============================================================================

/** 분자/분모를 백분율(소수 1자리 반올림)로 변환. 분모 0이면 0. */
function pctOf(num: number, denom: number): number {
  if (!denom || denom <= 0) return 0;
  return Math.round((num / denom) * 1000) / 10;
}

/** 슬래시 커맨드 표기 — '/git:commit' 형식 유지. */
function withSlash(name: string): string {
  return name.startsWith('/') ? name : `/${name}`;
}

/** kind→아이콘 매핑. 프론트 meta-docs-flow-view.js의 ICONS 키와 일치. */
function iconForKind(kind: MetaFlowEgoNodeKind, _name: string): string {
  if (kind === 'skill')   return 'book';
  if (kind === 'agent')   return 'agent';
  if (kind === 'mcp')     return 'plan';
  if (kind === 'command') return 'cmd';
  return 'cmd';
}

/** center 카드 아이콘 — 중심 메타 문서 타입에 따라. */
function iconForCenter(type: MetaFlowEgoCenterType): string {
  if (type === 'command') return 'cmd';
  if (type === 'skill')   return 'book';
  return 'agent';
}

/** 중심 카드 타이틀에서 슬래시 prefix 또는 raw name 결정. */
function titleForCenter(type: MetaFlowEgoCenterType, name: string): string {
  return type === 'command' ? withSlash(name) : name;
}

type FlowNode = {
  id: string;
  /** 'center'=중심 카드, 그 외는 callTree node kind. */
  kind: 'center' | MetaFlowEgoNodeKind;
  title: string;
  sub?: string;
  icon: string;
  x: number; y: number; w: number; h: number;
  variant?: 'center' | 'spoke';
  pills?: string[];
  /**
   * callTree 노드 depth.
   *   - 음수: 부모 BFS 컬럼(절댓값이 클수록 center에서 멀다)
   *   - 양수: 자식 BFS 컬럼
   *   - undefined: center 또는 turn-after 노드(timeline 으로 식별)
   * meta-docs-flow-dynamic-columns (2026-05-21): storage 안전 상한 32-홉까지 가변 정수.
   */
  depth?: number;
  /** 'after' 면 같은 턴 후속 노드(시간 흐름). 부재 시 호출 인과 노드. */
  timeline?: 'after';
  /**
   * MCP server 단위 그룹 카드일 때만 채워지는 sub-row 리스트.
   *  - title 은 server 이름(e.g. 'redmine'), sub 는 합산 turns · 합산 pct.
   *  - 각 row 의 fullName 은 클라이언트가 클릭 시 center 로 재로드하기 위한 풀네임.
   *  meta-docs-flow-mcp-grouping (2026-05-21).
   */
  subRows?: Array<{
    /** 풀네임 (e.g. 'mcp__redmine__getIssue') — 클릭 시 center 로 사용. */
    fullName: string;
    /** 표시용 짧은 이름 (e.g. 'getIssue'). parseMcpToolName 실패 시 fullName 그대로. */
    toolName: string;
    count: number;
    pct: number;
  }>;
};

type FlowEdgeStrength = 'strong' | 'medium' | 'weak' | 'sparse' | 'flow';

type FlowEdge = {
  id: string;
  from: string;
  to: string;
  /**
   * 'call'      = parent_tool_use_id 호출 인과(부모→자식). strength 4단 + tone.
   * 'turn-flow' = 같은 turn 시간 흐름(center→after). strength='flow' 점선.
   */
  kind: 'call' | 'turn-flow';
  /**
   * call edge 호출 빈도 강도(ADR-002).
   *   strong ≥50% / medium 20~50% / weak 5~20% / sparse <5%
   * turn-flow edge 는 'flow' 고정(점선 톤).
   */
  strength?: FlowEdgeStrength;
  tone?: 'hot';
  anchorFrom?: 'left' | 'right' | 'top' | 'bottom';
  anchorTo?:   'left' | 'right' | 'top' | 'bottom';
};

/**
 * pct(0~100 정수%)를 strength 4단으로 매핑.
 * ADR-002의 임계값(50/20/5) 기준. UI 정책이므로 storage가 아닌 라우트에서 관리.
 * export는 단위 테스트(meta-docs-flow-strength.test.ts) 전용.
 */
export function pctToStrength(pct: number): Exclude<FlowEdgeStrength, 'flow'> {
  if (pct >= 50) return 'strong';
  if (pct >= 20) return 'medium';
  if (pct >= 5)  return 'weak';
  return 'sparse';
}

// ============================================================================
// MCP server 단위 그룹핑 — meta-docs-flow-mcp-grouping (2026-05-21)
//
// 같은 컬럼(parent depth / child depth / turn-after) 안에서 동일 server 의 mcp 도구가
// 2개 이상이면 server 단위 카드 1개(group)로 묶고, 1개뿐이면 기존 단일 카드(single).
// 도구 호출 빈도가 높은 server 가 N개의 카드로 컬럼을 가득 채우는 것을 막아 정보 위계를
// 보존한다. depth/timeline 의 의미는 컬럼별로 독립이라 server 가 부모·자식 양쪽에
// 등장하면 자연스럽게 두 카드로 분리된다.
// ============================================================================

/**
 * 한 컬럼 안의 노드 리스트를 표시 엔티티 배열로 변환.
 *  - mcp 이외의 kind 는 항상 single.
 *  - 동일 server 의 mcp 도구가 2+ → group (totalCount 는 단순 합산: distinct turn union 의 근사치).
 *  - 동일 server 의 mcp 도구가 1개뿐 → single (무의미한 wrap 방지).
 *  - 그룹 위치는 입력 리스트에서 그 server 가 처음 등장한 위치를 유지한다(정렬은 호출 측에서 끝났음).
 */
type ColumnEntity =
  | { type: 'single'; node: MetaFlowEgoNode }
  | { type: 'group'; server: string; nodes: MetaFlowEgoNode[]; totalCount: number };

function buildColumnEntities(list: MetaFlowEgoNode[]): ColumnEntity[] {
  const out: ColumnEntity[] = [];
  /** server → out[] 내 placeholder index. 등장한 server 의 첫 위치를 보존. */
  const serverSlot = new Map<string, number>();
  /** server → 누적 노드. placeholder index 가 가리키는 entity 를 마지막에 채운다. */
  const serverNodes = new Map<string, MetaFlowEgoNode[]>();

  for (const n of list) {
    if (n.kind === 'mcp') {
      const parsed = parseMcpToolName(n.name);
      if (parsed) {
        const { server } = parsed;
        const acc = serverNodes.get(server);
        if (acc) {
          acc.push(n);
        } else {
          serverNodes.set(server, [n]);
          serverSlot.set(server, out.length);
          // placeholder — finalize 단계에서 단/그룹 결정.
          out.push({ type: 'group', server, nodes: [n], totalCount: 0 });
        }
        continue;
      }
    }
    out.push({ type: 'single', node: n });
  }

  // finalize: server 별 노드 수에 따라 group / single 확정.
  for (const [server, ns] of serverNodes) {
    const slot = serverSlot.get(server)!;
    if (ns.length === 1) {
      out[slot] = { type: 'single', node: ns[0] };
    } else {
      out[slot] = {
        type: 'group',
        server,
        nodes: ns,
        totalCount: ns.reduce((s, n) => s + n.count, 0),
      };
    }
  }
  return out;
}

/** SVG 텍스트로 그릴 컬럼 헤더 라벨. 텍스트는 프론트가 i18n으로 채움. */
type SectionLabel = {
  /** 컬럼 중앙 x (텍스트 anchor='middle' 기준). */
  x: number;
  y: number;
  /**
   * 컬럼 종류 — 프론트가 i18n 키로 매핑.
   *   - 부모 depth N: 'parent-N' (N ≥ 1, 동적)
   *   - 자식 depth N: 'depth-N' (N ≥ 1, 동적)
   *   - turn-after: 'turn-after'
   * meta-docs-flow-dynamic-columns (2026-05-21): N은 storage BFS 깊이에 따라 가변.
   */
  kind: string;
};

type EgoFlowGraph = {
  nodes: FlowNode[];
  edges: FlowEdge[];
  sectionLabels: SectionLabel[];
  meta: {
    project: string | null;
    windowDays: number;
    /**
     * 명시적 기간 시작/끝(Unix ms). 둘 다 주어지면 windowDays보다 우선.
     * 프론트가 표시·재요청 시 라운드트립 가능하도록 응답에 echo.
     */
    fromTs?: number;
    toTs?: number;
    /** 중심 메타 문서(요청 파라미터 echo). */
    center: { type: MetaFlowEgoCenterType; name: string } | null;
    /** 중심이 발견된 turn 수(분모). */
    centerTurns: number;
    /**
     * 중심 row 총 호출 수(COUNT(*)) — v_meta_doc_usage.invocations 와 동일 단위.
     * UI 가 카드의 "calls" 와 ego-graph 의 "turns" 차이를 동시에 노출할 때 사용.
     */
    centerInvocations: number;
    /** 동일 윈도우의 전체 turn 수(비교용). */
    totalTurns: number;
    /** SVG viewBox 정보 — 프론트가 그대로 적용. */
    viewBox: { w: number; h: number };
  };
};

/**
 * ColumnEntity 1개를 FlowNode 로 push 하고 idByKindName / orderIdx 도 갱신.
 *  - single: 기존 로직과 동일한 단일 카드.
 *  - group: title=server, sub=합산 turns·%, subRows=각 도구 row.
 *           idByKindName 등록 시 그룹 내 모든 도구 풀네임을 동일 group id 로 매핑해
 *           엣지가 자동으로 그룹으로 수렴되도록 한다.
 *  - timeline='after' 인 경우 idByKindName 키 prefix 가 'after:' 라 분리 처리.
 */
type EmitOpts = {
  id: string;
  x: number;
  y: number;
  /** parent/child 컬럼에서만 사용. after 컬럼에서는 생략. */
  depth?: number;
  /** after 컬럼 식별자. 있으면 idByKindName 키에 'after:' prefix 사용. */
  timeline?: 'after';
  nodes: FlowNode[];
  idByKindName: Map<string, string>;
  orderIdx: Map<string, number>;
  runningSeq: number;
  /** pct 계산 분모(=centerTurns). */
  denom: number;
};

function emitSpokeEntity(entity: ColumnEntity, opts: EmitOpts): void {
  const { id, x, y, depth, timeline, nodes, idByKindName, orderIdx, runningSeq, denom } = opts;
  const keyOf = (kind: MetaFlowEgoNodeKind, name: string) =>
    timeline === 'after' ? `after:${kind}:${name}` : `${kind}:${name}`;

  if (entity.type === 'single') {
    const n = entity.node;
    idByKindName.set(keyOf(n.kind, n.name), id);
    if (timeline !== 'after') orderIdx.set(`${n.kind}:${n.name}`, runningSeq);
    const ratio = pctOf(n.count, denom);
    nodes.push({
      id,
      kind: n.kind,
      title: n.kind === 'command' ? withSlash(n.name) : n.name,
      sub: `<b>${n.count}</b> turns · ${ratio}%`,
      icon: iconForKind(n.kind, n.name),
      x, y,
      w: EGO_LAYOUT.colW,
      h: EGO_LAYOUT.cardH,
      variant: 'spoke',
      depth,
      timeline,
    });
    return;
  }

  // group: 모든 sub-tool 의 풀네임을 group id 로 매핑.
  for (const n of entity.nodes) {
    idByKindName.set(keyOf(n.kind, n.name), id);
    if (timeline !== 'after') orderIdx.set(`${n.kind}:${n.name}`, runningSeq);
  }
  const ratio = pctOf(entity.totalCount, denom);
  nodes.push({
    id,
    kind: 'mcp',
    title: entity.server,
    sub: `<b>${entity.totalCount}</b> turns · ${ratio}%`,
    icon: iconForKind('mcp', entity.server),
    x, y,
    w: EGO_LAYOUT.colW,
    h: EGO_LAYOUT.cardH,
    variant: 'spoke',
    depth,
    timeline,
    subRows: entity.nodes.map((n) => {
      const parsed = parseMcpToolName(n.name);
      return {
        fullName: n.name,
        toolName: parsed?.tool ?? n.name,
        count: n.count,
        pct: pctOf(n.count, denom),
      };
    }),
  });
}

/**
 * Ego-graph 매핑 — callTree 기반 (meta-docs-flow-tree 2026-05-21).
 *
 * 위상:
 *   trigger spokes(left, top-N slash_command)
 *     → center(메타 문서)
 *     → callTree depth 1 / 2 / 3 (right, BFS 호출 계층)
 *
 * - cooccurrence는 폐기. center→자식 edge는 ego.callTree.edges만 사용.
 * - 노드 sub: "<b>N</b>회 · M%" (호출 횟수와 centerTurns 분모 백분율).
 * - edge에는 별도 라벨을 넣지 않는다(노드 카드 sub와 중복되어 시각적 노이즈).
 *
 * 정렬:
 *   depth 1 — count DESC (가장 많이 호출된 직접 자식이 위).
 *   depth 2 — 부모(depth 1) 표시 순서 기준 클러스터링, 클러스터 내부는 count DESC.
 *   depth 3 — 동일 규칙으로 depth 2 부모 클러스터링.
 *   이 정렬로 같은 부모를 가진 자식이 시각적으로 인접해 호출 계층이 자연스럽게 보인다.
 *
 * pct 분모: ego.center.turns (중심이 발견된 turn 수). 분모가 0이면 callTree 없이 종료.
 *
 * export는 단위 테스트(meta-docs-flow-layout.test.ts) 전용.
 */
export function buildEgoFlowGraph(
  ego: MetaFlowEgo,
  project: string | null,
  windowDays: number,
  fromTs?: number,
  toTs?: number,
): EgoFlowGraph {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const sectionLabels: SectionLabel[] = [];

  const centerTurns = ego.center.turns;
  const denom = centerTurns;

  // ── callTree 노드 분류 — 부모/자식/turn-after 컬럼별로 분리 ─────────────
  // storage 단계에서 이미 (timeline ASC, depth ASC, count DESC) 정렬됨.
  // meta-docs-flow-dynamic-columns (2026-05-21): depth는 가변 정수.
  const parentByDepth = new Map<number, MetaFlowEgoNode[]>();
  const childByDepth  = new Map<number, MetaFlowEgoNode[]>();
  const afterNodes: MetaFlowEgoNode[] = [];
  for (const n of ego.callTree.nodes) {
    if (n.timeline === 'after') { afterNodes.push(n); continue; }
    if (n.depth < 0) {
      const list = parentByDepth.get(n.depth) ?? [];
      list.push(n);
      parentByDepth.set(n.depth, list);
    } else if (n.depth > 0) {
      const list = childByDepth.get(n.depth) ?? [];
      list.push(n);
      childByDepth.set(n.depth, list);
    }
    // depth=0 + timeline=null 은 storage에서 생성하지 않음(자기 자신 제외 정책).
  }

  // 등장한 depth 집합을 좌→우 컬럼 순서로 정렬.
  //   parent: 절댓값 큰 순(가장 먼 부모가 가장 왼쪽) → ... → -1
  //   center
  //   child: 1 → ... → 가장 먼 자식 (가장 오른쪽)
  //   turn-after (마지막)
  const parentDepths = [...parentByDepth.keys()].sort((a, b) => a - b); // -N..-1
  const childDepths  = [...childByDepth.keys()].sort((a, b) => a - b);  // 1..N
  const hasAfter     = afterNodes.length > 0;

  // 컬럼 인덱스 매핑 — 좌→우 순서.
  const colOrder: Array<{ tag: 'parent' | 'center' | 'child' | 'after'; depth?: number }> = [];
  for (const d of parentDepths) colOrder.push({ tag: 'parent', depth: d });
  colOrder.push({ tag: 'center' });
  for (const d of childDepths)  colOrder.push({ tag: 'child', depth: d });
  if (hasAfter) colOrder.push({ tag: 'after' });

  // 인덱스 헬퍼 — 동일 depth는 동일 컬럼.
  function indexOfParent(d: number): number {
    return colOrder.findIndex((c) => c.tag === 'parent' && c.depth === d);
  }
  function indexOfChild(d: number): number {
    return colOrder.findIndex((c) => c.tag === 'child' && c.depth === d);
  }
  const centerIdx = colOrder.findIndex((c) => c.tag === 'center');
  const afterIdx  = colOrder.findIndex((c) => c.tag === 'after');

  // viewBox 시드 — 클라이언트의 computeRelaxedLayout이 최종 갱신.
  const seedViewW = Math.max(
    EGO_LAYOUT.marginX * 2 + colOrder.length * (EGO_LAYOUT.colW + EGO_LAYOUT.colGap),
    600,
  );

  // 발견 0회면 — center 카드도 만들지 않고 빈 nodes/edges 로 반환.
  // 클라이언트(meta-docs-flow-view.js)가 nodes.length===0 분기로 들어가
  // `empty-zero-turns` 안내 문구만 노출한다(노드를 그리지 않음).
  if (centerTurns === 0) {
    return {
      nodes: [], edges: [], sectionLabels: [],
      meta: {
        project, windowDays,
        fromTs, toTs,
        center: { type: ego.center.type, name: ego.center.name },
        centerTurns,
        centerInvocations: ego.center.invocations,
        totalTurns: ego.totalTurns,
        viewBox: { w: seedViewW, h: EGO_LAYOUT.viewH },
      },
    };
  }

  // ── center 카드 ──────────────────────────────────────────────────────────
  //   sub 는 "<b>N</b> turns" 를 메인으로 두고, distinct turn ≠ COUNT(*) 인 경우
  //   "· M calls" 를 보조 라벨로 덧붙인다. 두 값이 같으면 calls 라벨 생략 — 카드 뷰의
  //   invocations 컬럼과 ego-graph 의 turns 단위가 다르다는 점을 명시적으로 노출.
  const centerX = columnX(centerIdx);
  const centerInv = ego.center.invocations;
  const centerSub = centerInv > centerTurns
    ? `<b>${centerTurns}</b> turns · ${centerInv} calls`
    : `<b>${centerTurns}</b> turns`;
  nodes.push({
    id: 'center',
    kind: 'center',
    title: titleForCenter(ego.center.type, ego.center.name),
    sub: centerSub,
    icon: iconForCenter(ego.center.type),
    // center 카드는 컬럼 가로폭 안에 중앙 정렬(centerW > colW 인 경우 살짝 좌측으로).
    x: centerX - (EGO_LAYOUT.centerW - EGO_LAYOUT.colW) / 2,
    y: 130,
    w: EGO_LAYOUT.centerW,
    h: EGO_LAYOUT.centerH,
    variant: 'center',
    pills: ego.totalTurns > 0 && centerTurns / ego.totalTurns >= 0.4 ? ['hot'] : undefined,
  });

  // (kind, name) → FlowNode id — center 도 동일 키 공간 공유.
  const idByKindName = new Map<string, string>();
  idByKindName.set(`${ego.center.type}:${ego.center.name}`, 'center');

  // 클러스터 정렬용 인덱스 — "센터에 가까운 이웃 컬럼의 표시 순서" 를 매개로 같은 부모/자식을 인접 배치.
  //   firstParentOf: 자식 노드 → 첫 번째 부모(call edge 의 from)
  //   firstChildOf : 부모 노드 → 첫 번째 자식(call edge 의 to)
  const firstParentOf = new Map<string, string>();
  const firstChildOf  = new Map<string, string>();
  for (const e of ego.callTree.edges) {
    if (e.relation !== 'call') continue;
    const childKey  = `${e.toKind}:${e.toName}`;
    const parentKey = `${e.fromKind}:${e.fromName}`;
    if (!firstParentOf.has(childKey))  firstParentOf.set(childKey, parentKey);
    if (!firstChildOf.has(parentKey))  firstChildOf.set(parentKey, childKey);
  }

  // orderIdx: 표시된 노드의 통합 시퀀스 — 부모 컬럼은 center 에 가까운 쪽(-1)부터,
  // 자식 컬럼은 center 에 가까운 쪽(+1)부터 채워 클러스터링 키로 사용.
  const orderIdx = new Map<string, number>();
  orderIdx.set(`${ego.center.type}:${ego.center.name}`, 0);
  let runningSeq = 0;

  // ── 부모 컬럼 — depth=-1 안쪽부터 바깥(-N)으로 ──────────────────────────
  // 정렬: depth=-1은 count DESC (storage 정렬 그대로). 나머지는 firstChildOf 기준 클러스터링.
  // (parentDepths는 -N..-1 오름차순 정렬됨 → 안쪽(-1)부터 처리하려면 역순 순회.)
  for (let i = parentDepths.length - 1; i >= 0; i--) {
    const depth = parentDepths[i];
    const list = parentByDepth.get(depth) ?? [];
    if (list.length === 0) continue;

    const sorted = depth === -1
      ? list.slice()
      : list.slice().sort((a, b) => {
          const ca = orderIdx.get(firstChildOf.get(`${a.kind}:${a.name}`) ?? '') ?? Number.MAX_SAFE_INTEGER;
          const cb = orderIdx.get(firstChildOf.get(`${b.kind}:${b.name}`) ?? '') ?? Number.MAX_SAFE_INTEGER;
          if (ca !== cb) return ca - cb;
          return b.count - a.count;
        });

    // mcp server 단위 그룹핑 후 entity 단위로 카드를 발행.
    const entities = buildColumnEntities(sorted).slice(0, EGO_LAYOUT.topN);
    const colIdx = indexOfParent(depth);
    const colX = columnX(colIdx);
    const labelKind = `parent-${-depth}`;

    sectionLabels.push({ x: colX + EGO_LAYOUT.colW / 2, y: EGO_LAYOUT.headerY, kind: labelKind });

    entities.forEach((entity, idx) => {
      runningSeq += 1;
      const id = `p${-depth}_${idx + 1}`;
      const y = EGO_LAYOUT.cardYStart + idx * EGO_LAYOUT.cardYStep;
      emitSpokeEntity(entity, {
        id, x: colX, y, depth,
        nodes, idByKindName, orderIdx, runningSeq, denom,
      });
    });
  }

  // ── 자식 컬럼 — depth=1..N (안쪽부터 바깥쪽) ────────────────────────────
  for (const depth of childDepths) {
    const list = childByDepth.get(depth) ?? [];
    if (list.length === 0) continue;

    const sorted = depth === 1
      ? list.slice()
      : list.slice().sort((a, b) => {
          const pa = orderIdx.get(firstParentOf.get(`${a.kind}:${a.name}`) ?? '') ?? Number.MAX_SAFE_INTEGER;
          const pb = orderIdx.get(firstParentOf.get(`${b.kind}:${b.name}`) ?? '') ?? Number.MAX_SAFE_INTEGER;
          if (pa !== pb) return pa - pb;
          return b.count - a.count;
        });

    const entities = buildColumnEntities(sorted).slice(0, EGO_LAYOUT.topN);
    const colIdx = indexOfChild(depth);
    const colX = columnX(colIdx);
    const labelKind = `depth-${depth}`;

    sectionLabels.push({ x: colX + EGO_LAYOUT.colW / 2, y: EGO_LAYOUT.headerY, kind: labelKind });

    entities.forEach((entity, idx) => {
      runningSeq += 1;
      const id = `d${depth}_${idx + 1}`;
      const y = EGO_LAYOUT.cardYStart + idx * EGO_LAYOUT.cardYStep;
      emitSpokeEntity(entity, {
        id, x: colX, y, depth,
        nodes, idByKindName, orderIdx, runningSeq, denom,
      });
    });
  }

  // ── turn-after 컬럼 — 같은 turn 시간 흐름 후속 ──────────────────────────
  if (hasAfter) {
    const entities = buildColumnEntities(afterNodes).slice(0, EGO_LAYOUT.topN);
    const colX = columnX(afterIdx);
    sectionLabels.push({ x: colX + EGO_LAYOUT.colW / 2, y: EGO_LAYOUT.headerY, kind: 'turn-after' });
    entities.forEach((entity, idx) => {
      const id = `ta_${idx + 1}`;
      const y = EGO_LAYOUT.cardYStart + idx * EGO_LAYOUT.cardYStep;
      emitSpokeEntity(entity, {
        id, x: colX, y, timeline: 'after',
        nodes, idByKindName, orderIdx, runningSeq: 0, denom,
      });
    });
  }

  // ── 엣지 변환 — call 인과 + turn-flow 시간 흐름 ─────────────────────────
  //
  // mcp server 그룹핑 후에는 동일 (from,to,kind) 페어가 N개 생성될 수 있다
  // (예: center → mcp__redmine__getIssue, center → mcp__redmine__updateIssue 가 모두 center → 'redmine' 그룹).
  //
  // strength 정책 (structured-coalescing-feather P0-P3):
  //   call edge dedup 시 count 를 합산한 뒤 합산 ratio 로 strength 를 재계산한다.
  //   기존의 STRENGTH_RANK max 정책은 단일 도구 호출이 50% 임계를 못 넘어도
  //   그룹 합계로 충분히 강한 빈도를 가질 때 strength 가 과소표현되는 결함이 있다.
  //   turn-flow 는 strength='flow' 고정이라 dedup 시 변경 없음.
  const edgePairs = new Map<string, FlowEdge>();
  const callAccumCount = new Map<string, number>();
  for (const e of ego.callTree.edges) {
    let fromId: string | undefined;
    let toId: string | undefined;
    let edgeKind: FlowEdge['kind'];

    if (e.relation === 'turn-flow') {
      fromId = idByKindName.get(`${e.fromKind}:${e.fromName}`);
      toId   = idByKindName.get(`after:${e.toKind}:${e.toName}`);
      edgeKind = 'turn-flow';
    } else {
      fromId = idByKindName.get(`${e.fromKind}:${e.fromName}`);
      toId   = idByKindName.get(`${e.toKind}:${e.toName}`);
      edgeKind = 'call';
    }
    if (!fromId || !toId) continue;
    // self-loop 제거 — 그룹핑 결과 같은 group 안의 도구끼리 호출 관계가 있었을 때 발생.
    if (fromId === toId) continue;

    const key = `${fromId}|${toId}|${edgeKind}`;
    const prev = edgePairs.get(key);

    if (edgeKind === 'call') {
      const accum = (callAccumCount.get(key) ?? 0) + e.count;
      callAccumCount.set(key, accum);
      const newStrength = pctToStrength(pctOf(accum, denom));
      if (!prev) {
        edgePairs.set(key, {
          id: '',
          from: fromId, to: toId,
          kind: edgeKind,
          strength: newStrength,
          anchorFrom: 'right',
          anchorTo: 'left',
        });
      } else {
        prev.strength = newStrength;
      }
    } else {
      if (!prev) {
        edgePairs.set(key, {
          id: '',
          from: fromId, to: toId,
          kind: edgeKind,
          strength: 'flow',
          anchorFrom: 'right',
          anchorTo: 'left',
        });
      }
    }
  }
  // 최종 id 발번 — call → flow 순서로 정렬해 안정적인 id 순서 보장(테스트/디버그 편의).
  let callSeq = 0;
  let flowSeq = 0;
  for (const e of edgePairs.values()) {
    if (e.kind === 'call') { callSeq += 1; e.id = `e_call_${callSeq}`; }
    else                    { flowSeq += 1; e.id = `e_flow_${flowSeq}`; }
    edges.push(e);
  }

  return {
    nodes, edges, sectionLabels,
    meta: {
      project, windowDays,
      fromTs, toTs,
      center: { type: ego.center.type, name: ego.center.name },
      centerTurns,
      centerInvocations: ego.center.invocations,
      totalTurns: ego.totalTurns,
      viewBox: { w: seedViewW, h: EGO_LAYOUT.viewH },
    },
  };
}

async function refreshHandler(req: Request, db: Database): Promise<Response> {
  let body: {
    scope?: string;
    cwd?: string;
    includeKnownCwds?: boolean;
    force?: boolean;
  } = {};
  try {
    if (req.headers.get('content-type')?.includes('application/json')) {
      body = await req.json();
    }
  } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const scope = body.scope ?? 'all';
  const force = body.force === true;
  const includeKnownCwds = body.includeKnownCwds === true;

  const result: Record<string, unknown> = {};

  if (scope === 'global' || scope === 'all') {
    result.global = syncGlobalOnce(db, { force });
  }

  if (scope === 'project' || scope === 'all') {
    if (!body.cwd) {
      if (scope === 'project') {
        return jsonResponse({
          success: false,
          error: 'cwd is required for scope=project',
        }, 400);
      }
      // scope=all이고 cwd 미지정이면 project 단일 동기화는 skip — 대신 includeKnownCwds로 처리.
    } else {
      result.project = syncCwd(db, body.cwd, { force });
    }
  }

  // 모집단 확장: 알려진 모든 cwd를 일괄 동기화 (orphan Behavior Definitions 카탈로그 등록).
  if (includeKnownCwds && (scope === 'project' || scope === 'all')) {
    const all = syncAllKnownCwds(db, { force });
    result.cwds = all.cwds;
  }

  return jsonResponse({ success: true, data: result });
}
