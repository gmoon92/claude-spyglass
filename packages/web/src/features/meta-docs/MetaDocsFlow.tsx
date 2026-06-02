/**
 * features/meta-docs/MetaDocsFlow.tsx — 메타 문서 통합 Flow(ego-graph) SVG 컴포넌트 (P4-03)
 *
 * 원본: assets/js/meta-docs-flow.js 전량 + meta-docs-flow-camera.js + meta-docs-flow-highlight.js.
 *  - P3-01 Chart.tsx 선례 동형 — "thin React 껍데기 + useRef escape-hatch". 노드/엣지 SVG 빌드·줌/팬·
 *    드래그·하이라이트는 effect 내부에 *명령형 코드를 거의 그대로 이식*(arch §4.1-4.2).
 *    노드를 JSX foreignObject N개로 선언 매핑하지 않음 — resizeNodeToContent 의 동기 offsetWidth
 *    측정(flow.js:596)이 선언 렌더와 충돌(측정 시점 보장 불가).
 *  - 순수 추출 lib 호출: flow-camera(fit/이징/트윈), flow-graph(BFS), flow-edge(베지어), flow-layout(좌표).
 *  - activeRow 단방향 props 계약(arch §2.2): catalog 행 클릭/첫 행 → activeRow set → effect re-fetch.
 *    flow 가 catalog 를 역참조하지 않음(features 횡결합 금지). dblclick/sub-row 재중심은
 *    onRecenter(row) 통지 — 호출처(셸)가 activeRow 갱신(loadFlow re-fetch 와 동치).
 *  - 모듈 전역(_nodes/_edges/_seqView/_lastArgs) → useRef. React 리렌더 무관 가변 가시화 상태.
 *  - ★등록 순서 보존: bindSubRowClick → bindDrag → bindPan → bindZoom → bindHighlight →
 *    bindNodeDoubleClick → bindToolbar (flow.js:271-277). sub-row click 이 카드로 흡수되지 않게 정책.
 *
 * 명령형 영역(줌/팬/드래그/하이라이트/resize 측정)은 bun:test(DOM 미구현) 단위 불가 →
 *   수동 verify(arch §4.2: 리사이즈/줌/팬/드래그 후 깜빡임 0 + 하이라이트 정상 + sub-row 재중심 정상).
 *
 * @module features/meta-docs/MetaDocsFlow
 */
import { useEffect, useRef } from 'react';
import { escHtml } from '../../../assets/js/formatters.js';
import {
  computeFitView,
  animateToView,
  applyImmediate,
  viewBoxStr,
  type ViewState,
} from './flow-camera';
import {
  collectFullPathNodes,
  collectHoverPathNodes,
  collectEdgesBetween,
  type FlowEdge as GraphEdge,
} from './flow-graph';
import { computeEdgeD } from './flow-edge';
import {
  computePositions,
  contentBBox,
  LAYOUT,
  type PositionedNode,
  type FlowColumn,
  type RawFlowNode,
} from './flow-layout';

export type TFunc = (key: string, vars?: Record<string, unknown>) => string;
interface I18nWindow {
  I18n?: { t?: TFunc };
}
const defaultT: TFunc = (k, vars) =>
  (globalThis as unknown as I18nWindow).I18n?.t?.(k, vars) ??
  (typeof window !== 'undefined' ? (window as unknown as I18nWindow).I18n?.t?.(k, vars) : undefined) ??
  k;

const SVGNS = 'http://www.w3.org/2000/svg';
const HTMLNS = 'http://www.w3.org/1999/xhtml';
const CONTAINER_ID = 'metaDocsFlowRegion';

// 줌 정책 SSoT (flow.js:130-133).
const ZOOM_FACTOR_BUTTON = 0.8;
const ZOOM_WHEEL_SENSITIVITY = 0.0015;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const NODE_MAX_W = 260; // 자연폭 상한(flow.js:572).
const EDGE_END_OFFSET = 6;
const PAN_CLICK_SUPPRESS_THRESHOLD = 4;
const PAN_DRAG_SENSITIVITY = 2.0;
const DRAG_THRESHOLD = 4;

// 아이콘 + 칩 매핑 (flow.js:55-87).
const ICONS: Record<string, string> = {
  cmd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
  agent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="3"/><circle cx="8.5" cy="13.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="13.5" r="1.2" fill="currentColor"/><path d="M12 3v4"/><circle cx="12" cy="2.5" r="1.2" fill="currentColor"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>',
  plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21l3-3 7-7 3 3-7 7-3 0z"/><path d="M14 4l6 6"/></svg>',
};
const KIND_TO_ICON: Record<string, string> = { command: 'cmd', skill: 'book', agent: 'agent', mcp: 'plan', tool: 'cmd' };
const KIND_TO_TONE: Record<string, string> = { skill: 'skill', agent: 'agent', tool: 'neutral', mcp: 'mcp', command: 'skill' };
const KIND_TO_LABEL: Record<string, string> = { skill: 'SKILL', agent: 'AGENT', tool: 'TOOL', mcp: 'MCP', command: 'CMD' };

