/**
 * meta-docs-flow.js — 메타 문서 통합 Flow 단일 SoT 렌더러 (migration-plan §C)
 *
 * 책임:
 *   `/api/graph/unified-flow` 응답({nodes, edges, columns, meta})을 받아
 *   *column index = x 컬럼*, *컬럼 내 count DESC = y 슬롯*, *layerTone (0..4) = 시간 색조*
 *   로 매핑한 단일 시각화를 SVG 셸 안에 렌더한다.
 *
 *   레이아웃 (옵션 3, migration-plan §통합 시각화 디자인):
 *     [ancestor depth-N..-1] → [center 0] → [descendant 1..N] → [turn-after]
 *     좌→우 = 인과/의존 깊이, 위→아래 = 호출 빈도, 색조 = 시간 layer
 *
 *   기존 두 모드(ego + sequential) 정보를 한 시각화로 통합 — 토글 폐기.
 *   카드 표면 SSoT(아이콘, "N회 · M%", HOT pill, MCP subRows) 100% 보존.
 *
 * 의존성:
 *   - meta-docs-flow-camera.js (focusOnNodeBox — 노드 클릭 시 카메라 이동)
 *   - meta-docs-flow-highlight.js (bindHighlight — 엣지 hover 강조)
 *
 * 호출 흐름:
 *   meta-docs-view.js (카탈로그 행 클릭/날짜 필터 변경)
 *     → loadFlow({ centerKind, centerName, project })
 *         → fetchUnifiedFlow → /api/graph/unified-flow
 *         → renderFlow      → SVG 셸 + 노드/엣지 inject + 색조 CSS variable
 *         → bindNodeClick   → 클릭 시 새 center 로 재로드
 *         → bindHighlight   → 엣지 hover 강조
 *
 * 시각 어휘:
 *   - center: .is-center (Anthropic 주황 `--accent`).
 *   - depth +1 직접 호출: .is-hot — 그 외 무채색.
 *   - 점선 엣지 = AFTER (turn-after), 굵은 실선 = CALL.
 *   - 색조: CSS custom property `--card-tone-layer` (0..4) 5단계 그라데이션 (시간).
 */

import { escHtml } from './formatters.js';
// bindNodeClick 제거로 focusOnNodeBox 호출 지점도 사라짐 — import 제거.
//   재중심·카메라 이동 트리거 부활 시 본 import 복원.
import { bindHighlight, clearHighlight } from './meta-docs-flow-highlight.js';

// =============================================================================
// 상수 — 레이아웃 SSoT
// =============================================================================

const SVGNS = 'http://www.w3.org/2000/svg';
const HTMLNS = 'http://www.w3.org/1999/xhtml';

// ============================================================================
// 아이콘 + 칩 매핑 — ego 모드(meta-docs-flow-view.js) 와 동일 패턴.
//   ego 모드에서 ICONS / KIND_TO_TONE / KIND_TO_LABEL 가 module-scope 상수라 export 가
//   되지 않아 본 모듈에 *복제*. ego 측이 추가 아이콘을 도입할 때 본 객체도 함께 갱신.
//   향후 두 모듈이 합쳐질 경우 공용 utility 로 격상.
// ============================================================================
const ICONS = {
  cmd:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
  agent:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="3"/><circle cx="8.5" cy="13.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="13.5" r="1.2" fill="currentColor"/><path d="M12 3v4"/><circle cx="12" cy="2.5" r="1.2" fill="currentColor"/></svg>',
  book:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>',
  plan:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21l3-3 7-7 3 3-7 7-3 0z"/><path d="M14 4l6 6"/></svg>',
};
const KIND_TO_ICON = {
  command: 'cmd',
  skill:   'book',
  agent:   'agent',
  mcp:     'plan',
  tool:    'cmd',
};
const KIND_TO_TONE = {
  skill:   'skill',
  agent:   'agent',
  tool:    'task',
  mcp:     'mcp',
  command: 'command',
};
const KIND_TO_LABEL = {
  skill:   'SKILL',
  agent:   'AGENT',
  tool:    'TOOL',
  mcp:     'MCP',
  command: 'CMD',
};

const LAYOUT = {
  /** layer 간 수직 간격 (px). */
  layerGapY: 140,
  /** 노드 카드 폭/높이. */
  nodeW: 180,
  nodeH: 56,
  /** 같은 layer 안 노드 간 수평 간격. */
  colGap: 40,
  /** 좌측 여백. */
  leftPad: 80,
  /** 상단 여백. */
  topPad: 60,
};

const CONTAINER_ID = 'metaDocsFlowRegion';

// =============================================================================
// 모듈 상태 (sequential 모드 전용 — ego 모드 상태와 완전 격리)
// =============================================================================

let _nodes = [];
let _edges = [];
let _layers = []; // layer[i] = node id 배열.
let _seqView = { x: 0, y: 0, w: 1200, h: 600 };
let _seqViewInitial = { x: 0, y: 0, w: 1200, h: 600 }; // Reset 용 baseline.
let _initialPositions = []; // 노드 초기 x/y — Reset 시 위치 복원.
let _nodeIndex = new Map(); // id → { node, foEl } — bindDrag 가 z-index/위치 갱신에 사용.
let _edgeIndex = new Map(); // id → { edge, pathEl } — bindDrag 가 엣지 d 재계산.
let _lastArgs = null;

// 줌 정책.
//   - ZOOM_FACTOR_BUTTON: toolbar +/- 버튼 1클릭 당 변화량 (ego 모드와 동일).
//   - ZOOM_WHEEL_SENSITIVITY: 휠/트랙패드 deltaY 단위당 지수 계수.
//     macOS 트랙패드는 한 제스처에서 deltaY 가 매우 작은 값(1~10) 으로 수십 회 발생하므로
//     매 이벤트마다 ZOOM_FACTOR 를 곱하면 너무 민감해 사용자가 미세 조절 불가. 대신
//     `Math.exp(deltaY * SENSITIVITY)` 로 *크기 비례* 부드러운 변화:
//       deltaY=1     → factor ≈ 1.0015 (0.15% 변화)
//       deltaY=10    → factor ≈ 1.015  (1.5% 변화)
//       deltaY=100   → factor ≈ 1.16   (16% 변화, 일반 마우스 휠 1 tick 수준)
//       deltaY=-100  → factor ≈ 0.86   (14% 확대)
//     SENSITIVITY 값을 키우면 더 민감, 줄이면 더 둔감. 0.0015 가 Figma/Google Maps 와 유사.
const ZOOM_FACTOR_BUTTON = 0.8;
const ZOOM_WHEEL_SENSITIVITY = 0.0015;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

