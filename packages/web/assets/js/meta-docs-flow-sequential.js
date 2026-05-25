/**
 * meta-docs-flow-sequential.js — "메타 문서 연관 순서도" 모드 렌더러
 *
 * 책임:
 *   `/api/graph/sequential-flow` 응답({nodes, edges, layers, meta})을 받아 *layer
 *   index = y 좌표*, *layer 안 시간순 = x 좌표* 로 매핑한 그래프를 기존 SVG 셸
 *   (#flowEdgesLayer + #flowNodesLayer) 안에 렌더한다.
 *
 *   기존 ego-graph 모드(meta-docs-flow-view.js) 의 SVG 셸과 toolbar 는 그대로 유지하고
 *   본 모듈은 *노드/엣지 좌표 부여 + 위→아래 인과 흐름 시각화* 만 책임.
 *
 * 의존성:
 *   - meta-docs-flow-camera.js (focusOnNodeBox — 카탈로그 행 클릭 시 카메라 이동)
 *   - meta-docs-flow-highlight.js (bindHighlight — 엣지 호버 인과 경로 강조)
 *
 * 호출 흐름:
 *   meta-docs-flow-view.js::loadFlowDiagram
 *     → _currentMode === 'sequential' 이면 → loadSequentialFlow(args)
 *         → fetchSequentialFlow → /api/graph/sequential-flow
 *         → renderSequentialFlow → SVG 셸 안에 노드/엣지 inject
 *         → bindNodeExpansion → 노드 클릭 시 인접 1-hop 동적 fetch
 *         → bindHighlight        → 엣지 hover → 인과 경로 강조
 *
 * 좌표 계산:
 *   - LAYER_GAP_Y = 140 — layer 간 수직 간격.
 *   - NODE_W/H    = 180/56 — 노드 카드 크기 (기존 ego variant 와 일관).
 *   - 같은 layer 안 노드는 x = LEFT_PAD + i * (NODE_W + COL_GAP) 로 좌→우.
 *
 * 시각 어휘 (메모리: feedback_chip_color_semantics):
 *   - center: .is-center (Anthropic 주황 `#d97757` / `--accent`).
 *   - HOT (depth 1 자식): .is-hot — invocations 가 layer 평균 이상이면 부여.
 *   - 그 외: 무채색 (.is-mid / .is-weak).
 *   - 점선 엣지 = AFTER (turn-after), 두꺼운 실선 = CALL (인과).
 *
 * 비범위:
 *   - SVG 셸 자체의 토글/리셋/줌은 본 모듈이 만들지 않음 — view.js 의 bindZoom/bindReset
 *     이 그대로 동작 (모듈 변수 _view 를 공유하지 않고 자기 자신의 _seqView 사용).
 */