// 강조 클래스 SSoT (highlight.js:42-48).
const CLS_HOVERING = 'is-hovering';
const CLS_SELECTION = 'has-selection';
const CLS_HIGHLIGHT = 'is-highlighted';
const CLS_FLOWING = 'is-flowing';

/** 활성 flow 행(카탈로그가 통지하는 단방향 계약값). */
export interface FlowActiveRow {
  type: string | null | undefined;
  name: string;
  id?: number | null;
}

/** loadFlow 인자(원본 flow.js:146 args). */
export interface FlowArgs {
  centerKind: string;
  centerName: string;
  project: string | null;
  depth: number;
}

export interface MetaDocsFlowProps {
  /** 활성 행(catalog→flow 단방향). null = 빈 flow. effect 가 fetch+render. */
  activeRow: FlowActiveRow | null;
  /** 현재 프로젝트(fetch scope). flow fetch 의 project arg. */
  project?: string | null;
  /** 재중심 통지(dblclick/sub-row → 새 center). 호출처가 activeRow 갱신(loadFlow re-fetch 동치). */
  onRecenter?: (row: FlowActiveRow) => void;
  /** flow fetch depth(기본 3). */
  depth?: number;
  /** 날짜 범위(app-store.activeRange→rangeToParams). flow fetch 의 fromTs/toTs 로 전파.
   *   호출처(MetaDocsLayout)가 주입 — 미주입 시 전체 기간(레거시 window.__getDateRange 폐기 대체). */
  dateRange?: { from?: number; to?: number };
  t?: TFunc;
}

/**
 * 활성 행 → loadFlow args 변환(순수, catalog→flow 계약 SSoT). (flow.js fetch center_kind/name)
 * name/type 만 필요 — orphan(id null) 무시는 catalog 책임(arch §2.2).
 */
export function activeRowToFlowArgs(row: FlowActiveRow | null, project: string | null, depth = 3): FlowArgs | null {
  if (!row || !row.name || !row.type) return null;
  return { centerKind: String(row.type), centerName: String(row.name), project: project ?? null, depth };
}

// =============================================================================
// fetch — unified-flow (flow.js:289)
// =============================================================================

interface UnifiedFlowPayload {
  nodes: RawFlowNode[];
  edges: GraphEdge[];
  columns?: FlowColumn[];
  meta?: { centerName?: string };
}