// =============================================================================
// 진입점 — view.js 의 토글 분기에서 호출
// =============================================================================

/**
 * @param {object} args
 * @param {'command'|'skill'|'agent'|'mcp'} args.centerKind
 * @param {string} args.centerName
 * @param {string|null} [args.project]
 * @param {number} [args.depth] 1..7, 기본 3
 */
export async function loadFlow(args) {
  const container = document.getElementById(CONTAINER_ID);
  if (!container) return;

  _lastArgs = { ...args };

  if (!args || !args.centerKind || !args.centerName) {
    container.innerHTML = emptyHtml({ centerName: null, mode: 'sequential' });
    return;
  }

  container.innerHTML = skeletonHtml();

  let payload = null;
  try {
    payload = await fetchUnifiedFlow(args);
  } catch (err) {
    container.innerHTML = errorHtml(err);
    return;
  }

  if (!payload || !Array.isArray(payload.nodes) || payload.nodes.length === 0) {
    container.innerHTML = emptyHtml({ centerName: args.centerName, mode: 'sequential' });
    return;
  }

  // columns 기반: column index = x 컬럼, 컬럼 내 count DESC = y 슬롯.
  // _layers 는 column.nodeIds 의 배열로 정의 (드래그 / Reset 등에서 같은 의미 유지).
  const columns = Array.isArray(payload.columns) ? payload.columns : [];
  _layers = columns.map((col) => col.nodeIds);
  _nodes = computePositions(payload.nodes, columns);
  _edges = payload.edges.map((e) => ({ ...e }));

  // viewBox — 컬럼 수 × 카드 폭(가로), 가장 노드 수 많은 컬럼 × 카드 높이(세로).
  const maxRowsInColumn = columns.reduce((mx, col) => Math.max(mx, col.nodeIds.length), 1);
  _seqView = {
    x: 0,
    y: 0,
    w: LAYOUT.leftPad * 2 + columns.length * (LAYOUT.nodeW + LAYOUT.colGap),
    h: LAYOUT.topPad * 2 + maxRowsInColumn * LAYOUT.layerGapY,
  };

  container.innerHTML = shellHtml(payload.meta);
  const svgEl = container.querySelector('.flow-svg');
  if (!svgEl) return;
  const edgesLayer = svgEl.querySelector('#flowEdgesLayer');
  const nodesLayer = svgEl.querySelector('#flowNodesLayer');
  const canvasEl = container.querySelector('.flow-canvas');
  svgEl.setAttribute('viewBox', viewBoxStr(_seqView));

  // 노드 렌더 + 인덱싱 (bindDrag 가 사용).
  _nodeIndex = new Map();
  for (const n of _nodes) {
    const fo = makeNodeFO(n);
    nodesLayer.appendChild(fo);
    _nodeIndex.set(n.id, { node: n, foEl: fo });
  }

  // ── 자연 폭 재측정 — 컬럼별 가장 wide 한 카드 폭으로 column x 좌표 재배치 ─────
  //   고정 LAYOUT.nodeW=180 으로는 긴 이름이 잘리거나 짧은 이름에 과한 여백.
  //   각 컬럼은 그 컬럼 내 가장 wide 한 카드 폭을 채택해 좌→우 누적 x 결정.
  //   세로(y) 는 컬럼 내 인덱스 × (nodeH + verticalGap) 으로 균일 배치.
  let cursorX = LAYOUT.leftPad;
  let totalMaxBottom = LAYOUT.topPad;
  for (let ci = 0; ci < _layers.length; ci++) {
    const ids = _layers[ci];
    // 1차: 컬럼 내 모든 카드의 자연 폭/높이 측정.
    let colMaxW = LAYOUT.nodeW;
    let cursorY = LAYOUT.topPad;
    for (const id of ids) {
      const ref = _nodeIndex.get(id);
      if (!ref) continue;
      resizeNodeToContent(ref);
      if (ref.node.w > colMaxW) colMaxW = ref.node.w;
    }
    // 2차: 컬럼 x = cursorX, 컬럼 내 노드 y 누적.
    for (const id of ids) {
      const ref = _nodeIndex.get(id);
      if (!ref) continue;
      ref.node.x = cursorX;
      ref.node.y = cursorY;
      ref.foEl.setAttribute('x', String(cursorX));
      ref.foEl.setAttribute('y', String(cursorY));
      cursorY += ref.node.h + 12; // 컬럼 내 카드 수직 간격 — 컴팩트하게.
      if (cursorY > totalMaxBottom) totalMaxBottom = cursorY;
    }
    cursorX += colMaxW + LAYOUT.colGap;
  }
  // viewBox 확장.
  const expandedW = Math.max(_seqView.w, cursorX + LAYOUT.leftPad);
  const expandedH = Math.max(_seqView.h, totalMaxBottom + LAYOUT.topPad);
  _seqView.w = expandedW;
  _seqView.h = expandedH;

  // viewBox baseline 보존 — Reset 시 복원용. resize 이후 시점에 캡쳐해야 정확.
  _seqViewInitial = { ..._seqView };
  _initialPositions = _nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }));
  svgEl.setAttribute('viewBox', viewBoxStr(_seqView));

  // 엣지 렌더 + 인덱싱 (bindDrag 의 refreshEdgesOf 가 사용). resize 후에 그려야
  // path 의 시작/끝 좌표가 최종 노드 위치에 맞춰진다.
  _edgeIndex = new Map();
  for (const e of _edges) {
    const pathEl = makeEdgePath(e);
    edgesLayer.appendChild(pathEl);
    _edgeIndex.set(e.id, { edge: e, pathEl });
  }

  // 인터랙션 바인딩 — 등록 순서가 정책의 일부.
  //   bindSubRowClick : sub-row click 이 카드 click 으로 흡수되지 않게 *먼저* 등록.
  //   bindDrag        : mousedown 으로 4px 이상 움직이면 드래그 승격 (단순 클릭에서는 DOM 변경 0).
  //   bindPan         : 빈 영역 드래그 → viewBox 이동. mouseup 직후 발생할 수 있는 click 이
  //                     selection clear 로 흡수되지 않도록 자체 capture-suppress (작업 4).
  //   bindZoom        : toolbar +/- 버튼 + 휠 zoom.
  //   bindHighlight   : 카드 single click → Full-Path BFS persistent selection.
  //   bindNodeDoubleClick : 카드 dblclick → 새 center 로 글로벌 재중심 (loadFlow re-fetch).
  //                     single click 채널과 충돌 없음 — dblclick 시 즉시 SVG 재렌더라
  //                     이전 selection 은 자연스럽게 폐기된다.
  //   bindToolbarButtons : Reset 등.
  bindSubRowClick(svgEl);
  bindDrag(svgEl, nodesLayer);
  bindPan(svgEl, canvasEl);
  bindZoom(container, svgEl);
  bindHighlight(svgEl, { getNodes: () => _nodes, getEdges: () => _edges });
  bindNodeDoubleClick(svgEl);
  bindToolbarButtons(container, svgEl);
}

