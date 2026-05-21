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
  type MetaFlowEgoSpoke,
} from '@spyglass/storage';
import { jsonResponse } from './_shared';
import { syncCwd, syncGlobalOnce, syncAllKnownCwds } from '../meta-docs';

const ALLOWED_TYPES: MetaDocType[] = ['agent', 'skill', 'command'];
const ALLOWED_CENTER_TYPES: MetaFlowEgoCenterType[] = ['command', 'skill', 'agent'];

// ── Ego-Flow 레이아웃 상수 ──────────────────────────────────────────────────
// 메타 문서 탭 상단 영역에 들어가는 컴팩트한 ego-graph용 viewBox.
// 좌(triggers) → 중(center) → 우(cooccurrence 4 columns: skill/agent/tool/mcp).
// 변경 시 packages/web/assets/js/meta-docs-flow-view.js shellHtml SVG viewBox와 함께 갱신할 것.
const EGO_LAYOUT = {
  viewW: 1560,
  viewH: 360,

  // 좌측 트리거(슬래시 커맨드) 4개 세로 스택.
  trigger: { x: 30, yStart: 30, yStep: 75, w: 180, h: 60 },
  triggerTopN: 4,

  // 중앙 center 카드(선택된 메타 문서).
  center: { x: 510, y: 130, w: 220, h: 110 },

  // 우측 4 카테고리 컬럼 — 각 카테고리는 헤더 라벨 + 카드 stack.
  // x 좌표는 컬럼 좌상단. headerY/카드 시작 y, step 등 모두 viewH(360) 안에 수렴.
  // 카드가 콘텐츠에 맞게 가로로 늘어날 수 있도록 컬럼 간격을 넉넉히 둔다.
  rightCols: {
    skill: { x: 800,  headerY: 20, cardYStart: 50, cardYStep: 62, w: 150, h: 56 },
    agent: { x: 1000, headerY: 20, cardYStart: 50, cardYStep: 62, w: 150, h: 56 },
    tool:  { x: 1200, headerY: 20, cardYStart: 50, cardYStep: 62, w: 150, h: 56 },
    mcp:   { x: 1400, headerY: 20, cardYStart: 50, cardYStep: 62, w: 130, h: 56 },
  },
  /** 각 우측 컬럼당 최대 카드 수(카테고리 cardYStep × N이 viewH-50 이하가 되도록). */
  rightTopN: 4,
} as const;

/**
 * 비동기 라우터(metricsRouter와 동일 패턴) — POST 본문 파싱이 await가 필요해서 RouteHandler(sync)에 안 맞음.
 * api.ts에서 별도 await 분기로 호출한다.
 */
export async function metaDocsRouter(req: Request, db: Database): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // GET /api/meta-docs
  if (path === '/api/meta-docs' && method === 'GET') {
    const typeParam = url.searchParams.get('type');
    const sourceRootParam = url.searchParams.get('source_root');
    const includeDeleted = url.searchParams.get('includeDeleted') === '1';

    const type = typeParam && (ALLOWED_TYPES as string[]).includes(typeParam)
      ? (typeParam as MetaDocType)
      : undefined;

    let source_root: string | null | undefined;
    if (sourceRootParam === null) source_root = undefined;
    else if (sourceRootParam === 'null' || sourceRootParam === '') source_root = null;
    else source_root = sourceRootParam;

    const data = listMetaDocsWithUsage(db, { type, source_root, includeDeleted });
    return jsonResponse({ success: true, data, meta: { total: data.length } });
  }

  // GET /api/meta-docs/flow (ego-graph 모드 — ADR meta-docs-flow rev. 2026-05-21)
  //
  // 입력:
  //   ?project=<name>         프로젝트 단위(없으면 전체)
  //   ?windowDays=<N>         시간 윈도우(기본 7)
  //   ?center_type=command|skill|agent   중심 메타 문서 타입(필수 — 세트로)
  //   ?center_name=<string>              중심 메타 문서 이름(필수 — 세트로)
  //
  // 출력:
  //   { success, data: { nodes, edges, sectionLabels, meta } }
  //   center 미지정 시: nodes=[], edges=[], sectionLabels=[] (프론트 empty 상태로 안내)
  if (path === '/api/meta-docs/flow' && method === 'GET') {
    const projectParam = url.searchParams.get('project');
    const windowDaysParam = url.searchParams.get('windowDays');
    const centerTypeParam = url.searchParams.get('center_type');
    const centerNameParam = url.searchParams.get('center_name');

    const project = projectParam && projectParam !== '' && projectParam !== 'null'
      ? projectParam
      : null;
    const windowDays = windowDaysParam ? parseInt(windowDaysParam, 10) : 7;

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
          meta: { project, windowDays, center: null, centerTurns: 0, totalTurns: 0 },
        },
      });
    }

    const ego = getMetaFlowEgo(db, { centerType, centerName, project, windowDays });
    const graph = buildEgoFlowGraph(ego, project, windowDays);
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
function iconForSpoke(kind: 'skill' | 'agent' | 'tool' | 'mcp', name: string): string {
  if (kind === 'skill') return 'book';
  if (kind === 'agent') return 'agent';
  if (kind === 'mcp')   return 'plan';
  const lower = name.toLowerCase();
  if (lower === 'read' || lower.includes('read'))  return 'file';
  if (lower === 'edit' || lower.includes('edit') || lower.includes('write')) return 'edit';
  if (lower === 'bash' || lower === 'task')        return 'cmd';
  if (lower.includes('search') || lower.includes('grep') || lower.includes('glob')) return 'search';
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
  /** 'center'=중심 카드, 'trigger'=좌측 슬래시커맨드, 'skill'|'agent'|'tool'|'mcp'=우측 공출현. */
  kind: 'center' | 'trigger' | 'skill' | 'agent' | 'tool' | 'mcp';
  title: string;
  sub?: string;
  icon: string;
  x: number; y: number; w: number; h: number;
  variant?: 'center' | 'trigger' | 'spoke';
  pills?: string[];
};

