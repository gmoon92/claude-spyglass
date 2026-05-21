/**
 * meta-docs-flow-view.js — 메타 문서 ego-graph 시각화 (rev. 2026-05-21).
 *
 * 책임:
 *  - GET /api/meta-docs/flow?project=&center_type=&center_name= 응답을 받아 좌(triggers) → 중(center) →
 *    우(cooccurrence 4 columns) 형태의 ego-graph를 SVG로 렌더한다.
 *  - 컨테이너는 메타 문서 탭 상단 영역(#metaDocsFlowRegion). meta-docs-view.js의 renderHtml이
 *    영역을 만들어 두고 본 모듈이 toolbar+SVG+카드를 inject.
 *  - 노드는 드래그 가능(mousedown → mousemove → mouseup) — 위치 갱신 시 연결된 에지의 베지어 path와
 *    % 라벨 위치를 즉시 재계산.
 *  - 입력 center가 없거나 응답 nodes가 비어 있으면 .flow-empty 안내(i18n)로 폴백.
 *
 * 호출자:
 *  - meta-docs-view.js loadMetaDocsLibrary — 카탈로그 정렬 후 첫 행을 중심으로 자동 1회.
 *  - meta-docs-view.js onMetaContainerClick — 카탈로그 행 클릭 시 클릭된 행 중심으로 재렌더.
 *  - meta-docs-view.js refreshMetaActiveSubTab — 좌측 프로젝트 변경 시(간접: loadMetaDocsLibrary 경유).
 *
 * 의존성:
 *  - design-tokens.css (색·폰트·radius)
 *  - flow-diagram.css (본 패널 전용 비주얼)
 *  - design-system/chips/chip.css (.ds-chip[data-tone] SSoT)
 *
 * 데이터 스키마(서버 buildEgoFlowGraph 출력):
 *   {
 *     nodes: [{ id, kind:'center'|'trigger'|'skill'|'agent'|'tool'|'mcp',
 *               title, sub?, icon, x, y, w, h, variant?, pills? }],
 *     edges: [{ id, from, to, kind:'main'|'hot'|'dim'|'spoke',
 *               label?:{pct,count?}, tone?:'hot',
 *               anchorFrom?:'left|right|top|bottom', anchorTo?:same }],
 *     sectionLabels: [{ x, y, kind:'skill'|'agent'|'tool'|'mcp' }],
 *     meta: { project, windowDays, center:{type,name}|null, centerTurns, totalTurns,
 *             viewBox:{w,h} }
 *   }
 *
 * 색상 어휘(memory feedback_chip_color_semantics):
 *   색상=시그널, 무채색=노이즈. HOT/center 외에는 기본 톤 유지.
 *
 * 스파게티 방지(memory feedback_avoid_spaghetti):
 *   본 모듈이 fetch + 렌더 + 드래그를 한 곳에서 책임진다.
 */

import { escHtml } from './formatters.js';

// ============================================================================
// 아이콘 (SVG, currentColor) — 노드 카드의 좌측 박스에 들어간다.
// 서버 iconForCenter/iconForSpoke가 발행하는 키와 1:1 매핑.
// ============================================================================
const ICONS = {
  cmd:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
  agent:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="3"/><circle cx="8.5" cy="13.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="13.5" r="1.2" fill="currentColor"/><path d="M12 3v4"/><circle cx="12" cy="2.5" r="1.2" fill="currentColor"/></svg>',
  book:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  plan:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21l3-3 7-7 3 3-7 7-3 0z"/><path d="M14 4l6 6"/></svg>',
  file:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  edit:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z"/></svg>',
};

// kind → 카드 우상단 .ds-chip data-tone 매핑 (chip.css SSoT 재사용).
//   center/trigger는 칩을 표시하지 않는다(중복 표지 — 카드 자체가 강조).
const KIND_TO_TONE = {
  skill: 'skill',
  agent: 'agent',
  tool:  'task',
  mcp:   'mcp',
};
const KIND_TO_LABEL = {
  skill: 'SKILL',
  agent: 'AGENT',
  tool:  'TOOL',
  mcp:   'MCP',
};

const SVGNS  = 'http://www.w3.org/2000/svg';
const HTMLNS = 'http://www.w3.org/1999/xhtml';

// meta-docs-flow ego-graph (2026-05-21 rev): 컨테이너가 'docs' 탭 상단 영역으로 이동.
const CONTAINER_ID = 'metaDocsFlowRegion';

// 모듈 단위 상태 — 마지막 fetch 결과(드래그 위치 유지)와 초기 위치 백업(Reset용).
let _nodes = [];
let _edges = [];
let _initialPositions = [];

// pan/zoom (2026-05-21): viewBox 상태와 초기값 백업.
//  - _view  : 현재 viewBox 좌표/크기 — 줌·팬으로 실시간 변동.
//  - _viewInitial : 마지막 fetch 직후 값 — Reset 버튼으로 복원.
//  - x/y 이동 = 팬, w/h 변경 = 줌(중심 고정).
let _view = { x: 0, y: 0, w: 1320, h: 360 };
let _viewInitial = { x: 0, y: 0, w: 1320, h: 360 };