import { escHtml } from './formatters.js';
import { focusOnNodeBox } from './meta-docs-flow-camera.js';
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
export async function loadSequentialFlow(args) {
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
    payload = await fetchSequentialFlow(args);
  } catch (err) {
    container.innerHTML = errorHtml(err);
    return;
  }

  if (!payload || !Array.isArray(payload.nodes) || payload.nodes.length === 0) {
    container.innerHTML = emptyHtml({ centerName: args.centerName, mode: 'sequential' });
    return;
  }

  // layer index → y, layer 안 i → x 매핑으로 SequentialNode 를 정규화된 _nodes 로 변환.
  _layers = Array.isArray(payload.layers) ? payload.layers : [];
  _nodes = computePositions(payload.nodes, _layers);
  _edges = payload.edges.map((e) => ({ ...e }));

  // viewBox — layer 수 + 가장 wide 한 layer 의 노드 수 기준.
  const maxCols = _layers.reduce((mx, l) => Math.max(mx, l.length), 1);
  _seqView = {
    x: 0,
    y: 0,
    w: LAYOUT.leftPad * 2 + maxCols * (LAYOUT.nodeW + LAYOUT.colGap),
    h: LAYOUT.topPad * 2 + _layers.length * LAYOUT.layerGapY,
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

  // ── 자연 폭 재측정 — 카드 콘텐츠에 맞춰 foreignObject 폭/높이 갱신 ─────
  //   고정 LAYOUT.nodeW=180 으로는 긴 이름이 잘리거나 짧은 이름에 과한 여백.
  //   측정 후 같은 layer 안에서 다음 노드와 겹치지 않도록 x 재배치 + viewBox.w 확장.
  let layerMaxRight = _seqView.x + _seqView.w;
  // layer 별 좌→우 누적 x 를 다시 계산 — resize 결과를 반영해 간격 균일.
  const layerCursor = new Map(); // layerIdx → 다음 노드의 x
  for (let li = 0; li < _layers.length; li++) {
    const ids = _layers[li];
    let cursorX = LAYOUT.leftPad;
    for (const id of ids) {
      const ref = _nodeIndex.get(id);
      if (!ref) continue;
      resizeNodeToContent(ref);
      ref.node.x = cursorX;
      ref.foEl.setAttribute('x', String(cursorX));
      cursorX += ref.node.w + LAYOUT.colGap;
      layerMaxRight = Math.max(layerMaxRight, cursorX);
    }
    layerCursor.set(li, cursorX);
  }
  // viewBox.w 확장 — 가장 wide 한 layer 기준 + 우측 padding.
  const expandedW = Math.max(_seqView.w, layerMaxRight + LAYOUT.leftPad);
  if (expandedW !== _seqView.w) _seqView.w = expandedW;

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

  // 인터랙션 바인딩 — ego 모드와 동일 순서: click → drag → pan → zoom → highlight → toolbar.
  //   순서 중요: drag 가 mousedown 을 먼저 잡고 pan 은 빈 영역에서만 동작.
  //   bindSubRowClick 은 bindNodeClick 보다 *먼저* 등록되어야 sub-row 클릭이
  //   카드 클릭(=재중심) 로 흡수되지 않는다 — ego 모드와 동일 순서.
  bindSubRowClick(svgEl);
  bindNodeClick(svgEl);
  bindDrag(svgEl, nodesLayer);
  bindPan(svgEl, canvasEl);
  bindZoom(container, svgEl);
  bindHighlight(svgEl, { getNodes: () => _nodes, getEdges: () => _edges });
  bindToolbarButtons(container, svgEl);
}

/** view.js 의 토글 / date-range 핸들러가 같은 args 로 재호출. */
export function reloadLast() {
  if (_lastArgs) loadSequentialFlow(_lastArgs);
}

// =============================================================================
// fetch
// =============================================================================

async function fetchSequentialFlow(args) {
  const params = new URLSearchParams();
  params.set('center_kind', args.centerKind);
  params.set('center_name', args.centerName);
  if (typeof args.depth === 'number') params.set('depth', String(args.depth));
  const url = '/api/graph/sequential-flow?' + params.toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json?.data ?? json;
}

// =============================================================================
// 좌표 계산 — layer 기반 위→아래, 시간 ASC 좌→우
// =============================================================================