async function fetchUnifiedFlow(args: FlowArgs, getDateRange: () => { from?: number; to?: number }): Promise<UnifiedFlowPayload> {
  const params = new URLSearchParams();
  params.set('center_kind', args.centerKind);
  params.set('center_name', args.centerName);
  if (typeof args.depth === 'number') params.set('depth', String(args.depth));
  const dr = getDateRange();
  if (dr.from !== undefined) params.set('fromTs', String(dr.from));
  if (dr.to !== undefined) params.set('toTs', String(dr.to));
  const res = await fetch('/api/graph/unified-flow?' + params.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json?.data ?? json;
}

// =============================================================================
// 명령형 SVG 빌드 — effect 내부에서 호출. Chart.tsx drawDonutToCanvas 동형(명령형 격리).
// =============================================================================

interface NodeRef {
  node: PositionedNode;
  foEl: SVGForeignObjectElement;
}
interface EdgeRef {
  edge: GraphEdge & { type: string };
  pathEl: SVGPathElement;
}

/** 명령형 렌더에 필요한 가변 상태 — 모듈 전역(flow.js:109-117) 대체 useRef 컨테이너. */
interface FlowState {
  nodes: PositionedNode[];
  edges: Array<GraphEdge & { type: string }>;
  layers: string[][];
  seqView: ViewState;
  seqViewInitial: ViewState;
  initialPositions: Array<{ id: string; x: number; y: number }>;
  nodeIndex: Map<string, NodeRef>;
  edgeIndex: Map<string, EdgeRef>;
}

function emptyState(): FlowState {
  return {
    nodes: [],
    edges: [],
    layers: [],
    seqView: { x: 0, y: 0, w: 1200, h: 600 },
    seqViewInitial: { x: 0, y: 0, w: 1200, h: 600 },
    initialPositions: [],
    nodeIndex: new Map(),
    edgeIndex: new Map(),
  };
}

function shellHtml(meta: { centerName?: string } | undefined, t: TFunc, view: ViewState): string {
  const centerLabel = meta?.centerName ? escHtml(meta.centerName) : '—';
  return `
    <div class="flow-toolbar flow-toolbar-sequential">
      <span class="flow-scope">${t('ui.meta-docs-view.flow.scope-center')}: <b>${centerLabel}</b></span>
      <div class="flow-spacer"></div>
      <span class="flow-zoom-group">
        <button class="flow-zoom-btn" data-flow-zoom="out" title="${t('ui.meta-docs-view.flow.zoom-out-title')}" aria-label="${t('ui.meta-docs-view.flow.zoom-out-title')}">−</button>
        <button class="flow-zoom-btn" data-flow-zoom="in"  title="${t('ui.meta-docs-view.flow.zoom-in-title')}"  aria-label="${t('ui.meta-docs-view.flow.zoom-in-title')}">＋</button>
      </span>
      <button class="flow-reset-btn" data-seq-reset>${t('ui.meta-docs-view.flow.reset-label')}</button>
    </div>
    <div class="flow-canvas flow-canvas-sequential">
      <svg class="flow-svg flow-svg-sequential"
           width="100%" height="100%"
           viewBox="${viewBoxStr(view)}"
           preserveAspectRatio="xMidYMid meet"
           xmlns="${SVGNS}">
        <defs>
          <marker id="flowArr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 Z" fill="context-stroke"/></marker>
        </defs>
        <g id="flowEdgesLayer"></g>
        <g id="flowNodesLayer"></g>
      </svg>
    </div>
  `;
}

function emptyHtml(centerName: string | null, t: TFunc): string {
  const title = !centerName
    ? t('ui.meta-docs-view.flow.empty-no-center')
    : t('ui.meta-docs-view.flow.empty-zero-turns', { name: escHtml(centerName) });
  return `<div class="flow-empty flow-empty-sequential"><span class="flow-empty-title">${title}</span><span>${t('ui.meta-docs-view.flow.empty-hint')}</span></div>`;
}
function skeletonHtml(): string {
  return `<div class="flow-empty"><span>…</span></div>`;
}
function errorHtml(err: unknown, t: TFunc): string {
  const msg = (err as { message?: string })?.message ? String((err as { message: string }).message) : String(err);
  return `<div class="flow-empty"><span class="flow-empty-title">${t('ui.meta-docs-view.flow.fetch-failed', { message: escHtml(msg) })}</span></div>`;
}

/** 노드 카드 foreignObject 생성 (flow.js:431). */
function makeNodeFO(node: PositionedNode): SVGForeignObjectElement {
  const fo = document.createElementNS(SVGNS, 'foreignObject');
  fo.setAttribute('x', String(node.x));
  fo.setAttribute('y', String(node.y));
  fo.setAttribute('width', String(node.w));
  fo.setAttribute('height', String(node.h));
  fo.dataset.nodeId = node.id;

  const card = document.createElementNS(HTMLNS, 'div') as unknown as HTMLDivElement;
  card.className = 'node node-seq';
  card.dataset.nodeId = node.id;
  card.dataset.kind = node.kind;
  if (typeof node.layerTone === 'number') card.style.setProperty('--card-tone-layer', String(node.layerTone));
  if (node.type === 'center') card.classList.add('is-center');
  else card.classList.add('is-spoke');
  if (node.depth === 1) card.classList.add('is-hot');
  else if (node.timeline === 'after') card.classList.add('is-after');
  if (node.type !== 'center') card.dataset.clickable = '1';

  const icon = document.createElementNS(HTMLNS, 'div') as unknown as HTMLDivElement;
  icon.className = 'icon';
  icon.innerHTML = ICONS[KIND_TO_ICON[node.kind] || 'cmd'] || '';
  card.appendChild(icon);

  const body = document.createElementNS(HTMLNS, 'div') as unknown as HTMLDivElement;
  body.className = 'body';
  const titleRow = document.createElementNS(HTMLNS, 'div') as unknown as HTMLDivElement;
  titleRow.className = 'title-row';
  const title = document.createElementNS(HTMLNS, 'div') as unknown as HTMLDivElement;
  title.className = 'title';
  title.textContent = node.title;
  titleRow.appendChild(title);

  if (node.type !== 'center') {
    const tone = KIND_TO_TONE[node.kind];
    const label = KIND_TO_LABEL[node.kind];
    if (tone && label) {
      const chip = document.createElementNS(HTMLNS, 'span') as unknown as HTMLSpanElement;
      chip.className = 'ds-chip';
      chip.dataset.tone = tone;
      chip.textContent = label;
      titleRow.appendChild(chip);
    }
  }
  body.appendChild(titleRow);

  const count = typeof node.count === 'number' ? node.count : null;
  const pct = typeof node.pct === 'number' ? node.pct : null;
  let subText = '';
  if (node.type === 'center' && count !== null) {
    const invocations = typeof node.invocations === 'number' ? node.invocations : null;
    const callsText = invocations !== null && invocations !== count ? ` · ${invocations} calls` : '';
    subText = `<b>${count}</b> turns${callsText}`;
  } else if (count !== null) {
    const pctText = pct !== null ? ` · ${Math.round(pct * 1000) / 10}%` : '';
    subText = `<b>${count}</b> turns${pctText}`;
  }
  if (subText) {
    const sub = document.createElementNS(HTMLNS, 'div') as unknown as HTMLDivElement;
    sub.className = 'sub';
    sub.innerHTML = subText;
    body.appendChild(sub);
  }

  if (Array.isArray(node.subRows) && node.subRows.length > 0) {
    const list = document.createElementNS(HTMLNS, 'div') as unknown as HTMLDivElement;
    list.className = 'sub-list';
    for (const r of node.subRows) {
      const row = document.createElementNS(HTMLNS, 'div') as unknown as HTMLDivElement;
      row.className = 'sub-row';
      row.dataset.toolName = r.fullName;
      row.innerHTML = `<span class="sub-row-name">${escHtml(r.toolName)}</span><span class="sub-row-stats"><b>${r.count}</b> · ${r.pct}%</span>`;
      list.appendChild(row);
    }
    body.appendChild(list);
  }
  card.appendChild(body);

  if (Array.isArray(node.pills) && node.pills.length > 0) {
    const pills = document.createElementNS(HTMLNS, 'span') as unknown as HTMLSpanElement;
    pills.className = 'meta-pills';
    for (const p of node.pills) {
      const el = document.createElementNS(HTMLNS, 'span') as unknown as HTMLSpanElement;
      if (p === 'hot') {
        el.className = 'pill-hot';
        el.textContent = 'HOT';
      } else {
        el.className = 'pill-live';
        el.textContent = String(p);
      }
      pills.appendChild(el);
    }
    card.appendChild(pills);
  }

  fo.appendChild(card as unknown as Node);
  return fo;
}

/** 자연폭 재측정 — 동기 offsetWidth 의존(flow.js:583). 명령형 유지 필수. */
function resizeNodeToContent(ref: NodeRef): void {
  const card = ref.foEl.querySelector('.node') as HTMLElement | null;
  if (!card) return;
  const prevW = card.style.width;
  const prevH = card.style.height;
  const prevMaxW = card.style.maxWidth;
  ref.foEl.setAttribute('width', '9999');
  ref.foEl.setAttribute('height', '9999');
  card.style.width = 'max-content';
  card.style.height = 'max-content';
  card.style.maxWidth = 'none';

  let w = Math.ceil(card.offsetWidth);
  let h = Math.ceil(card.offsetHeight);
  if (w > NODE_MAX_W) {
    w = NODE_MAX_W;
    card.classList.add('is-wrapped');
    card.style.width = NODE_MAX_W + 'px';
    card.style.maxWidth = NODE_MAX_W + 'px';
    h = Math.ceil(card.offsetHeight);
  } else {
    card.classList.remove('is-wrapped');
  }
  card.style.width = prevW;
  card.style.height = prevH;
  card.style.maxWidth = prevMaxW;
  ref.foEl.setAttribute('width', String(w));
  ref.foEl.setAttribute('height', String(h));
  ref.node.w = w;
  ref.node.h = h;
}

function makeEdgePath(edge: GraphEdge & { type: string }, nodes: PositionedNode[]): SVGPathElement {
  const path = document.createElementNS(SVGNS, 'path');
  path.dataset.edgeId = edge.id;
  path.classList.add('edge', `edge-${edge.type.toLowerCase()}`);
  path.setAttribute('fill', 'none');
  path.setAttribute('marker-end', 'url(#flowArr)');
  const from = nodes.find((n) => n.id === edge.source);
  const to = nodes.find((n) => n.id === edge.target);
  if (from && to) path.setAttribute('d', computeEdgeD(from, to));
  return path;
}

function refreshEdgePath(st: FlowState, edge: GraphEdge & { type: string }): void {
  const ref = st.edgeIndex.get(edge.id);
  if (!ref) return;
  const from = st.nodes.find((n) => n.id === edge.source);
  const to = st.nodes.find((n) => n.id === edge.target);
  if (!from || !to) return;
  ref.pathEl.setAttribute('d', computeEdgeD(from, to));
}

function svgPoint(svgEl: SVGSVGElement, evt: { clientX: number; clientY: number }): { x: number; y: number } {
  const pt = svgEl.createSVGPoint();
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  const ctm = svgEl.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const p = pt.matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

function applyVB(svgEl: SVGSVGElement, st: FlowState): void {
  svgEl.setAttribute('viewBox', viewBoxStr(st.seqView));
}

// =============================================================================
// 하이라이트 적용 — flow-graph 순수 BFS 결과를 DOM 클래스로 토글(arch §4.2 effect 명령형).
// =============================================================================

function clearHighlightClasses(svgEl: SVGSVGElement): void {
  for (const el of svgEl.querySelectorAll('.' + CLS_HIGHLIGHT)) el.classList.remove(CLS_HIGHLIGHT);
  for (const el of svgEl.querySelectorAll('.' + CLS_FLOWING)) el.classList.remove(CLS_FLOWING);
}
function clearAllHighlight(svgEl: SVGSVGElement): void {
  svgEl.classList.remove(CLS_SELECTION);
  svgEl.classList.remove(CLS_HOVERING);
  clearHighlightClasses(svgEl);
}
function applyFullPathSelection(svgEl: SVGSVGElement, edges: GraphEdge[], centerNodeId: string): void {
  const nodes = collectFullPathNodes(edges, centerNodeId);
  const hEdges = collectEdgesBetween(edges, nodes);
  svgEl.classList.remove(CLS_HOVERING);
  clearHighlightClasses(svgEl);
  svgEl.classList.add(CLS_SELECTION);
  for (const fo of svgEl.querySelectorAll<SVGElement>('foreignObject[data-node-id]')) {
    if (nodes.has((fo as unknown as HTMLElement).dataset.nodeId!)) fo.classList.add(CLS_HIGHLIGHT);
  }
  for (const path of svgEl.querySelectorAll<SVGElement>('[data-edge-id]')) {
    if (hEdges.has((path as unknown as HTMLElement).dataset.edgeId!)) {
      path.classList.add(CLS_HIGHLIGHT);
      path.classList.add(CLS_FLOWING);
    }
  }
}
function applyEdgeHoverHighlight(svgEl: SVGSVGElement, edges: GraphEdge[], edgeId: string): void {
  const edge = edges.find((e) => e.id === edgeId);
  if (!edge) return;
  const nodes = collectHoverPathNodes(edges, edge.source, edge.target);
  const hEdges = collectEdgesBetween(edges, nodes);
  svgEl.classList.add(CLS_HOVERING);
  for (const fo of svgEl.querySelectorAll<SVGElement>('foreignObject[data-node-id]')) {
    if (nodes.has((fo as unknown as HTMLElement).dataset.nodeId!)) fo.classList.add(CLS_HIGHLIGHT);
  }
  for (const path of svgEl.querySelectorAll<SVGElement>('[data-edge-id]')) {
    if (hEdges.has((path as unknown as HTMLElement).dataset.edgeId!)) path.classList.add(CLS_HIGHLIGHT);
  }
}

function findNodeFO(target: EventTarget | null): HTMLElement | null {
  let cur = target as Node | null;
  while (cur && cur !== document) {
    if (cur instanceof Element && cur.tagName.toLowerCase() === 'foreignobject' && (cur as unknown as HTMLElement).dataset.nodeId) {
      return cur as unknown as HTMLElement;
    }
    cur = cur.parentNode;
  }
  return null;
}
function findEdgeAncestor(target: EventTarget | null): HTMLElement | null {
  let cur = target as (Node & { dataset?: DOMStringMap }) | null;
  while (cur && cur !== (document as unknown as Node)) {
    if (cur.dataset && cur.dataset.edgeId) return cur as unknown as HTMLElement;
    cur = cur.parentNode as typeof cur;
  }
  return null;
}

/**
 * MetaDocsFlow — useRef SVG escape-hatch. activeRow 변경 → effect fetch+render+bind.
 * 명령형 전부 effect 내부(SSR 비발화). 컨테이너 div(metaDocsFlowRegion)만 JSX 선언.
 */
export function MetaDocsFlow({ activeRow, project = null, onRecenter, depth = 3, dateRange, t = defaultT }: MetaDocsFlowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<FlowState>(emptyState());
  // onRecenter 최신값 — effect 재구독 없이 콜백만 갱신(stale closure 방지).
  const recenterRef = useRef(onRecenter);
  recenterRef.current = onRecenter;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof document === 'undefined') return undefined;

    let cancelled = false;
    // window-scope 리스너 cleanup 목록(bindDrag/bindPan 이 window 에 등록).
    const winListeners: Array<[string, EventListener]> = [];
    const addWin = (type: string, fn: EventListener) => {
      window.addEventListener(type, fn);
      winListeners.push([type, fn]);
    };

    const args = activeRowToFlowArgs(activeRow, project, depth);
    if (!args) {
      container.innerHTML = emptyHtml(activeRow?.name ?? null, t);
      return undefined;
    }

    container.innerHTML = skeletonHtml();
    // 날짜 범위 — prop 주입(app-store.activeRange→rangeToParams). 폐기된 window.__getDateRange 전역을
    //   대체: 그 전역은 setter 가 어디에도 없어 항상 undefined→{}→flow 가 날짜 필터를 무시하던 버그.
    const getDateRange = () => dateRange ?? {};

    fetchUnifiedFlow(args, getDateRange)
      .then((payload) => {
        if (cancelled) return;
        if (!payload || !Array.isArray(payload.nodes) || payload.nodes.length === 0) {
          container.innerHTML = emptyHtml(args.centerName, t);
          return;
        }
        renderFlow(container, payload, args, t, stateRef.current, addWin, (row) => recenterRef.current?.(row));
      })
      .catch((err) => {
        if (!cancelled) container.innerHTML = errorHtml(err, t);
      });

    return () => {
      cancelled = true;
      for (const [type, fn] of winListeners) window.removeEventListener(type, fn);
    };
    // dateRange.from/to 는 원시값으로 deps 에 둔다 — 날짜 필터 적용 시 flow 재fetch(기간 반영).
    //   객체 자체가 아닌 원시값이라 호출처가 매 렌더 새 객체를 줘도 값이 같으면 재실행 안 함.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRow, project, depth, t, dateRange?.from, dateRange?.to]);

  return <div id={CONTAINER_ID} ref={containerRef} className="meta-docs-flow-region" />;
}

// =============================================================================
// renderFlow — loadFlow 의 본체(컨테이너 inject + bind). effect 가 호출.
// =============================================================================

function renderFlow(
  container: HTMLElement,
  payload: UnifiedFlowPayload,
  args: FlowArgs,
  t: TFunc,
  st: FlowState,
  addWin: (type: string, fn: EventListener) => void,
  recenter: (row: FlowActiveRow) => void,
): void {
  const columns = Array.isArray(payload.columns) ? payload.columns : [];
  st.layers = columns.map((col) => col.nodeIds);
  st.nodes = computePositions(payload.nodes, columns);
  st.edges = payload.edges.map((e) => ({ ...e, type: (e as GraphEdge & { type?: string }).type ?? 'call' }));

  const maxRowsInColumn = columns.reduce((mx, col) => Math.max(mx, col.nodeIds.length), 1);
  st.seqView = {
    x: 0,
    y: 0,
    w: LAYOUT.leftPad * 2 + columns.length * (LAYOUT.nodeW + LAYOUT.colGap),
    h: LAYOUT.topPad * 2 + maxRowsInColumn * LAYOUT.layerGapY,
  };

  container.innerHTML = shellHtml(payload.meta, t, st.seqView);
  const svgEl = container.querySelector('.flow-svg') as SVGSVGElement | null;
  if (!svgEl) return;
  const edgesLayer = svgEl.querySelector('#flowEdgesLayer') as SVGGElement;
  const nodesLayer = svgEl.querySelector('#flowNodesLayer') as SVGGElement;
  const canvasEl = container.querySelector('.flow-canvas') as HTMLElement | null;
  svgEl.setAttribute('viewBox', viewBoxStr(st.seqView));

  // 노드 렌더 + 인덱싱.
  st.nodeIndex = new Map();
  for (const n of st.nodes) {
    const fo = makeNodeFO(n);
    nodesLayer.appendChild(fo);
    st.nodeIndex.set(n.id, { node: n, foEl: fo });
  }

  // 자연폭 재측정 + 컬럼 x 재배치 (flow.js:208-238).
  let cursorX: number = LAYOUT.leftPad;
  let totalMaxBottom: number = LAYOUT.topPad;
  for (let ci = 0; ci < st.layers.length; ci++) {
    const ids = st.layers[ci];
    let colMaxW: number = LAYOUT.nodeW;
    let cursorY: number = LAYOUT.topPad;
    for (const id of ids) {
      const ref = st.nodeIndex.get(id);
      if (!ref) continue;
      resizeNodeToContent(ref);
      if (ref.node.w > colMaxW) colMaxW = ref.node.w;
    }
    for (const id of ids) {
      const ref = st.nodeIndex.get(id);
      if (!ref) continue;
      ref.node.x = cursorX;
      ref.node.y = cursorY;
      ref.foEl.setAttribute('x', String(cursorX));
      ref.foEl.setAttribute('y', String(cursorY));
      cursorY += ref.node.h + 12;
      if (cursorY > totalMaxBottom) totalMaxBottom = cursorY;
    }
    cursorX += colMaxW + LAYOUT.colGap;
  }
  st.seqView.w = Math.max(st.seqView.w, cursorX + LAYOUT.leftPad);
  st.seqView.h = Math.max(st.seqView.h, totalMaxBottom + LAYOUT.topPad);
  st.initialPositions = st.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }));

  // 화면맞춤.
  const fit = computeFitView(svgEl, contentBBox(st.nodes));
  if (fit) st.seqView = fit;
  st.seqViewInitial = { ...st.seqView };
  svgEl.setAttribute('viewBox', viewBoxStr(st.seqView));

  // 엣지 렌더 + 인덱싱 (resize 후).
  st.edgeIndex = new Map();
  for (const e of st.edges) {
    const pathEl = makeEdgePath(e, st.nodes);
    edgesLayer.appendChild(pathEl);
    st.edgeIndex.set(e.id, { edge: e, pathEl });
  }

  // ★인터랙션 바인딩 — 등록 순서가 정책 (flow.js:271-277).
  bindSubRowClick(svgEl, st, args, recenter);
  bindDrag(svgEl, nodesLayer, st, addWin);
  bindPan(svgEl, canvasEl, st, addWin);
  bindZoom(container, svgEl, st);
  bindHighlight(svgEl, st);
  bindNodeDoubleClick(svgEl, st, args, recenter);
  bindToolbarButtons(container, svgEl, st);
}