const ZOOM_FACTOR = 0.8;  // + 클릭 한 번에 viewBox를 80%로 축소 → 화면이 1.25배 확대.
const ZOOM_MIN = 0.25;    // 초기 대비 25%까지 확대(작은 viewBox = 큰 시각)
const ZOOM_MAX = 4;       // 초기 대비 4배까지 축소(큰 viewBox = 작은 시각)

// ============================================================================
// 진입점 — meta-docs-view.js loadMetaDocsLibrary / 행 클릭에서 호출
// ============================================================================

/**
 * Ego-graph 렌더 진입점.
 *
 *  - 컨테이너가 DOM에 없거나 center 정보가 비면 안내(빈 상태)를 그린다.
 *  - 정상 fetch 후 nodes/edges/sectionLabels로 SVG를 inject한다.
 *
 * @param {object} args
 * @param {'command'|'skill'|'agent'|null} args.centerType - 중심 메타 문서 타입
 * @param {string|null} args.centerName                    - 중심 메타 문서 이름
 * @param {string|null} args.project                       - 선택된 프로젝트(없으면 전체)
 * @returns {Promise<void>}
 */
export async function loadFlowDiagram(args) {
  const container = document.getElementById(CONTAINER_ID);
  if (!container) return;

  const { centerType, centerName, project } = args || {};

  // 중심 미지정 — 카탈로그가 비어 있거나 모두 orphan인 케이스. 안내만 노출.
  if (!centerType || !centerName) {
    container.innerHTML = emptyHtml({ centerName: null, project });
    return;
  }

  container.innerHTML = skeletonHtml();

  let payload = null;
  try {
    payload = await fetchFlow({ centerType, centerName, project });
  } catch (err) {
    container.innerHTML = errorHtml(err);
    return;
  }

  if (!payload || !Array.isArray(payload.nodes) || payload.nodes.length === 0) {
    container.innerHTML = emptyHtml({ centerName, project });
    return;
  }

  _nodes = payload.nodes.map(cloneNode);
  _edges = payload.edges.map(e => ({ ...e }));
  _initialPositions = _nodes.map(n => ({ id: n.id, x: n.x, y: n.y }));

  // pan/zoom 초기화 — 서버가 발행한 viewBox.w/h를 그대로 사용. 이전 fetch의 줌/팬은 폐기(새 center).
  const vbW = payload.meta?.viewBox?.w ?? 1320;
  const vbH = payload.meta?.viewBox?.h ?? 360;
  _view = { x: 0, y: 0, w: vbW, h: vbH };
  _viewInitial = { x: 0, y: 0, w: vbW, h: vbH };

  container.innerHTML = shellHtml(payload.meta);
  const svgEl = container.querySelector('.flow-svg');
  if (!svgEl) return; // 방어적 — shellHtml 형태가 변경된 경우
  const canvasEl    = container.querySelector('.flow-canvas');
  const edgesLayer  = svgEl.querySelector('#flowEdgesLayer');
  const labelsLayer = svgEl.querySelector('#flowLabelsLayer');
  const nodesLayer  = svgEl.querySelector('#flowNodesLayer');

  // 카테고리 헤더 라벨 — 서버는 위치+kind만 발행, 텍스트는 i18n으로 채운다.
  renderSectionLabels(svgEl, payload.sectionLabels);

  // 노드 먼저(앵커 계산에 w/h 필요) → 에지 다음.
  const nodeIndex = new Map();
  const edgeIndex = new Map();

  for (const node of _nodes) {
    const fo = makeNodeFO(node);
    nodesLayer.appendChild(fo);
    nodeIndex.set(node.id, { node, foEl: fo });
  }
  // foreignObject를 실제 콘텐츠 크기에 맞게 조정 (텍스트 잘림 방지).
  // 측정 후 카드 우/하단이 viewBox를 벗어나면 viewBox.w/h를 늘려 노드가
  // SVG 영역 밖으로 클리핑되지 않도록 한다. 특히 mcp 컬럼(x=1400, w=130)에
  // 긴 이름이 들어오면 우측으로 자연스럽게 자라야 한다.
  //
  // 상단 트림(섹션 라벨 제거 대응): 라벨이 사라지면 y=0~cardYStart 구간이 빈 공간이 됨.
  // 모든 노드 중 최소 y를 찾아 viewBox.y를 조정해 불필요한 상단 여백을 제거한다.
  let maxRight  = _view.x + _view.w;
  let maxBottom = _view.y + _view.h;
  let minTop    = Infinity; // 최상단 노드 y — viewBox.y 트림에 사용
  const VIEWBOX_PAD = 20;
  for (const ref of nodeIndex.values()) {
    resizeNodeToContent(ref);
    maxRight  = Math.max(maxRight,  ref.node.x + ref.node.w + VIEWBOX_PAD);
    maxBottom = Math.max(maxBottom, ref.node.y + ref.node.h + VIEWBOX_PAD);
    minTop    = Math.min(minTop,    ref.node.y);
  }
  // 상단 트림: 최상단 노드 위에 VIEWBOX_PAD 만큼만 남기고 빈 공간 제거.
  const trimmedY = Math.max(0, minTop - VIEWBOX_PAD);
  const expandedW = maxRight  - _view.x;
  const expandedH = maxBottom - trimmedY;
  _view.y = trimmedY;
  _viewInitial.y = trimmedY;
  if (expandedW > _view.w || expandedH > _view.h || trimmedY !== 0) {
    _view.w = expandedW;
    _view.h = expandedH;
    _viewInitial.w = expandedW;
    _viewInitial.h = expandedH;
    applyViewBox(svgEl);
  }

  for (const edge of _edges) {
    makeEdge(edge, edgesLayer, labelsLayer, edgeIndex);
  }

  bindResetButton(container, svgEl, nodeIndex, edgeIndex);
  bindDrag(svgEl, nodesLayer, nodeIndex, edgeIndex);
  bindPan(svgEl, canvasEl);
  bindZoom(container, svgEl);
}