function computePositions(rawNodes, layers) {
  // layer index map.
  const layerOf = new Map();
  layers.forEach((ids, idx) => ids.forEach((id) => layerOf.set(id, idx)));

  // 같은 layer 안 시간 순서 보존 (server 가 이미 정렬해 보낸 layer 배열을 신뢰).
  const orderInLayer = new Map();
  layers.forEach((ids, idx) => {
    ids.forEach((id, i) => orderInLayer.set(id, { layerIdx: idx, posIdx: i }));
  });

  return rawNodes.map((n) => {
    const lo = orderInLayer.get(n.id);
    const layerIdx = lo ? lo.layerIdx : 0;
    const posIdx = lo ? lo.posIdx : 0;
    return {
      id: n.id,
      kind: n.data?.kind ?? n.type ?? 'tool',
      type: n.type,
      title: n.data?.name ?? '?',
      depth: n.data?.depth ?? 0,
      tool_use_id: n.data?.tool_use_id,
      started_at: n.data?.started_at,
      // 백엔드 어댑터가 보낸 통계 — 카드 sub 영역의 "N turns · M%" 매핑.
      count: n.data?.count,
      pct: n.data?.pct,
      invocations: n.data?.invocations,
      timeline: n.data?.timeline,
      // MCP 서버 그룹 카드의 sub-row 리스트 (`adaptEgoToSequential` 가 발행).
      //   각 row 의 fullName 을 클릭 시 center 로 재로드 (bindSubRowClick).
      subRows: Array.isArray(n.data?.subRows) ? n.data.subRows.map((r) => ({ ...r })) : undefined,
      // 카드 우상단 보조 배지 — 현재는 'hot' 만 정의(centerTurns/totalTurns ≥ 0.4).
      pills: Array.isArray(n.data?.pills) ? n.data.pills.slice() : undefined,
      x: LAYOUT.leftPad + posIdx * (LAYOUT.nodeW + LAYOUT.colGap),
      y: LAYOUT.topPad + layerIdx * LAYOUT.layerGapY,
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
          <marker id="flowArrSeq"    viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 Z" fill="var(--border-strong)"/></marker>
          <marker id="flowArrSeqHot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 Z" fill="var(--accent)"/></marker>
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
  // center: 강조 카드 / spoke: 일반 카드 (clickable). ego variant 와 의미 동일.
  if (node.type === 'center') card.classList.add('is-center');
  else card.classList.add('is-spoke');
  if (node.depth === 1) card.classList.add('is-hot');
  else if (node.depth === -1) card.classList.add('is-after');
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
  const isAfter = edge.type === 'AFTER';
  const stroke = isAfter ? 'var(--border-strong)' : 'var(--accent)';
  const strokeWidth = isAfter ? 1.2 : 1.8;
  const dasharray = isAfter ? '4 4' : 'none';
  path.setAttribute('stroke', stroke);
  path.setAttribute('stroke-width', String(strokeWidth));
  path.setAttribute('stroke-dasharray', dasharray);
  path.setAttribute('fill', 'none');
  path.setAttribute('marker-end', isAfter ? 'url(#flowArrSeq)' : 'url(#flowArrSeqHot)');

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
 *   2) `loadSequentialFlow({centerKind:'mcp', centerName: 풀네임})` 재호출
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
    loadSequentialFlow({
      centerKind: 'mcp',
      centerName: fullName,
      project: _lastArgs?.project ?? null,
      depth: _lastArgs?.depth ?? 3,
    });
  });
}

/**
 * 노드 클릭 → 새 center 로 재로드 + 카메라 이동.
 *
 * ego 모드의 `bindSubRowClick` 과 동일한 드래그 vs 클릭 구분 룰:
 *   - mousedown 위치 기록, mousemove 4px 이상이면 드래그로 판정
 *   - mouseup 직후 click 이벤트에서 위 플래그 검사
 *   - center 카드 클릭은 무시 (같은 center)
 *
 * 클릭 시 동작:
 *   1) `focusOnNodeBox` 로 카메라 이동 (시각적 피드백)
 *   2) `loadSequentialFlow({centerKind: 클릭된 노드의 kind, centerName: 노드의 title})` 재호출
 *      → 새 center 로 sequential 모드 재렌더
 */