/** view.js 의 토글 / date-range 핸들러가 같은 args 로 재호출. */
export function reloadLast() {
  if (_lastArgs) loadFlow(_lastArgs);
}

// =============================================================================
// fetch
// =============================================================================

async function fetchUnifiedFlow(args) {
  const params = new URLSearchParams();
  params.set('center_kind', args.centerKind);
  params.set('center_name', args.centerName);
  if (typeof args.depth === 'number') params.set('depth', String(args.depth));
  const url = '/api/graph/unified-flow?' + params.toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json?.data ?? json;
}

// =============================================================================
// 좌표 계산 — column 기반 좌→우, count DESC 슬롯 위→아래
// =============================================================================

/**
 * unified-flow 응답을 viewport 좌표가 부여된 _nodes 로 정규화.
 *
 *  - columns[i].nodeIds 의 인덱스 i = column 인덱스 = x 컬럼.
 *  - 컬럼 내 nodeIds 순서 = 서버가 count DESC 로 정렬해 보낸 순서를 신뢰. 위→아래 슬롯.
 *  - layerTone(0..4) 은 카드 색조 (`--card-tone-layer`) CSS variable 로 전달.
 */
function computePositions(rawNodes, columns) {
  const colOf = new Map();   // id → { colIdx, slotIdx }
  columns.forEach((col, colIdx) => {
    col.nodeIds.forEach((id, slotIdx) => colOf.set(id, { colIdx, slotIdx }));
  });

  return rawNodes
    // 컬럼 매핑에 들어가지 않은 노드는 그리지 않음 (예: turn-after 컬럼이 비었는데 raw 에는 남음).
    .filter((n) => colOf.has(n.id))
    .map((n) => {
      const co = colOf.get(n.id);
      return {
        id: n.id,
        kind: n.data?.kind ?? n.type ?? 'tool',
        type: n.type,
        title: n.data?.name ?? '?',
        depth: n.data?.depth ?? 0,
        column: co.colIdx,
        slot: co.slotIdx,
        layerTone: typeof n.data?.layerTone === 'number' ? n.data.layerTone : 0,
        tool_use_id: n.data?.tool_use_id,
        started_at: n.data?.started_at,
        // 카드 sub 영역의 "N turns · M%" — enrich 가 부착.
        count: n.data?.count,
        pct: n.data?.pct,
        invocations: n.data?.invocations,
        timeline: n.data?.timeline,
        // MCP 서버 그룹 카드의 sub-row 리스트.
        subRows: Array.isArray(n.data?.subRows) ? n.data.subRows.map((r) => ({ ...r })) : undefined,
        // 카드 우상단 보조 배지 — HOT 등.
        pills: Array.isArray(n.data?.pills) ? n.data.pills.slice() : undefined,
        // 초기 좌표 — 이후 resize 단계가 컬럼 폭 기반으로 재계산.
        x: LAYOUT.leftPad + co.colIdx * (LAYOUT.nodeW + LAYOUT.colGap),
        y: LAYOUT.topPad + co.slotIdx * LAYOUT.layerGapY,
        w: LAYOUT.nodeW,
        h: LAYOUT.nodeH,
        _expanded: true,
      };
    });
}

// =============================================================================
// HTML shell — toolbar 는 view.js 가 outer scope 에서 토글을 제어. 여기는 SVG 영역만.
// =============================================================================