type FlowEdge = {
  id: string;
  from: string;
  to: string;
  /** 'main'=일반, 'hot'=≥40%, 'dim'=≤5%, 'spoke'=center→cooccurrence(dashed). */
  kind: 'main' | 'hot' | 'dim' | 'spoke';
  label?: { pct?: number; count?: number };
  tone?: 'hot';
  anchorFrom?: 'left' | 'right' | 'top' | 'bottom';
  anchorTo?:   'left' | 'right' | 'top' | 'bottom';
};

/** SVG 텍스트로 그릴 우측 카테고리 헤더 라벨. 텍스트는 프론트가 i18n으로 채움. */
type SectionLabel = {
  /** 컬럼 중앙 x (텍스트 anchor='middle' 기준). */
  x: number;
  y: number;
  kind: 'skill' | 'agent' | 'tool' | 'mcp';
};

type EgoFlowGraph = {
  nodes: FlowNode[];
  edges: FlowEdge[];
  sectionLabels: SectionLabel[];
  meta: {
    project: string | null;
    windowDays: number;
    /** 중심 메타 문서(요청 파라미터 echo). */
    center: { type: MetaFlowEgoCenterType; name: string } | null;
    /** 중심이 발견된 turn 수(분모). */
    centerTurns: number;
    /** 동일 윈도우의 전체 turn 수(비교용). */
    totalTurns: number;
    /** SVG viewBox 정보 — 프론트가 그대로 적용. */
    viewBox: { w: number; h: number };
  };
};

/**
 * Ego-graph 매핑.
 *
 * 위상:
 *   trigger spokes(left, top-N slash_command) → center(메타 문서) → cooccurrence spokes(right, 4 columns)
 *
 * 색·HOT 결정:
 *   - 사용률 ≥ 40% → kind:'hot', tone:'hot', pills:['hot']
 *   - 사용률 ≤ 5%  → kind:'dim'
 *   - 그 외         → kind:'main'
 *   center → spoke edge는 'spoke'(dashed).
 *
 * pct 분모: ego.center.turns (중심이 발견된 turn 수). 분모가 0이면 0.
 *   color=signal 원칙(memory feedback_chip_color_semantics) — 무채색이 기본.
 */