// --- bind* (effect 명령형, flow.js 1:1) ---------------------------------------

function bindSubRowClick(svgEl: SVGSVGElement, st: FlowState, args: FlowArgs, recenter: (row: FlowActiveRow) => void): void {
  let downX = 0;
  let downY = 0;
  let moved = false;
  svgEl.addEventListener('mousedown', (e) => {
    downX = e.clientX;
    downY = e.clientY;
    moved = false;
  });
  svgEl.addEventListener('mousemove', (e) => {
    if (!moved && (Math.abs(e.clientX - downX) > DRAG_THRESHOLD || Math.abs(e.clientY - downY) > DRAG_THRESHOLD)) moved = true;
  });
  svgEl.addEventListener('click', (e) => {
    if (moved) return;
    const row = (e.target as Element).closest?.('.sub-row') as HTMLElement | null;
    if (!row) return;
    const fullName = row.dataset.toolName;
    if (!fullName) return;
    e.stopImmediatePropagation();
    recenter({ type: 'mcp', name: fullName, id: null });
  });
}

function bindNodeDoubleClick(svgEl: SVGSVGElement, st: FlowState, args: FlowArgs, recenter: (row: FlowActiveRow) => void): void {
  svgEl.addEventListener('dblclick', (e) => {
    const target = e.target as Element;
    if (target.closest && target.closest('.sub-row')) return;
    const fo = findNodeFO(e.target);
    if (!fo) return;
    const nodeId = fo.dataset.nodeId;
    if (!nodeId) return;
    const ref = st.nodeIndex.get(nodeId);
    if (!ref) return;
    if (ref.node.type === 'center') return;
    clearAllHighlight(svgEl);
    recenter({ type: ref.node.kind, name: ref.node.title, id: null });
  });
}