function bindNodeClick(svgEl) {
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
    if (moved) return; // 드래그 — 클릭 무시.
    const fo = findNodeAncestor(e.target);
    if (!fo) return;
    const nodeId = fo.dataset.nodeId;
    const node = _nodes.find((n) => n.id === nodeId);
    if (!node) return;
    if (node.type === 'center') return; // 같은 center 재로드 의미 없음.

    // 1) 카메라 이동 — 사용자에게 피드백.
    focusOnNodeBox(svgEl, _seqView, { x: node.x, y: node.y, w: node.w, h: node.h }, {
      zoom: 1.2,
      durationMs: 350,
    });

    // 2) 새 center 로 재로드 — center 변경은 sequential 모드 유지한 채 fetch.
    //    mcp/tool 은 ego API 가 center 로 지원 안 하므로 가드.
    const newCenterKind = node.kind;
    if (newCenterKind !== 'command' && newCenterKind !== 'skill' && newCenterKind !== 'agent') {
      console.log(`[flow-sequential] '${newCenterKind}' kind 는 center 로 미지원 — 클릭 무시`);
      return;
    }
    // 짧은 지연 후 재로드 — 카메라 애니메이션이 시각적으로 끊기지 않도록.
    setTimeout(() => {
      loadSequentialFlow({
        centerKind: newCenterKind,
        centerName: node.title,
        project: _lastArgs?.project ?? null,
        depth: _lastArgs?.depth ?? 3,
      });
    }, 200);
  });
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
 *   mousedown on .node → svgPoint 로 SVG 좌표 변환 + offset 기록 + .is-dragging
 *   window mousemove   → 새 x/y 계산 + foreignObject 갱신 + refreshEdgesOf
 *   window mouseup     → cleanup
 *
 * z-index: 드래그 중인 노드를 nodesLayer 의 마지막에 reappend 해서 최상위로.
 */
function bindDrag(svgEl, nodesLayer) {
  let active = null; // { id, offsetX, offsetY, card, fo }

  function onDown(e) {
    const card = e.target.closest && e.target.closest('.node');
    if (!card) return;
    const id = card.dataset.nodeId;
    const ref = _nodeIndex.get(id);
    if (!ref) return;
    const p = svgPoint(svgEl, e);
    active = {
      id,
      offsetX: p.x - ref.node.x,
      offsetY: p.y - ref.node.y,
      card,
      fo: ref.foEl,
    };
    card.classList.add('is-dragging');
    nodesLayer.appendChild(ref.foEl); // z-index 효과.
    e.preventDefault();
  }
  function onMove(e) {
    if (!active) return;
    const p = svgPoint(svgEl, e);
    const ref = _nodeIndex.get(active.id);
    if (!ref) return;
    ref.node.x = p.x - active.offsetX;
    ref.node.y = p.y - active.offsetY;
    active.fo.setAttribute('x', String(ref.node.x));
    active.fo.setAttribute('y', String(ref.node.y));
    // 연결된 엣지 재계산.
    for (const e of _edges) {
      if (e.source === active.id || e.target === active.id) refreshEdgePath(e);
    }
  }
  function onUp() {
    if (!active) return;
    active.card.classList.remove('is-dragging');
    active = null;
  }

  svgEl.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

/**
 * 캔버스 빈 영역 드래그 → viewBox 이동(pan).
 * 노드 카드 위에서는 bindDrag 에 양보. 좌클릭만.
 */
function bindPan(svgEl, canvasEl) {
  if (!canvasEl) return;
  let active = null;

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
    canvasEl.classList.add('is-panning');
    e.preventDefault();
  }
  function onMove(e) {
    if (!active) return;
    const dx = (e.clientX - active.startX) * active.scale;
    const dy = (e.clientY - active.startY) * active.scale;
    _seqView.x = active.viewStartX - dx;
    _seqView.y = active.viewStartY - dy;
    applyViewBox(svgEl);
  }
  function onUp() {
    if (!active) return;
    canvasEl.classList.remove('is-panning');
    active = null;
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

function findNodeAncestor(target) {
  let cur = target;
  while (cur && cur !== document) {
    if (cur instanceof Element && cur.tagName.toLowerCase() === 'foreignobject' && cur.dataset.nodeId) {
      return cur;
    }
    cur = cur.parentNode;
  }
  return null;
}