// ============================================================================
// fetch — /api/meta-docs/flow
// ============================================================================

async function fetchFlow({ centerType, centerName, project }) {
  const params = new URLSearchParams();
  if (project) params.set('project', project);
  params.set('center_type', centerType);
  params.set('center_name', centerName);
  const url = '/api/meta-docs/flow?' + params.toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  // 응답 형식: { success: true, data: { nodes, edges, sectionLabels, meta } } 또는 raw.
  return json?.data ?? json;
}

function cloneNode(n) {
  return {
    id: n.id, kind: n.kind, title: n.title, sub: n.sub, icon: n.icon,
    x: n.x, y: n.y, w: n.w, h: n.h,
    variant: n.variant, pills: Array.isArray(n.pills) ? n.pills.slice() : undefined,
  };
}

// ============================================================================
// HTML shell (toolbar + canvas + svg defs)
// ============================================================================

/**
 * 상단 영역 컨테이너 마크업.
 *  - 사용자 요청(2026-05-21 rev): 프로젝트 정보는 좌측 패널이 이미 노출하므로 toolbar에서 제거.
 *  - 중심(center) 이름·window 일수만 toolbar에 남기고, viewBox는 서버 응답을 그대로 적용.
 *  - SVG는 width/height 100%로 컨테이너에 맞춰 자동 스케일.
 */
function shellHtml(meta) {
  const t = window.I18n.t.bind(window.I18n);
  const centerLabel = meta?.center?.name ? escHtml(meta.center.name) : '—';
  const days = meta?.windowDays ?? 7;
  const turns = meta?.centerTurns ?? 0;
  const total = meta?.totalTurns ?? 0;

  return `
    <div class="flow-toolbar">
      <span class="flow-scope">${t('ui.meta-docs-view.flow.scope-center')}: <b>${centerLabel}</b></span>
      <span class="flow-scope">${t('ui.meta-docs-view.flow.scope-window', { days })}</span>
      <span class="flow-scope">${t('ui.meta-docs-view.flow.scope-turns', { turns, total })}</span>
      <div class="flow-spacer"></div>
      <span class="flow-legend">
        <span><span class="flow-sw" style="background:var(--accent)"></span>${t('ui.meta-docs-view.flow.legend-main')}</span>
        <span><span class="flow-sw" style="background:var(--border-strong)"></span>${t('ui.meta-docs-view.flow.legend-normal')}</span>
        <span><span class="flow-sw flow-sw-dashed"></span>${t('ui.meta-docs-view.flow.legend-spoke')}</span>
      </span>
      <span class="flow-zoom-group">
        <button class="flow-zoom-btn" data-flow-zoom="out" title="${t('ui.meta-docs-view.flow.zoom-out-title')}" aria-label="${t('ui.meta-docs-view.flow.zoom-out-title')}">−</button>
        <button class="flow-zoom-btn" data-flow-zoom="in"  title="${t('ui.meta-docs-view.flow.zoom-in-title')}"  aria-label="${t('ui.meta-docs-view.flow.zoom-in-title')}">＋</button>
      </span>
      <button class="flow-reset-btn" data-flow-reset title="${t('ui.meta-docs-view.flow.reset-title')}">${t('ui.meta-docs-view.flow.reset-label')}</button>
    </div>
    <div class="flow-canvas">
      <svg class="flow-svg"
           width="100%" height="100%"
           viewBox="${_view.x} ${_view.y} ${_view.w} ${_view.h}"
           preserveAspectRatio="xMidYMid meet"
           xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="flowArr"    viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 Z" fill="var(--border-strong)"/></marker>
          <marker id="flowArrHot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 Z" fill="var(--accent)"/></marker>
        </defs>
        <g id="flowSectionLabels"></g>
        <g id="flowEdgesLayer"></g>
        <g id="flowLabelsLayer"></g>
        <g id="flowNodesLayer"></g>
      </svg>
    </div>
  `;
}