function bindHighlight(svgEl: SVGSVGElement, st: FlowState): void {
  let selectedNodeId: string | null = null;
  let downX = 0;
  let downY = 0;
  let moved = false;
  svgEl.addEventListener('mousedown', (e) => {
    downX = e.clientX;
    downY = e.clientY;
    moved = false;
  }, true);
  svgEl.addEventListener('mousemove', (e) => {
    if (!moved && (Math.abs(e.clientX - downX) > DRAG_THRESHOLD || Math.abs(e.clientY - downY) > DRAG_THRESHOLD)) moved = true;
  }, true);
  svgEl.addEventListener('click', (e) => {
    if (moved) return;
    const fo = findNodeFO(e.target);
    if (fo) {
      const nodeId = fo.dataset.nodeId;
      if (!nodeId) return;
      if (selectedNodeId === nodeId) {
        selectedNodeId = null;
        clearAllHighlight(svgEl);
        return;
      }
      selectedNodeId = nodeId;
      applyFullPathSelection(svgEl, st.edges, nodeId);
      return;
    }
    if (selectedNodeId !== null) {
      selectedNodeId = null;
      clearAllHighlight(svgEl);
    }
  });
  const edgesLayer = svgEl.querySelector('#flowEdgesLayer');
  if (edgesLayer) {
    edgesLayer.addEventListener('mouseover', (e) => {
      if (selectedNodeId !== null) return;
      const edgeEl = findEdgeAncestor(e.target);
      if (!edgeEl) return;
      const edgeId = edgeEl.dataset.edgeId;
      if (!edgeId) return;
      applyEdgeHoverHighlight(svgEl, st.edges, edgeId);
    });
    edgesLayer.addEventListener('mouseout', (e) => {
      if (selectedNodeId !== null) return;
      const edgeEl = findEdgeAncestor(e.target);
      if (!edgeEl) return;
      svgEl.classList.remove(CLS_HOVERING);
      clearHighlightClasses(svgEl);
    });
  }
}