function buildEgoFlowGraph(
  ego: MetaFlowEgo,
  project: string | null,
  windowDays: number,
): EgoFlowGraph {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const sectionLabels: SectionLabel[] = [];

  const centerTurns = ego.center.turns;
  const denom = centerTurns;

  // ── center 카드 ──────────────────────────────────────────────────────────
  // 발견 0회여도 사용자가 선택한 항목이라 카드는 노출(빈 안내 sub만 다름).
  const centerSub = centerTurns > 0
    ? `<b>${centerTurns}</b> turns`
    : '0 turns';
  nodes.push({
    id: 'center',
    kind: 'center',
    title: titleForCenter(ego.center.type, ego.center.name),
    sub: centerSub,
    icon: iconForCenter(ego.center.type),
    x: EGO_LAYOUT.center.x,
    y: EGO_LAYOUT.center.y,
    w: EGO_LAYOUT.center.w,
    h: EGO_LAYOUT.center.h,
    variant: 'center',
    // center가 자기 호출 사용자 입력 turn 전체의 ≥40%면 hot 표시.
    pills: ego.totalTurns > 0 && centerTurns / ego.totalTurns >= 0.4 ? ['hot'] : undefined,
  });

  // 발견 0회면 — 좌·우 spokes 모두 없음. center만 출력 후 종료.
  if (centerTurns === 0) {
    return {
      nodes, edges, sectionLabels,
      meta: {
        project, windowDays,
        center: { type: ego.center.type, name: ego.center.name },
        centerTurns, totalTurns: ego.totalTurns,
        viewBox: { w: EGO_LAYOUT.viewW, h: EGO_LAYOUT.viewH },
      },
    };
  }

  // ── 좌측 triggers — top-N 세로 스택 ──────────────────────────────────────
  const triggers = ego.triggers.slice(0, EGO_LAYOUT.triggerTopN);
  const tL = EGO_LAYOUT.trigger;
  const hotTrigIdx = triggers.length > 0 && triggers[0].pct >= 0.4 ? 0 : -1;
  triggers.forEach((t: MetaFlowEgoSpoke, i: number) => {
    const id = `t${i + 1}`;
    const ratio = pctOf(t.count, denom);
    nodes.push({
      id, kind: 'trigger',
      title: withSlash(t.name),
      sub: `<b>${t.count}</b>회 · ${ratio}%`,
      icon: 'cmd',
      x: tL.x, y: tL.yStart + i * tL.yStep, w: tL.w, h: tL.h,
      variant: 'trigger',
      pills: i === hotTrigIdx ? ['hot'] : undefined,
    });
    // trigger → center
    edges.push({
      id: `e_${id}_center`,
      from: id, to: 'center',
      kind: i === hotTrigIdx ? 'hot' : (t.pct <= 0.05 ? 'dim' : 'main'),
      label: { pct: ratio, count: t.count },
      tone: i === hotTrigIdx ? 'hot' : undefined,
      anchorFrom: 'right',
      anchorTo: 'left',
    });
  });

  // ── 우측 cooccurrence — 4 카테고리 컬럼 ──────────────────────────────────
  type CooKind = 'skill' | 'agent' | 'tool' | 'mcp';
  const cooGroups: Array<{ kind: CooKind; rows: MetaFlowEgoSpoke[]; idPrefix: string }> = [
    { kind: 'skill', rows: ego.cooccurrence.skills.slice(0, EGO_LAYOUT.rightTopN), idPrefix: 's' },
    { kind: 'agent', rows: ego.cooccurrence.agents.slice(0, EGO_LAYOUT.rightTopN), idPrefix: 'a' },
    { kind: 'tool',  rows: ego.cooccurrence.tools.slice(0,  EGO_LAYOUT.rightTopN), idPrefix: 'l' },
    { kind: 'mcp',   rows: ego.cooccurrence.mcps.slice(0,   EGO_LAYOUT.rightTopN), idPrefix: 'm' },
  ];

  for (const g of cooGroups) {
    const col = EGO_LAYOUT.rightCols[g.kind];
    // 카테고리 헤더 라벨 — 데이터가 1건이라도 있으면 노출(빈 카테고리는 시각적 노이즈 최소화).
    if (g.rows.length > 0) {
      sectionLabels.push({
        x: col.x + col.w / 2,
        y: col.headerY,
        kind: g.kind,
      });
    }
    g.rows.forEach((r: MetaFlowEgoSpoke, i: number) => {
      const id = `${g.idPrefix}${i + 1}`;
      const ratio = pctOf(r.count, denom);
      nodes.push({
        id,
        kind: g.kind,
        title: r.name,
        sub: `<b>${r.count}</b>회 · ${ratio}%`,
        icon: iconForSpoke(g.kind, r.name),
        x: col.x,
        y: col.cardYStart + i * col.cardYStep,
        w: col.w,
        h: col.h,
        variant: 'spoke',
      });
      edges.push({
        id: `e_center_${id}`,
        from: 'center', to: id,
        kind: 'spoke',
        anchorFrom: 'right',
        anchorTo: 'left',
      });
    });
  }

  return {
    nodes, edges, sectionLabels,
    meta: {
      project, windowDays,
      center: { type: ego.center.type, name: ego.center.name },
      centerTurns, totalTurns: ego.totalTurns,
      viewBox: { w: EGO_LAYOUT.viewW, h: EGO_LAYOUT.viewH },
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