/** 빈 상태 안내 — center 미지정 또는 응답 0건. */
function emptyHtml({ centerName, project }) {
  const t = window.I18n.t.bind(window.I18n);
  let title;
  if (!centerName) {
    title = project
      ? t('ui.meta-docs-view.flow.empty-no-center-project', { project: escHtml(project) })
      : t('ui.meta-docs-view.flow.empty-no-center');
  } else {
    title = t('ui.meta-docs-view.flow.empty-zero-turns', { name: escHtml(centerName) });
  }
  return `
    <div class="flow-empty">
      <span class="flow-empty-title">${title}</span>
      <span>${t('ui.meta-docs-view.flow.empty-hint')}</span>
    </div>
  `;
}

function skeletonHtml() {
  return `<div class="flow-empty"><span>…</span></div>`;
}

function errorHtml(err) {
  const t = window.I18n.t.bind(window.I18n);
  const msg = err?.message ? String(err.message) : String(err);
  return `<div class="flow-empty"><span class="flow-empty-title">${t('ui.meta-docs-view.flow.fetch-failed', { message: escHtml(msg) })}</span></div>`;
}

// ============================================================================
// 카테고리 헤더 라벨 — 우측 4 컬럼(SKILL/AGENT/TOOL/MCP) 상단 텍스트.
// 현재 비활성화: 컬럼 카드에 .ds-chip이 종류를 표시하므로 라벨은 시각적 노이즈.
// 서버가 발행하는 sectionLabels 배열 자체는 유지 (향후 재활성화 용이).
// ============================================================================

// eslint-disable-next-line no-unused-vars
function renderSectionLabels(_svgEl, _list) {
  // 의도적 noop — 섹션 라벨 텍스트를 숨겨 ego-graph를 간결하게 유지.
  // 재활성화 시 아래 구현을 복원할 것:
  //   const layer = _svgEl.querySelector('#flowSectionLabels');
  //   if (!layer || !Array.isArray(_list)) return;
  //   const t = window.I18n.t.bind(window.I18n);
  //   for (const sl of _list) { ... layer.appendChild(text); }
}

// ============================================================================
// 노드 렌더 — foreignObject + HTML card
// ============================================================================