function bindDrag(svgEl: SVGSVGElement, nodesLayer: SVGGElement, st: FlowState, addWin: (type: string, fn: EventListener) => void): void {
  let armed: {
    id: string;
    downX: number;
    downY: number;
    offsetX: number;
    offsetY: number;
    card: HTMLElement;
    fo: SVGForeignObjectElement;
    dragging: boolean;
  } | null = null;

  svgEl.addEventListener('mousedown', (e) => {
    const card = (e.target as Element).closest && (e.target as Element).closest('.node');
    if (!card) return;
    const id = (card as HTMLElement).dataset.nodeId!;
    const ref = st.nodeIndex.get(id);
    if (!ref) return;
    const p = svgPoint(svgEl, e);
    armed = { id, downX: e.clientX, downY: e.clientY, offsetX: p.x - ref.node.x, offsetY: p.y - ref.node.y, card: card as HTMLElement, fo: ref.foEl, dragging: false };
  });
  const onMove = ((e: MouseEvent) => {
    if (!armed) return;
    if (!armed.dragging) {
      if (Math.abs(e.clientX - armed.downX) <= DRAG_THRESHOLD && Math.abs(e.clientY - armed.downY) <= DRAG_THRESHOLD) return;
      armed.dragging = true;
      armed.card.classList.add('is-dragging');
      nodesLayer.appendChild(armed.fo);
    }
    const p = svgPoint(svgEl, e);
    const ref = st.nodeIndex.get(armed.id);
    if (!ref) return;
    ref.node.x = p.x - armed.offsetX;
    ref.node.y = p.y - armed.offsetY;
    armed.fo.setAttribute('x', String(ref.node.x));
    armed.fo.setAttribute('y', String(ref.node.y));
    for (const e2 of st.edges) {
      if (e2.source === armed.id || e2.target === armed.id) refreshEdgePath(st, e2);
    }
  }) as EventListener;
  const onUp = (() => {
    if (!armed) return;
    if (armed.dragging) armed.card.classList.remove('is-dragging');
    armed = null;
  }) as EventListener;
  addWin('mousemove', onMove);
  addWin('mouseup', onUp);
}