function shellHtml(meta) {
  const t = window.I18n?.t?.bind(window.I18n) ?? ((k) => k);
  const centerLabel = meta?.centerName ? escHtml(meta.centerName) : '—';

  // toolbar 헤더는 *중심(center)* 만 노출 — 깊이/시작점/레이어 chip + CALL/AFTER 범례 모두
  // 시각 노이즈로 판단되어 제거(2026-05-26 사용자 피드백). 깊이/레이어 정보는 그래프 자체의
  // 위→아래 흐름으로 충분히 전달되고, 실선/점선 의미는 마우스 호버 강조로 자명.
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
           viewBox="${viewBoxStr(_seqView)}"
           preserveAspectRatio="xMidYMid meet"
           xmlns="${SVGNS}">
        <defs>
          <!-- 화살표 marker 단일화: SVG2 context-stroke 로 참조 path 의 stroke 색을 자동 상속. -->
          <marker id="flowArr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 Z" fill="context-stroke"/></marker>
        </defs>
        <g id="flowEdgesLayer"></g>
        <g id="flowNodesLayer"></g>
      </svg>
    </div>
  `;
}

function emptyHtml({ centerName, mode }) {
  const t = window.I18n?.t?.bind(window.I18n) ?? ((k) => k);
  const title = !centerName
    ? t('ui.meta-docs-view.flow.empty-no-center')
    : t('ui.meta-docs-view.flow.empty-zero-turns', { name: escHtml(centerName) });
  return `
    <div class="flow-empty flow-empty-${mode}">
      <span class="flow-empty-title">${title}</span>
      <span>${t('ui.meta-docs-view.flow.empty-hint')}</span>
    </div>
  `;
}

function skeletonHtml() {
  return `<div class="flow-empty"><span>…</span></div>`;
}

function errorHtml(err) {
  const t = window.I18n?.t?.bind(window.I18n) ?? ((k) => k);
  const msg = err?.message ? String(err.message) : String(err);
  return `<div class="flow-empty"><span class="flow-empty-title">${t('ui.meta-docs-view.flow.fetch-failed', { message: escHtml(msg) })}</span></div>`;
}

// =============================================================================
// 노드 / 엣지 렌더
// =============================================================================

/**
 * 노드 카드 렌더 — ego 모드(meta-docs-flow-view.js::makeNodeFO) 와 동일 구조:
 *   foreignObject > .node[.is-center|.is-spoke] > .icon (SVG) + .body > .title-row + .sub
 *
 * 클릭 가능성: center 외 모든 노드는 클릭 시 본 노드를 새 center 로 재로드 (bindNodeClick).
 * 호버 강조: highlight.js 가 .is-highlighted 자동 부여.
 */
function makeNodeFO(node) {
  const fo = document.createElementNS(SVGNS, 'foreignObject');
  fo.setAttribute('x', node.x);
  fo.setAttribute('y', node.y);
  fo.setAttribute('width', node.w);
  fo.setAttribute('height', node.h);
  fo.dataset.nodeId = node.id;

  const card = document.createElementNS(HTMLNS, 'div');
  card.className = 'node node-seq';
  card.dataset.nodeId = node.id;
  card.dataset.kind = node.kind;
  // 시간 layer 색조 — CSS variable 로 전달. 카드 룰이 --card-tone-layer-N 토큰에서 색조 선택.
  if (typeof node.layerTone === 'number') {
    card.style.setProperty('--card-tone-layer', String(node.layerTone));
  }
  // center: 강조 카드 / spoke: 일반 카드 (clickable). depth=1 직접 호출은 .is-hot 강조.
  if (node.type === 'center') card.classList.add('is-center');
  else card.classList.add('is-spoke');
  if (node.depth === 1) card.classList.add('is-hot');
  // is-after(점선)는 timeline='after' 명시 노드에만. 코호트 타임라인 모델에서 depth 음수는
  // center 직전(ancestor) 시퀀스를 뜻하므로 depth===-1 을 'after'로 오분류하지 않는다.
  else if (node.timeline === 'after') card.classList.add('is-after');
  // center 가 아닌 노드는 클릭 가능 — 데이터에 표시 + 커서 변경 (CSS 가 .is-spoke 처리).
  if (node.type !== 'center') card.dataset.clickable = '1';

  // ── 아이콘 ────────────────────────────────────────────────────────────
  const icon = document.createElementNS(HTMLNS, 'div');
  icon.className = 'icon';
  const iconKey = KIND_TO_ICON[node.kind] || 'cmd';
  icon.innerHTML = ICONS[iconKey] || '';
  card.appendChild(icon);

  // ── 본문 (title-row + sub) ──────────────────────────────────────────
  const body = document.createElementNS(HTMLNS, 'div');
  body.className = 'body';

  const titleRow = document.createElementNS(HTMLNS, 'div');
  titleRow.className = 'title-row';

  const title = document.createElementNS(HTMLNS, 'div');
  title.className = 'title';
  title.textContent = node.title;
  titleRow.appendChild(title);

  // chip — center 가 아닐 때만 (ego.js 의 spoke 룰과 동일).
  if (node.type !== 'center') {
    const tone = KIND_TO_TONE[node.kind];
    const label = KIND_TO_LABEL[node.kind];
    if (tone && label) {
      const chip = document.createElementNS(HTMLNS, 'span');
      chip.className = 'ds-chip';
      chip.dataset.tone = tone;
      chip.textContent = label;
      titleRow.appendChild(chip);
    }
  }
  body.appendChild(titleRow);

  // sub — "N turns · M%" 만. ego 모드 sub 형식과 동일 단위(distinct turn count).
  //   백엔드 어댑터가 data.count / data.pct 를 전달 (ego.callTree.nodes 의 동일 필드).
  //   center 카드는 invocations 도 별도 노출 (총 호출 수 — turns 와 다를 수 있음).
  //
  //   L0/L-1/L-2 같은 layer 라벨은 카드 sub 에서 제거 (2026-05-26 사용자 피드백) —
  //   그래프 방향성(위→아래) 만으로 깊이가 충분히 전달되고, 라벨이 오히려 시각 노이즈.
  //   카드 sub 가 비어버리는 케이스(count 미지정)에는 sub 자체를 생략.
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
    const sub = document.createElementNS(HTMLNS, 'div');
    sub.className = 'sub';
    sub.innerHTML = subText;
    body.appendChild(sub);
  }

  // ── sub-list (MCP 서버 그룹 카드의 도구별 row) ─────────────────────────
  //   같은 server 의 도구 N 개를 카드 1개로 묶은 group 카드. 각 row 는 클릭 가능 —
  //   data-tool-name 에 풀네임을 보관해 bindSubRowClick 이 새 center 로 재로드.
  //   ego 모드(`meta-docs-flow-view.js`)의 `.sub-list/.sub-row` 마크업 SSoT 와 동일.
  if (Array.isArray(node.subRows) && node.subRows.length > 0) {
    const list = document.createElementNS(HTMLNS, 'div');
    list.className = 'sub-list';
    for (const r of node.subRows) {
      const row = document.createElementNS(HTMLNS, 'div');
      row.className = 'sub-row';
      row.dataset.toolName = r.fullName;
      row.innerHTML = `
        <span class="sub-row-name">${escHtml(r.toolName)}</span>
        <span class="sub-row-stats"><b>${r.count}</b> · ${r.pct}%</span>
      `;
      list.appendChild(row);
    }
    body.appendChild(list);
  }

  card.appendChild(body);

  // ── meta-pills (HOT / LIVE 배지) ───────────────────────────────────────
  //   center 카드 우상단의 시각 강조. centerTurns/totalTurns ≥ 0.4 이면 'hot'.
  //   현재는 'hot' 만 정의 — ego 모드의 `.meta-pills/.pill-hot/.pill-live` 동일 마크업.
  if (Array.isArray(node.pills) && node.pills.length > 0) {
    const pills = document.createElementNS(HTMLNS, 'span');
    pills.className = 'meta-pills';
    for (const p of node.pills) {
      const el = document.createElementNS(HTMLNS, 'span');
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

  fo.appendChild(card);
  return fo;
}

// =============================================================================
// resizeNodeToContent — 자연 폭 측정 + NODE_MAX_W 래핑 (ego 와 동일 정책)
// =============================================================================

/**
 * NODE_MAX_W: 자연 폭이 과도하게 큰 경우(예: `mcp__redmine_xxx_yyy`) 다음 layer 노드와
 * 시각적 충돌 방지를 위한 상한. 상한 초과 시 카드 폭을 NODE_MAX_W 로 고정하고 .is-wrapped
 * 클래스로 .title 의 `white-space:nowrap` 을 풀어 두 줄 wrap.
 *
 * ego 모드(`meta-docs-flow-view.js:619`) 와 동일 값 — 카드 폭 일관성.
 */
const NODE_MAX_W = 260;

/**
 * foreignObject 의 width/height 를 카드 실제 콘텐츠 크기에 맞게 조정.
 *
 * 측정 트릭: foreignObject 의 고정 width 가 자식 .node 의 자연 폭을 제한하므로 측정 중
 * 일시적으로 9999 로 확장 + .node 에 `max-content` 강제 적용 → offsetWidth 측정 → 원복 →
 * 측정값으로 setAttribute. 이 과정을 거치지 않으면 항상 LAYOUT.nodeW(180) 만 측정된다.
 *
 * ego 모드(`meta-docs-flow-view.js:621-659`) 포팅 — 측정 로직은 표시 차이 없도록 동일.
 */
function resizeNodeToContent(ref) {
  const card = ref.foEl.querySelector('.node');
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

function makeEdgePath(edge) {
  const path = document.createElementNS(SVGNS, 'path');
  path.dataset.edgeId = edge.id;
  path.classList.add('edge', `edge-${edge.type.toLowerCase()}`);
  // 사용자 명세 (2026-05-26): 기본 상태에서 *모든* 엣지(실선/점선)는 무채색.
  //   강조(hover/click) 시 .is-highlighted 클래스가 CSS 로 stroke=var(--accent) 적용 →
  //   marker 의 fill="context-stroke" 가 자동 상속해 화살표 머리도 함께 주황으로 전환.
  //   기존엔 CALL 실선이 항상 주황이라 흐름도가 시각적으로 과도하게 강한 시그널을 던졌다.
  //   stroke / stroke-width / stroke-dasharray 는 CSS 의 .edge-call / .edge-after 룰
  //   에 위임 — 본 함수에선 fill='none' + marker-end 만 명시.
  path.setAttribute('fill', 'none');
  path.setAttribute('marker-end', 'url(#flowArr)');

  const from = _nodes.find((n) => n.id === edge.source);
  const to = _nodes.find((n) => n.id === edge.target);
  if (from && to) {
    path.setAttribute('d', computeEdgeD(from, to));
  }
  return path;
}

// =============================================================================
// 엣지 path 좌표 — 4면 앵커 + 외곽 offset (화살표 가림 방지)
// =============================================================================

/**
 * 화살표 머리가 노드 박스 안쪽에 그려져 카드 배경에 가려지지 않도록 path 끝점을
 * 노드 경계 *밖* 으로 offset. SVG marker 의 markerWidth(7) + stroke 두께를 고려해
 * 시각적으로 카드 외곽에 정확히 닿도록 6px 정도 외부에 끝점을 둔다.
 *
 *   - 너무 크면 카드와 화살표 사이 갭이 생겨 분리감,
 *   - 너무 작으면 marker 가 카드에 가려짐.
 *
 * 6px 은 markerWidth=7 / refX=9 / strokeWidth 1.8 조합에서 carbon-tested 한 값.
 */
const EDGE_END_OFFSET = 6;

/**
 * 두 카드 사이를 잇는 3차 베지어 path 의 d 속성을 만든다.
 *
 * 1) `chooseAnchors` 로 from/to 의 4면(top/right/bottom/left) 중 자연 앵커 선택.
 *    - 두 카드 중심을 잇는 벡터의 |dy| 가 |dx| 의 0.8 배보다 크면 vertical (top/bottom).
 *    - 그 외엔 horizontal (left/right). 이전 구현은 항상 bottom→top 고정이라
 *      backend-agent → redmin 같이 카드가 거의 수직 정렬이지만 redmin 폭이 좁아
 *      베지어 control point 가 redmin 카드 내부로 깊이 들어와 marker 가 가려졌다.
 *
 * 2) path 끝점(p2)을 to 카드의 경계에서 `EDGE_END_OFFSET` 만큼 *밖* 으로 옮긴다.
 *    SVG marker 는 path 끝점에 그려지므로, 끝점이 노드 박스 안이면 marker 가 카드에
 *    가려진다. 외곽 offset 으로 화살표 머리가 카드 boundary 직전에 정확히 닿는다.
 *
 * 3) 베지어 control point 는 앵커 면 방향(수평/수직)을 기준으로 노드 간 거리 절반
 *    (최소 40px) 만큼 그 방향으로 뻗어 자연스러운 S-curve 를 형성. ego 모드의
 *    `bezierFor` 와 동일 정책 — 시각 어휘 통일.
 */
function computeEdgeD(from, to) {
  const [sa, sb] = chooseAnchors(from, to);
  const p1 = anchorPoint(from, sa);
  const p2Raw = anchorPoint(to, sb);
  const p2 = offsetOutward(p2Raw, sb, EDGE_END_OFFSET);

  let c1, c2;
  if (sa === 'right' || sa === 'left') {
    const dx = Math.max(40, Math.abs(p2.x - p1.x) * 0.5);
    c1 = { x: p1.x + (sa === 'right' ? dx : -dx), y: p1.y };
    c2 = { x: p2.x + (sb === 'left' ? -dx : dx), y: p2.y };
  } else {
    const dy = Math.max(40, Math.abs(p2.y - p1.y) * 0.5);
    c1 = { x: p1.x, y: p1.y + (sa === 'bottom' ? dy : -dy) };
    c2 = { x: p2.x, y: p2.y + (sb === 'top' ? -dy : dy) };
  }

  return `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`;
}

/** 노드 박스의 4면 중심 좌표. */
function anchorPoint(node, side) {
  switch (side) {
    case 'left':   return { x: node.x,                y: node.y + node.h / 2 };
    case 'right':  return { x: node.x + node.w,       y: node.y + node.h / 2 };
    case 'top':    return { x: node.x + node.w / 2,   y: node.y };
    case 'bottom': return { x: node.x + node.w / 2,   y: node.y + node.h };
    default:       return { x: node.x + node.w / 2,   y: node.y + node.h / 2 };
  }
}

/** 앵커 점을 노드 경계의 *바깥* 방향으로 offset 만큼 이동. marker 가림 방지. */
function offsetOutward(p, side, off) {
  switch (side) {
    case 'left':   return { x: p.x - off, y: p.y };
    case 'right':  return { x: p.x + off, y: p.y };
    case 'top':    return { x: p.x,        y: p.y - off };
    case 'bottom': return { x: p.x,        y: p.y + off };
    default:       return p;
  }
}

/**
 * from/to 의 상대 위치에 따라 가장 자연스러운 앵커 면 쌍 [from-side, to-side] 선택.
 *
 *   - |dy| > |dx| * 0.8 : vertical 흐름 (위→아래 or 아래→위)
 *   - 그 외             : horizontal 흐름 (좌→우 or 우→좌)
 *
 * 이 룰이 핵심 — 거의 수직 정렬에서 ['bottom','top'] 을 선택해 path 가 to 카드의
 * top 중앙(=상단 경계)에 도달하게 한다. 좁은 카드라도 control point 가 카드 내부로
 * 깊이 들어가지 않아 marker 가 카드에 가려지지 않는다.
 */
function chooseAnchors(from, to) {
  const dx = (to.x + to.w / 2) - (from.x + from.w / 2);
  const dy = (to.y + to.h / 2) - (from.y + from.h / 2);
  if (Math.abs(dy) > Math.abs(dx) * 0.8) {
    return dy > 0 ? ['bottom', 'top'] : ['top', 'bottom'];
  }
  return dx > 0 ? ['right', 'left'] : ['left', 'right'];
}

// =============================================================================
// 인터랙션 — expand/collapse + 카메라
// =============================================================================

/**
 * MCP 그룹 카드의 sub-row 클릭 → 해당 도구 풀네임을 새 center 로 재로드.
 *
 * 흐름:
 *   1) `.sub-row[data-tool-name]` 가 클릭 대상이면 풀네임 추출
 *   2) `loadFlow({centerKind:'mcp', centerName: 풀네임})` 재호출
 *
 * 드래그 충돌 회피: bindDrag 가 mousedown 을 먼저 잡으므로 4px 드래그 임계값을 적용해
 * 클릭만 받는다. ego 모드(`meta-docs-flow-view.js::bindSubRowClick`) 와 동일 정책.
 *
 * 등록 순서 중요: bindNodeClick 보다 먼저 등록되어 sub-row 클릭이 카드 재중심 으로
 * 흡수되지 않게 한다 — sub-row 영역도 .node 카드의 자식이라 click 이 둘 다 매치된다.
 */
function bindSubRowClick(svgEl) {
  let downX = 0, downY = 0, moved = false;
  const DRAG_THRESHOLD = 4;

  svgEl.addEventListener('mousedown', (e) => {
    downX = e.clientX; downY = e.clientY; moved = false;
  });
  svgEl.addEventListener('mousemove', (e) => {
    if (!moved) {
      const dx = Math.abs(e.clientX - downX);
      const dy = Math.abs(e.clientY - downY);
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) moved = true;
    }
  });
  svgEl.addEventListener('click', (e) => {
    if (moved) return;
    const row = e.target.closest?.('.sub-row');
    if (!row) return;
    const fullName = row.dataset.toolName;
    if (!fullName) return;
    // 같은 svgEl 에 등록된 bindNodeClick 의 click 리스너로 이벤트가 더 흘러가지 않도록 차단.
    //   `stopPropagation` 만으로는 같은 target 의 다른 리스너가 차단되지 않으므로
    //   `stopImmediatePropagation` 사용 — sub-row 클릭은 *도구* 중심으로만 해석.
    e.stopImmediatePropagation();
    loadFlow({
      centerKind: 'mcp',
      centerName: fullName,
      project: _lastArgs?.project ?? null,
      depth: _lastArgs?.depth ?? 3,
    });
  });
}

/**
 * 카드 dblclick → 글로벌 재중심 (loadFlow re-fetch).
 *
 *   single click 채널 (bindHighlight) 과 분리:
 *     - single click : 현재 화면 *안* 의 BFS path highlight (persistent).
 *     - double click : 화면 *바깥* (응답에 포함되지 않은 호출 트리) 까지 끌어오기 위한
 *                      서버 재 fetch — center 를 dblclick 한 카드로 교체.
 *
 *   center 카드 dblclick 은 의미 없음 (자기 자신이 center) — early return.
 *
 *   single click 과의 충돌:
 *     브라우저는 dblclick 직전에 click 두 번 발생 → 1st click 으로 selection 설정,
 *     2nd click 으로 toggle off 또는 새 selection. 그 후 dblclick 으로 SVG 재렌더 →
 *     이전 DOM 자체가 폐기되므로 selection 잔여 클래스는 자연스럽게 사라진다.
 *
 *   sub-row dblclick 은 무시 — 카탈로그 도구 단위 재중심은 single click 으로 이미 동작.
 */
function bindNodeDoubleClick(svgEl) {
  svgEl.addEventListener('dblclick', (e) => {
    // sub-row 우선 — single click 으로 이미 처리됨, dblclick 에서는 카드 dblclick 채널과 분리.
    if (e.target.closest && e.target.closest('.sub-row')) return;
    const fo = findForeignObjectAncestor(e.target);
    if (!fo) return;
    const nodeId = fo.dataset.nodeId;
    if (!nodeId) return;
    const ref = _nodeIndex.get(nodeId);
    if (!ref) return;
    // center 자기 자신은 무시.
    if (ref.node.type === 'center') return;
    // BFS selection 클래스를 미리 정리 (loadFlow 가 SVG 를 통째로 교체하지만 짧은 깜빡임 방지).
    clearHighlight(svgEl);
    loadFlow({
      centerKind: ref.node.kind,
      centerName: ref.node.title,
      project: _lastArgs?.project ?? null,
      depth: _lastArgs?.depth ?? 30,
    });
  });
}

/** target 으로부터 거슬러 올라가 foreignObject[data-node-id] 반환. dblclick 용 SSoT. */
function findForeignObjectAncestor(target) {
  let cur = target;
  while (cur && cur !== document) {
    if (cur instanceof Element
        && cur.tagName.toLowerCase() === 'foreignobject'
        && cur.dataset.nodeId) {
      return cur;
    }
    cur = cur.parentNode;
  }
  return null;
}

function bindToolbarButtons(container, svgEl) {
  const resetBtn = container.querySelector('[data-seq-reset]');
  if (!resetBtn) return;
  resetBtn.addEventListener('click', () => {
    clearHighlight(svgEl);
    // 노드 위치 복원 — _initialPositions 의 (id, x, y) 그대로.
    for (const p of _initialPositions) {
      const ref = _nodeIndex.get(p.id);
      if (!ref) continue;
      ref.node.x = p.x;
      ref.node.y = p.y;
      ref.foEl.setAttribute('x', String(p.x));
      ref.foEl.setAttribute('y', String(p.y));
    }
    // 엣지 베지어 재계산.
    for (const e of _edges) refreshEdgePath(e);
    // viewBox 초기 baseline 으로 복원.
    _seqView = { ..._seqViewInitial };
    applyViewBox(svgEl);
  });
}

// ============================================================================
// 인터랙션 — bindDrag / bindPan / bindZoom (ego 모드와 동일 패턴)
// ============================================================================

/**
 * 노드 드래그 재배치 — 노드를 자유롭게 이동, 연결된 엣지 베지어 path 즉시 재계산.
 *
 * 흐름:
 *   mousedown on .node → arming(좌표·offset 기록만, DOM 변경 없음)
 *   window mousemove   → 4px 임계 초과 시 *실제 드래그* 진입(.is-dragging + z-index reappend),
 *                        이후 mousemove 마다 새 x/y 계산 + foreignObject 갱신 + refreshEdgesOf
 *   window mouseup     → cleanup
 *
 * z-index: 드래그 중인 노드를 nodesLayer 의 마지막에 reappend 해서 최상위로 — *드래그 진입
 *   시점*에만 호출. mousedown 즉시 호출하면 노드의 ancestor chain 이 분리/재부착되어
 *   브라우저가 mousedown 과 mouseup 의 공통 ancestor 를 찾지 못해 click 이벤트가 발생하지
 *   않는다 (highlight 채널 죽음). 따라서 단순 클릭에서는 DOM 변경 없음 — click 정상 발생.
 */
function bindDrag(svgEl, nodesLayer) {
  /** armed: mousedown 으로 진입 후보, dragging 미확정. moved=true 로 승격 시 실제 드래그. */
  let armed = null; // { id, downX, downY, offsetX, offsetY, card, fo, dragging }
  const DRAG_THRESHOLD = 4;

  function onDown(e) {
    const card = e.target.closest && e.target.closest('.node');
    if (!card) return;
    const id = card.dataset.nodeId;
    const ref = _nodeIndex.get(id);
    if (!ref) return;
    const p = svgPoint(svgEl, e);
    armed = {
      id,
      downX: e.clientX,
      downY: e.clientY,
      offsetX: p.x - ref.node.x,
      offsetY: p.y - ref.node.y,
      card,
      fo: ref.foEl,
      dragging: false,
    };
    // 주의: nodesLayer.appendChild / classList.add('is-dragging') / preventDefault 는
    //   드래그 진입 시점 (onMove 첫 4px 초과) 에만 호출. mousedown 즉시 DOM 변경하면
    //   click 이벤트가 발생하지 않아 click highlight 채널이 죽는다.
  }
  function onMove(e) {
    if (!armed) return;
    if (!armed.dragging) {
      const dx = Math.abs(e.clientX - armed.downX);
      const dy = Math.abs(e.clientY - armed.downY);
      if (dx <= DRAG_THRESHOLD && dy <= DRAG_THRESHOLD) return; // 아직 임계 미만 — 클릭일 수 있음.
      // 드래그 승격 — 여기서만 DOM 변경.
      armed.dragging = true;
      armed.card.classList.add('is-dragging');
      nodesLayer.appendChild(armed.fo); // z-index 효과.
    }
    const p = svgPoint(svgEl, e);
    const ref = _nodeIndex.get(armed.id);
    if (!ref) return;
    ref.node.x = p.x - armed.offsetX;
    ref.node.y = p.y - armed.offsetY;
    armed.fo.setAttribute('x', String(ref.node.x));
    armed.fo.setAttribute('y', String(ref.node.y));
    // 연결된 엣지 재계산.
    for (const e of _edges) {
      if (e.source === armed.id || e.target === armed.id) refreshEdgePath(e);
    }
  }
  function onUp() {
    if (!armed) return;
    if (armed.dragging) armed.card.classList.remove('is-dragging');
    armed = null;
  }

  svgEl.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

/**
 * 캔버스 빈 영역 드래그 → viewBox 이동(pan).
 * 노드 카드 위에서는 bindDrag 에 양보. 좌클릭만.
 *
 * Pan ↔ Click 충돌 방어 (작업 4, 사용자 명세):
 *   사용자가 카드 single click 으로 BFS path highlight 를 띄워 둔 상태에서
 *   빈 영역을 드래그(pan) 하면, mouseup 직후 브라우저는 mousedown 의 target 과 동일한
 *   target 으로 click 이벤트를 발생시킨다. 그 click 이 bindHighlight 의 *배경 클릭*
 *   분기에 흡수되어 `selectedNodeId = null + clearAll()` 가 실행되면 사용자가 의도하지
 *   않은 selection clear 가 발생한다.
 *
 *   bindHighlight 자체에도 4px 임계 가드가 있으므로 현재는 보호되지만, 책임 일관성을
 *   위해 *pan 의 책임* 으로 mouseup 직후 click 을 1회 명시적으로 차단한다 (capture-phase
 *   stopImmediatePropagation). 향후 추가될 click 리스너에도 동일 정책이 자동 적용.
 */
const PAN_CLICK_SUPPRESS_THRESHOLD = 4;
/**
 * 드래그 팬 민감도 배율.
 *
 *   기본 1.0 은 "마우스 1px 이동 = 시점 1px 이동"의 정확한 1:1 매칭 (Figma/Google Maps 표준).
 *   본 캔버스는 SVG viewBox 가 화면보다 큰 영역(상위/하위 ancestor 컬럼)을 포함해 1:1 매칭이
 *   "너무 느리게" 느껴진다는 사용자 피드백을 반영해 2.0 으로 상향.
 *   값을 키울수록 마우스보다 시점이 앞서가는 가속 감 — 1.5~2.5 권장 범위.
 */
const PAN_DRAG_SENSITIVITY = 2.0;
function bindPan(svgEl, canvasEl) {
  if (!canvasEl) return;
  let active = null;
  /** mouseup 시 누적 이동 거리. onMove 에서 갱신. */
  let lastMovedDist = 0;

  function onDown(e) {
    if (e.button !== 0) return;
    if (e.target.closest && e.target.closest('.node')) return; // 노드 위는 노드 드래그.
    const rect = svgEl.getBoundingClientRect();
    if (rect.width === 0) return;
    const scale = _seqView.w / rect.width;
    active = {
      startX: e.clientX,
      startY: e.clientY,
      viewStartX: _seqView.x,
      viewStartY: _seqView.y,
      scale,
    };
    lastMovedDist = 0;
    canvasEl.classList.add('is-panning');
    e.preventDefault();
  }
  function onMove(e) {
    if (!active) return;
    const dx = e.clientX - active.startX;
    const dy = e.clientY - active.startY;
    lastMovedDist = Math.max(Math.abs(dx), Math.abs(dy));
    _seqView.x = active.viewStartX - dx * active.scale * PAN_DRAG_SENSITIVITY;
    _seqView.y = active.viewStartY - dy * active.scale * PAN_DRAG_SENSITIVITY;
    applyViewBox(svgEl);
  }
  function onUp() {
    if (!active) return;
    const movedFar = lastMovedDist > PAN_CLICK_SUPPRESS_THRESHOLD;
    canvasEl.classList.remove('is-panning');
    active = null;
    if (!movedFar) return;
    // 다음 click 을 1회 차단 — capture-phase 에서 stopImmediatePropagation 후 자기 자신 제거.
    //   click 이벤트는 mouseup 직후 같은 tick 에 발생. once:true 보조로 누락된 click
    //   상황에서도 핸들러가 영구 누적되지 않도록 처리.
    let suppressed = false;
    const suppress = (ev) => {
      ev.stopImmediatePropagation();
      ev.preventDefault();
      svgEl.removeEventListener('click', suppress, true);
      suppressed = true;
    };
    svgEl.addEventListener('click', suppress, true);
    // 안전망 — 어떤 이유로든 click 이 발생하지 않은 경우 (focus 손실 등) 핸들러 leak 방지.
    setTimeout(() => {
      if (!suppressed) svgEl.removeEventListener('click', suppress, true);
    }, 0);
  }

  svgEl.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

/**
 * 툴바 +/- 버튼 + 마우스 휠 → viewBox 크기 변경(zoom).
 *
 *  - 버튼: 명시적 클릭 = 한 번에 큰 변화. ZOOM_FACTOR_BUTTON (0.8 = 25% 확대) 사용.
 *  - 휠/트랙패드: deltaY 비례 지수 factor — macOS 트랙패드 미세 조작 호환. 그리고
 *    `Math.exp(deltaY * ZOOM_WHEEL_SENSITIVITY)` 가 deltaY=0 일 때 정확히 1.0 이라
 *    스크롤 멈춤 시 자연스럽게 정지.
 *  - 휠은 *마우스 커서 위치* 를 중심으로 줌 — Figma/Google Maps 표준 UX. 사용자가
 *    보고 있는 부분이 그대로 화면 중앙에 머무름.
 *  - 클램프: 초기 w 대비 ZOOM_MIN..ZOOM_MAX 비율.
 */
function bindZoom(container, svgEl) {
  // 버튼 — 명시적 클릭, viewBox 중심 고정.
  const btns = container.querySelectorAll('[data-flow-zoom]');
  for (const btn of btns) {
    btn.addEventListener('click', () => {
      const dir = btn.dataset.flowZoom;
      const factor = dir === 'in' ? ZOOM_FACTOR_BUTTON : 1 / ZOOM_FACTOR_BUTTON;
      zoomBy(svgEl, factor, null);
    });
  }
  // 휠 / 트랙패드 — 부드러운 지수 변화 + 커서 위치 중심.
  svgEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = Math.exp(e.deltaY * ZOOM_WHEEL_SENSITIVITY);
    // 커서 위치를 SVG 좌표로 변환해 줌 anchor 로 사용.
    const anchor = svgPoint(svgEl, e);
    zoomBy(svgEl, factor, anchor);
  }, { passive: false });
}

/**
 * viewBox 줌 적용.
 *
 * @param {SVGSVGElement} svgEl
 * @param {number} factor 새 w/h 가 현재 값에 곱해질 비율. <1 = 확대, >1 = 축소.
 * @param {{x:number,y:number}|null} anchor SVG 좌표계의 줌 중심점.
 *   null 이면 현재 viewBox 중심점(=화면 중앙) 고정 — 버튼 클릭용.
 *   값이 있으면 그 점이 화면상 같은 비율 위치에 머무르도록 viewBox.x/y 보정 — 커서 줌용.
 */
function zoomBy(svgEl, factor, anchor) {
  const newW = _seqView.w * factor;
  const newH = _seqView.h * factor;
  const ratio = newW / _seqViewInitial.w;
  if (ratio < ZOOM_MIN || ratio > ZOOM_MAX) return;

  // anchor 미지정 시 — viewBox 중심점 고정 (기존 동작).
  const ax = anchor !== null ? anchor.x : _seqView.x + _seqView.w / 2;
  const ay = anchor !== null ? anchor.y : _seqView.y + _seqView.h / 2;

  // anchor 가 viewBox 안에서 차지하는 *비율 위치*. 줌 후에도 같은 비율을 유지하도록
  // x/y 보정 — 사용자가 마우스 커서 아래의 좌표가 그대로 머무르는 효과.
  const relX = (ax - _seqView.x) / _seqView.w;
  const relY = (ay - _seqView.y) / _seqView.h;

  _seqView.w = newW;
  _seqView.h = newH;
  _seqView.x = ax - relX * newW;
  _seqView.y = ay - relY * newH;
  applyViewBox(svgEl);
}

// ============================================================================
// 헬퍼 — svgPoint / applyViewBox / refreshEdgePath
// ============================================================================

/** 화면 픽셀 좌표 → SVG viewBox 좌표 변환. */
function svgPoint(svgEl, evt) {
  const pt = svgEl.createSVGPoint();
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  const ctm = svgEl.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const inv = ctm.inverse();
  const p = pt.matrixTransform(inv);
  return { x: p.x, y: p.y };
}

/** _seqView 의 현재 값을 SVG viewBox attribute 로 반영. */
function applyViewBox(svgEl) {
  svgEl.setAttribute('viewBox', viewBoxStr(_seqView));
}

/**
 * 노드 드래그 / Reset 직후 단일 엣지의 d 속성을 재계산.
 *
 * 좌표 SSoT 는 `computeEdgeD` — makeEdgePath 의 초기 그리기와 동일 함수를 사용해
 * 4면 앵커 + 외곽 offset 정책을 일관 유지. 과거 인라인 fx/fy/tx/ty 룰은 가림 회귀의
 * 원인이라 제거 (meta-docs-flow-edge-anchor 2026-05-26).
 */
function refreshEdgePath(edge) {
  const ref = _edgeIndex.get(edge.id);
  if (!ref) return;
  const from = _nodes.find((n) => n.id === edge.source);
  const to = _nodes.find((n) => n.id === edge.target);
  if (!from || !to) return;
  ref.pathEl.setAttribute('d', computeEdgeD(from, to));
}

// =============================================================================
// 유틸
// =============================================================================

function viewBoxStr(v) {
  return `${v.x} ${v.y} ${v.w} ${v.h}`;
}

// findNodeAncestor: bindNodeClick 제거와 함께 호출 지점이 사라져 제거.
//   highlight 채널의 동일 헬퍼는 meta-docs-flow-highlight.js::findNodeForeignObject 가
//   별도로 보유.