function makeNodeFO(node) {
  const fo = document.createElementNS(SVGNS, 'foreignObject');
  fo.setAttribute('x', node.x);
  fo.setAttribute('y', node.y);
  fo.setAttribute('width', node.w);
  fo.setAttribute('height', node.h);
  fo.dataset.nodeId = node.id;

  const card = document.createElementNS(HTMLNS, 'div');
  card.className = 'node';
  // ego-graph variant — server가 발행하는 'center' | 'trigger' | 'spoke' 만 사용.
  //   center  : 강조 카드(--accent 보더)
  //   trigger : 좌측 슬래시커맨드(중립)
  //   spoke   : 우측 공출현(소형 슬롯)
  if (node.variant === 'center')  card.classList.add('is-center');
  if (node.variant === 'trigger') card.classList.add('is-trigger');
  if (node.variant === 'spoke')   card.classList.add('is-spoke');
  card.dataset.nodeId = node.id;
  card.dataset.kind   = node.kind;

  const icon = document.createElementNS(HTMLNS, 'div');
  icon.className = 'icon';
  icon.innerHTML = ICONS[node.icon] || '';
  card.appendChild(icon);

  const body = document.createElementNS(HTMLNS, 'div');
  body.className = 'body';

  const titleRow = document.createElementNS(HTMLNS, 'div');
  titleRow.className = 'title-row';
  const title = document.createElementNS(HTMLNS, 'div');
  title.className = 'title';
  title.textContent = node.title;
  titleRow.appendChild(title);

  // 분류 칩 — spoke 카드에만 부착(center/trigger는 자기 변형이 이미 충분한 표지).
  if (node.variant === 'spoke') {
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

  if (node.sub) {
    const sub = document.createElementNS(HTMLNS, 'div');
    sub.className = 'sub';
    sub.innerHTML = node.sub; // sub는 서버에서 안전한 숫자+i18n 조합 — innerHTML 의도적.
    body.appendChild(sub);
  }
  card.appendChild(body);

  if (Array.isArray(node.pills) && node.pills.length) {
    const pills = document.createElementNS(HTMLNS, 'span');
    pills.className = 'meta-pills';
    for (const p of node.pills) {
      const el = document.createElementNS(HTMLNS, 'span');
      if (p === 'hot') { el.className = 'pill-hot'; el.textContent = 'HOT'; }
      else             { el.className = 'pill-live'; el.textContent = String(p); }
      pills.appendChild(el);
    }
    card.appendChild(pills);
  }

  fo.appendChild(card);
  return fo;
}

/**
 * foreignObject의 width/height를 카드 실제 콘텐츠 크기에 맞게 조정.
 *
 * 측정 트릭(2026-05-21 fix): foreignObject의 width="180" 같은 고정 폭이
 * 자식 .node 카드의 자연 폭을 제한하므로(부모 폭 = 자식 가용 폭), 측정 중
 * 일시적으로 foreignObject를 9999로 확장하고 .node에 `max-content`를 강제로
 * 적용해 콘텐츠의 실제 자연 폭을 얻는다. 측정 후 정확한 값으로 다시 setAttribute.
 * 이전 구현은 width="180" 부모 안에서 width:auto만 적용해 항상 180을 측정,
 * 결국 `mcp__redmine_xxx` 같은 긴 이름이 SVG로 잘려보이는 원인이었다.
 *
 * NODE_MAX_W: 자연 폭이 과도하게 큰 경우(엄청 긴 이름) 박스가 무한정 늘어나
 * 다음 컬럼을 침범하는 것을 막기 위한 상한. 상한을 초과하면 .node에 그
 * 폭을 고정시키고, 텍스트는 wrap된다(white-space는 .title-row 안에서만 nowrap).
 */
const NODE_MAX_W = 260;

function resizeNodeToContent(ref) {
  const card = ref.foEl.querySelector('.node');
  if (!card) return;

  // 측정 전: foreignObject·card의 폭 제약을 모두 해제.
  const prevW    = card.style.width;
  const prevH    = card.style.height;
  const prevMaxW = card.style.maxWidth;
  ref.foEl.setAttribute('width',  '9999');
  ref.foEl.setAttribute('height', '9999');
  card.style.width = 'max-content';
  card.style.height = 'max-content';
  card.style.maxWidth = 'none';

  let w = Math.ceil(card.offsetWidth);
  let h = Math.ceil(card.offsetHeight);

  // 상한 초과 시: 폭을 NODE_MAX_W로 고정하고 .is-wrapped 클래스로 .title의
  // white-space:nowrap을 풀어 두 줄 이상으로 wrap되게 한 뒤 높이를 재측정.
  // 클래스는 측정 이후에도 유지되어야 실제 렌더에서도 wrap이 일어난다.
  if (w > NODE_MAX_W) {
    w = NODE_MAX_W;
    card.classList.add('is-wrapped');
    card.style.width = NODE_MAX_W + 'px';
    card.style.maxWidth = NODE_MAX_W + 'px';
    h = Math.ceil(card.offsetHeight);
  } else {
    card.classList.remove('is-wrapped');
  }

  // 원복(인라인 스타일 제거 → CSS 규칙이 다시 적용되도록).
  card.style.width = prevW;
  card.style.height = prevH;
  card.style.maxWidth = prevMaxW;
  ref.foEl.setAttribute('width',  String(w));
  ref.foEl.setAttribute('height', String(h));
  ref.node.w = w;
  ref.node.h = h;
}

// ============================================================================
// 에지 렌더 — 베지어 path + % 라벨
// ============================================================================

function anchorPoint(node, side) {
  switch (side) {
    case 'left':   return { x: node.x,                y: node.y + node.h / 2 };
    case 'right':  return { x: node.x + node.w,       y: node.y + node.h / 2 };
    case 'top':    return { x: node.x + node.w / 2,   y: node.y };
    case 'bottom': return { x: node.x + node.w / 2,   y: node.y + node.h };
    default:       return { x: node.x + node.w / 2,   y: node.y + node.h / 2 };
  }
}

function chooseAnchors(from, to) {
  const dx = (to.x + to.w / 2) - (from.x + from.w / 2);
  const dy = (to.y + to.h / 2) - (from.y + from.h / 2);
  if (Math.abs(dy) > Math.abs(dx) * 0.8) {
    return dy > 0 ? ['bottom', 'top'] : ['top', 'bottom'];
  }
  return dx > 0 ? ['right', 'left'] : ['left', 'right'];
}

/**
 * 두 노드의 경계 앵커에서 시작/끝나는 3차 베지어 path 문자열과 라벨 위치(t=0.5)를 동시에 반환.
 *  - 베지어 t=0.5 점은 P(0.5) = 0.125 P0 + 0.375 C1 + 0.375 C2 + 0.125 P3.
 */
function bezierFor(fromNode, toNode, anchorFrom, anchorTo) {
  const [sa, sb] = (anchorFrom && anchorTo) ? [anchorFrom, anchorTo] : chooseAnchors(fromNode, toNode);
  const p1 = anchorPoint(fromNode, sa);
  const p2 = anchorPoint(toNode,   sb);

  let c1, c2;
  if (sa === 'right' || sa === 'left') {
    const dx = Math.max(40, Math.abs(p2.x - p1.x) * 0.5);
    c1 = { x: p1.x + (sa === 'right' ?  dx : -dx), y: p1.y };
    c2 = { x: p2.x + (sb === 'left'  ? -dx :  dx), y: p2.y };
  } else {
    const dy = Math.max(40, Math.abs(p2.y - p1.y) * 0.5);
    c1 = { x: p1.x, y: p1.y + (sa === 'bottom' ?  dy : -dy) };
    c2 = { x: p2.x, y: p2.y + (sb === 'top'    ? -dy :  dy) };
  }

  const mid = {
    x: 0.125 * p1.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * p2.x,
    y: 0.125 * p1.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * p2.y,
  };

  return {
    d: `M ${p1.x},${p1.y} C ${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`,
    mid,
  };
}

function makeEdge(edge, edgesLayer, labelsLayer, edgeIndex) {
  const from = _nodes.find(n => n.id === edge.from);
  const to   = _nodes.find(n => n.id === edge.to);
  if (!from || !to) return;
  const { d, mid } = bezierFor(from, to, edge.anchorFrom, edge.anchorTo);

  const path = document.createElementNS(SVGNS, 'path');
  path.classList.add('edge');
  // ego-graph 에지 종류:
  //   hot   : 사용률 ≥40% — accent 색 + accent 화살표
  //   dim   : 사용률 ≤5%  — 흐릿한 borderline
  //   spoke : center→공출현 — dashed
  //   main  : 그 외 일반
  if (edge.kind === 'hot')        { path.classList.add('is-hot');   path.setAttribute('marker-end', 'url(#flowArrHot)'); }
  else if (edge.kind === 'dim')   { path.classList.add('is-dim');   path.setAttribute('marker-end', 'url(#flowArr)'); }
  else if (edge.kind === 'spoke') { path.classList.add('is-spoke'); }
  else                            { path.setAttribute('marker-end', 'url(#flowArr)'); }
  path.setAttribute('d', d);
  path.dataset.edgeId = edge.id;
  edgesLayer.appendChild(path);

  let labelEl = null;
  if (edge.label && (edge.label.pct !== undefined || edge.label.count !== undefined)) {
    labelEl = makeLabel(edge, mid);
    labelsLayer.appendChild(labelEl);
  }
  edgeIndex.set(edge.id, { edge, pathEl: path, labelEl });
}

function makeLabel(edge, mid) {
  const g = document.createElementNS(SVGNS, 'g');
  g.classList.add('edge-pct');
  if (edge.tone === 'hot') g.classList.add('is-hot');

  const hasSub = edge.label.count !== undefined;
  const w = hasSub ? 52 : 42;
  const h = hasSub ? 24 : 18;

  const rect = document.createElementNS(SVGNS, 'rect');
  rect.setAttribute('x', -w / 2);
  rect.setAttribute('y', -h / 2);
  rect.setAttribute('width',  w);
  rect.setAttribute('height', h);
  g.appendChild(rect);

  const pct = document.createElementNS(SVGNS, 'text');
  pct.setAttribute('y', hasSub ? -2 : 0);
  pct.textContent = `${edge.label.pct ?? 0}%`;
  g.appendChild(pct);

  if (hasSub) {
    const sub = document.createElementNS(SVGNS, 'text');
    sub.setAttribute('y', 8);
    sub.classList.add('sub');
    sub.textContent = `${edge.label.count}회`;
    g.appendChild(sub);
  }

  g.setAttribute('transform', `translate(${mid.x},${mid.y})`);
  return g;
}

function refreshEdge(edge, edgeIndex) {
  const ref = edgeIndex.get(edge.id);
  if (!ref) return;
  const from = _nodes.find(n => n.id === edge.from);
  const to   = _nodes.find(n => n.id === edge.to);
  if (!from || !to) return;
  const { d, mid } = bezierFor(from, to, edge.anchorFrom, edge.anchorTo);
  ref.pathEl.setAttribute('d', d);
  if (ref.labelEl) ref.labelEl.setAttribute('transform', `translate(${mid.x},${mid.y})`);
}

function refreshEdgesOf(nodeId, edgeIndex) {
  for (const edge of _edges) {
    if (edge.from === nodeId || edge.to === nodeId) refreshEdge(edge, edgeIndex);
  }
}

// ============================================================================
// 드래그 — mousedown / mousemove / mouseup
// ============================================================================

/** SVG viewBox 좌표계로 변환된 마우스 좌표. */
function svgPoint(svgEl, evt) {
  const pt = svgEl.createSVGPoint();
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  return pt.matrixTransform(svgEl.getScreenCTM().inverse());
}

function bindDrag(svgEl, nodesLayer, nodeIndex, edgeIndex) {
  let active = null; // { id, offsetX, offsetY, card, fo }

  function onDown(e) {
    const card = e.target.closest('.node');
    if (!card) return;
    const id = card.dataset.nodeId;
    const ref = nodeIndex.get(id);
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
    nodesLayer.appendChild(ref.foEl); // z-index 효과
    e.preventDefault();
  }
  function onMove(e) {
    if (!active) return;
    const p = svgPoint(svgEl, e);
    const ref = nodeIndex.get(active.id);
    if (!ref) return;
    ref.node.x = p.x - active.offsetX;
    ref.node.y = p.y - active.offsetY;
    active.fo.setAttribute('x', ref.node.x);
    active.fo.setAttribute('y', ref.node.y);
    refreshEdgesOf(active.id, edgeIndex);
  }
  function onUp() {
    if (!active) return;
    active.card.classList.remove('is-dragging');
    active = null;
  }

  svgEl.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup',   onUp);
}

// ============================================================================
// 동적 레이아웃 재배치 — Reset 버튼에서 호출.
// 각 노드의 측정된 폭(node.w)을 기반으로 컬럼 x를 재계산해
// 자연 폭 확장 후 생길 수 있는 컬럼 침범을 해소한다.
// ============================================================================

/** 노드 → 컬럼 ID 매핑. variant + kind 조합으로 결정. */
const COL_TRIGGER = 'left-trigger';
const COL_CENTER  = 'center';
const COL_SKILL   = 'right-skill';
const COL_AGENT   = 'right-agent';
const COL_TOOL    = 'right-tool';
const COL_MCP     = 'right-mcp';

/** 컬럼 순서 — 좌→우 배치 순서. */
const COL_ORDER = [COL_TRIGGER, COL_CENTER, COL_SKILL, COL_AGENT, COL_TOOL, COL_MCP];

/** 컬럼 간 수평 여백(px, viewBox 단위). */
const RESET_GAP = 60;

/** 좌측 시작 여백(px, viewBox 단위). */
const RESET_LEFT_MARGIN = 30;

/**
 * 노드의 variant + kind로부터 컬럼 ID를 반환.
 * 알 수 없는 노드는 null 반환 → 위치 갱신 대상에서 제외.
 *
 * @param {{ variant?: string, kind: string }} node
 * @returns {string|null}
 */
function nodeToColId(node) {
  if (node.variant === 'center')  return COL_CENTER;
  if (node.variant === 'trigger') return COL_TRIGGER;
  // spoke: kind로 우측 4컬럼 세분화
  if (node.kind === 'skill') return COL_SKILL;
  if (node.kind === 'agent') return COL_AGENT;
  if (node.kind === 'tool')  return COL_TOOL;
  if (node.kind === 'mcp')   return COL_MCP;
  return null;
}

/**
 * 노드 폭(node.w) 기반으로 컬럼 x를 재계산하고 모든 노드를 재배치.
 *
 * 동작:
 *  1. 컬럼별 노드 수집 → 컬럼별 maxW 산출
 *  2. 좌→우 순서로 컬럼 x를 누적 계산 (RESET_LEFT_MARGIN + 이전 컬럼 maxW + RESET_GAP)
 *  3. 각 노드의 x를 새 컬럼 x로 갱신 (y는 _initialPositions 서버 발행값으로 복원)
 *  4. 모든 에지 베지어 재계산
 *  5. viewBox.x/y/w/h 재계산 → _view, _viewInitial 둘 다 갱신 (새 baseline)
 *
 * @param {Map<string,{node:object,foEl:SVGForeignObjectElement}>} nodeIndex
 * @param {Map<string,{edge:object,pathEl:SVGPathElement,labelEl:SVGElement|null}>} edgeIndex
 * @param {SVGSVGElement} svgEl
 */
function computeRelaxedLayout(nodeIndex, edgeIndex, svgEl) {
  // 1. 컬럼별 노드 수집
  /** @type {Map<string, Array>} */
  const colNodes = new Map(COL_ORDER.map(id => [id, []]));
  for (const ref of nodeIndex.values()) {
    const colId = nodeToColId(ref.node);
    if (colId) colNodes.get(colId).push(ref);
  }

  // 컬럼별 최대 폭 (데이터 없는 컬럼은 maxW=0 → 건너뜀)
  /** @type {Map<string, number>} */
  const colMaxW = new Map();
  for (const [colId, refs] of colNodes) {
    colMaxW.set(colId, refs.length > 0 ? Math.max(...refs.map(r => r.node.w)) : 0);
  }

  // 2. 컬럼 x 좌표 순차 계산 (노드가 없는 컬럼은 공간 할당 안 함)
  /** @type {Map<string, number>} */
  const colX = new Map();
  let curX = RESET_LEFT_MARGIN;
  for (const colId of COL_ORDER) {
    const maxW = colMaxW.get(colId) ?? 0;
    if (maxW > 0) {
      colX.set(colId, curX);
      curX += maxW + RESET_GAP;
    }
  }

  // 3. 노드 위치 갱신: x=새 컬럼 x, y=서버 발행 초기값(_initialPositions)
  const initMap = new Map(_initialPositions.map(p => [p.id, p]));
  for (const ref of nodeIndex.values()) {
    const colId = nodeToColId(ref.node);
    const newX  = colX.get(colId);
    const init  = initMap.get(ref.node.id);

    if (newX !== undefined) {
      ref.node.x = newX;
      ref.foEl.setAttribute('x', String(newX));
    }
    if (init) {
      ref.node.y = init.y;
      ref.foEl.setAttribute('y', String(init.y));
    }
  }

  // 4. 에지 베지어 재계산
  for (const edge of _edges) refreshEdge(edge, edgeIndex);

  // 5. viewBox 재계산: 모든 노드의 실제 경계 기준
  let maxRight  = 0;
  let maxBottom = 0;
  let minTop    = Infinity;
  for (const ref of nodeIndex.values()) {
    maxRight  = Math.max(maxRight,  ref.node.x + ref.node.w);
    maxBottom = Math.max(maxBottom, ref.node.y + ref.node.h);
    minTop    = Math.min(minTop,    ref.node.y);
  }
  const VPAD   = 20;
  const newY   = Math.max(0, minTop - VPAD);
  const newW   = maxRight  + VPAD;       // x=0 기준 — 팬 상태도 초기화
  const newH   = maxBottom - newY + VPAD;

  // _view, _viewInitial 모두 갱신 → 이번 reset이 줌·팬의 새 baseline이 됨.
  _view        = { x: 0, y: newY, w: newW, h: newH };
  _viewInitial = { x: 0, y: newY, w: newW, h: newH };
  applyViewBox(svgEl);
}

function bindResetButton(container, svgEl, nodeIndex, edgeIndex) {
  const btn = container.querySelector('[data-flow-reset]');
  if (!btn) return;
  btn.addEventListener('click', () => {
    // 노드 폭 기반 동적 재배치 + viewBox 재계산.
    // 드래그/팬/줌으로 흐트러진 배치를 측정된 자연 폭 기준으로 정렬한다.
    computeRelaxedLayout(nodeIndex, edgeIndex, svgEl);
  });
}

// ============================================================================
// pan/zoom — viewBox 좌표 조작
// ============================================================================

/** 현재 _view 값을 SVG viewBox 속성에 반영. */
function applyViewBox(svgEl) {
  svgEl.setAttribute('viewBox', `${_view.x} ${_view.y} ${_view.w} ${_view.h}`);
}

/**
 * 빈영역 클릭+드래그로 viewBox를 평행이동.
 *  - mousedown이 .node 카드를 명중하면 노드 드래그가 우선이라 본 핸들러는 noop.
 *  - 평행이동량은 (clientΔ × viewBoxW / svgPixelW) — getScreenCTM 역행렬 대신 비율 계산.
 *    SVG 자체가 preserveAspectRatio xMidYMid meet 이므로 가로/세로 스케일이 동일.
 */
function bindPan(svgEl, canvasEl) {
  if (!canvasEl) return;
  let active = null; // { startX, startY, viewStartX, viewStartY, scale }

  function onDown(e) {
    if (e.button !== 0) return; // 좌클릭만
    // .node 카드 위 클릭은 노드 드래그에 양보 — pan은 빈 영역(또는 에지/배경)에서만.
    if (e.target.closest && e.target.closest('.node')) return;
    const rect = svgEl.getBoundingClientRect();
    if (rect.width === 0) return;
    const scale = _view.w / rect.width; // viewBox 단위 / 픽셀
    active = {
      startX: e.clientX,
      startY: e.clientY,
      viewStartX: _view.x,
      viewStartY: _view.y,
      scale,
    };
    canvasEl.classList.add('is-panning');
    e.preventDefault();
  }
  function onMove(e) {
    if (!active) return;
    const dx = (e.clientX - active.startX) * active.scale;
    const dy = (e.clientY - active.startY) * active.scale;
    _view.x = active.viewStartX - dx;
    _view.y = active.viewStartY - dy;
    applyViewBox(svgEl);
  }
  function onUp() {
    if (!active) return;
    canvasEl.classList.remove('is-panning');
    active = null;
  }

  svgEl.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup',   onUp);
}

/**
 * 툴바 +/- 버튼으로 viewBox 줌.
 *  - 줌은 viewBox 크기(w,h)를 ZOOM_FACTOR로 곱/나눈다. 중심은 화면 중앙(현재 viewBox 중심)에 고정.
 *  - 초기 w/h 대비 비율로 ZOOM_MIN~ZOOM_MAX 범위 클램프.
 */
function bindZoom(container, svgEl) {
  const btns = container.querySelectorAll('[data-flow-zoom]');
  if (!btns || btns.length === 0) return;
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      const dir = btn.dataset.flowZoom;
      const factor = (dir === 'in') ? ZOOM_FACTOR : (1 / ZOOM_FACTOR);
      zoomBy(svgEl, factor);
    });
  });
}

function zoomBy(svgEl, factor) {
  const newW = _view.w * factor;
  const newH = _view.h * factor;
  // 클램프 — 초기값 대비 비율로 제한.
  const ratio = newW / _viewInitial.w;
  if (ratio < ZOOM_MIN || ratio > ZOOM_MAX) return;
  // 중심 고정: 현재 viewBox의 중심을 유지하면서 크기만 변경.
  const cx = _view.x + _view.w / 2;
  const cy = _view.y + _view.h / 2;
  _view.w = newW;
  _view.h = newH;
  _view.x = cx - newW / 2;
  _view.y = cy - newH / 2;
  applyViewBox(svgEl);
}