function bindPan(svgEl: SVGSVGElement, canvasEl: HTMLElement | null, st: FlowState, addWin: (type: string, fn: EventListener) => void): void {
  if (!canvasEl) return;
  let active: { startX: number; startY: number; viewStartX: number; viewStartY: number; scale: number } | null = null;
  let lastMovedDist = 0;

  svgEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if ((e.target as Element).closest && (e.target as Element).closest('.node')) return;
    const rect = svgEl.getBoundingClientRect();
    if (rect.width === 0) return;
    active = { startX: e.clientX, startY: e.clientY, viewStartX: st.seqView.x, viewStartY: st.seqView.y, scale: st.seqView.w / rect.width };
    lastMovedDist = 0;
    canvasEl.classList.add('is-panning');
    e.preventDefault();
  });
  const onMove = ((e: MouseEvent) => {
    if (!active) return;
    const dx = e.clientX - active.startX;
    const dy = e.clientY - active.startY;
    lastMovedDist = Math.max(Math.abs(dx), Math.abs(dy));
    st.seqView.x = active.viewStartX - dx * active.scale * PAN_DRAG_SENSITIVITY;
    st.seqView.y = active.viewStartY - dy * active.scale * PAN_DRAG_SENSITIVITY;
    applyVB(svgEl, st);
  }) as EventListener;
  const onUp = (() => {
    if (!active) return;
    const movedFar = lastMovedDist > PAN_CLICK_SUPPRESS_THRESHOLD;
    canvasEl.classList.remove('is-panning');
    active = null;
    if (!movedFar) return;
    let suppressed = false;
    const suppress = (ev: Event) => {
      ev.stopImmediatePropagation();
      ev.preventDefault();
      svgEl.removeEventListener('click', suppress, true);
      suppressed = true;
    };
    svgEl.addEventListener('click', suppress, true);
    setTimeout(() => {
      if (!suppressed) svgEl.removeEventListener('click', suppress, true);
    }, 0);
  }) as EventListener;
  addWin('mousemove', onMove);
  addWin('mouseup', onUp);
}

function bindZoom(container: HTMLElement, svgEl: SVGSVGElement, st: FlowState): void {
  for (const btn of container.querySelectorAll<HTMLElement>('[data-flow-zoom]')) {
    btn.addEventListener('click', () => {
      const factor = btn.dataset.flowZoom === 'in' ? ZOOM_FACTOR_BUTTON : 1 / ZOOM_FACTOR_BUTTON;
      zoomBy(svgEl, st, factor, null);
    });
  }
  svgEl.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomBy(svgEl, st, Math.exp(e.deltaY * ZOOM_WHEEL_SENSITIVITY), svgPoint(svgEl, e));
    },
    { passive: false },
  );
}

function zoomBy(svgEl: SVGSVGElement, st: FlowState, factor: number, anchor: { x: number; y: number } | null): void {
  const newW = st.seqView.w * factor;
  const newH = st.seqView.h * factor;
  const ratio = newW / st.seqViewInitial.w;
  if (ratio < ZOOM_MIN || ratio > ZOOM_MAX) return;
  const ax = anchor !== null ? anchor.x : st.seqView.x + st.seqView.w / 2;
  const ay = anchor !== null ? anchor.y : st.seqView.y + st.seqView.h / 2;
  const relX = (ax - st.seqView.x) / st.seqView.w;
  const relY = (ay - st.seqView.y) / st.seqView.h;
  st.seqView.w = newW;
  st.seqView.h = newH;
  st.seqView.x = ax - relX * newW;
  st.seqView.y = ay - relY * newH;
  applyVB(svgEl, st);
}

function bindToolbarButtons(container: HTMLElement, svgEl: SVGSVGElement, st: FlowState): void {
  const resetBtn = container.querySelector('[data-seq-reset]');
  if (!resetBtn) return;
  resetBtn.addEventListener('click', () => {
    clearAllHighlight(svgEl);
    for (const p of st.initialPositions) {
      const ref = st.nodeIndex.get(p.id);
      if (!ref) continue;
      ref.node.x = p.x;
      ref.node.y = p.y;
      ref.foEl.setAttribute('x', String(p.x));
      ref.foEl.setAttribute('y', String(p.y));
    }
    for (const e of st.edges) refreshEdgePath(st, e);
    const fit = computeFitView(svgEl, contentBBox(st.nodes)) || { ...st.seqViewInitial };
    animateToView(svgEl, st.seqView, fit, { durationMs: 600 });
  });
}

// EDGE_END_OFFSET 재노출 회피용 — flow-edge SSoT 사용. (lint: 미사용 import 방지)
void applyImmediate;
void EDGE_END_OFFSET;
