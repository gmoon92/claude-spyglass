/**
 * meta-docs-flow-highlight.js — 카드/엣지 강조 (click-based persistent + edge hover)
 *
 * 책임:
 *   사용자 의도 (2026-05-26): "어떤 카드가 클릭되었을 때 그 카드의 모든 조상 + 자손
 *   경로가 *지속적으로* 강조 — 다른 카드 클릭 / 배경 클릭 / 같은 카드 재클릭 전까지".
 *
 *   강조 어휘:
 *     - 강조 대상 노드/엣지 — `.is-highlighted` 클래스 → CSS 가 stroke=`--accent` 처리.
 *     - 강조 대상 엣지 — 추가로 `.is-flowing` 클래스 → @keyframes flow-edge-dash 적용,
 *       stroke-dashoffset 이 시간에 따라 이동해 *데이터 흐름 방향성* 시각 표현.
 *     - 비강조 모든 요소 — 컨테이너에 `.has-selection` 클래스 → opacity 0.2 톤다운.
 *
 *   click vs hover 두 채널 공존:
 *     - 카드 click  : persistent. select state. 같은 카드 재click = clear. 배경 click = clear.
 *     - 엣지 hover  : transient. mouseover 시 동일 BFS path 강조 → mouseout 시 복원.
 *                     단 click selection 이 활성화된 상태에선 hover 무시 (덮어쓰지 않음).
 *
 * 의존성:
 *   - 없음 (순수 DOM 조작).
 *
 * 호출자:
 *   - meta-docs-flow.js::loadFlow → bindHighlight(svgEl, { getNodes, getEdges }).
 *
 * 강조 클래스 SSoT (flow-diagram.css):
 *   .flow-svg.has-selection                 — 선택 상태. 비강조 요소 opacity 0.2.
 *   .flow-svg.is-hovering                   — 엣지 hover 임시 상태. 비강조 요소 opacity 0.15.
 *   foreignObject.is-highlighted            — 강조된 노드.
 *   path.edge.is-highlighted                — 강조된 엣지. stroke=`--accent`.
 *   path.edge.is-flowing                    — 흐름 애니메이션 적용. stroke-dashoffset 이동.
 *
 * 시각 어휘 (메모리: feedback_chip_color_semantics):
 *   .is-highlighted = Anthropic 주황 #d97757 (`--accent` token).
 *   비강조 = opacity 0.2 + filter blur(0.5px) — 색상 톤다운 + 시각적 후퇴.
 */

// =============================================================================
// 상수 — 클래스 이름 SSoT
// =============================================================================

/** 엣지 hover 임시 강조 트리거 (CSS 비강조 블러). */
const CLS_HOVERING = 'is-hovering';
/** click 기반 persistent 강조 트리거 (CSS 비강조 opacity). */
const CLS_SELECTION = 'has-selection';
/** 강조 대상 요소 (노드 + 엣지 공통). */
const CLS_HIGHLIGHT = 'is-highlighted';
/** 흐름 애니메이션 (엣지 전용). */
const CLS_FLOWING = 'is-flowing';

// =============================================================================
// 본체 — 두 채널 (click persistent + edge hover transient)
// =============================================================================

/**
 * SVG 의 엣지 + 노드 + 배경에 강조 핸들러 부착.
 *
 * 정책:
 *   - 노드 click : persistent full-path highlight (toggle). 같은 노드 재클릭 = clear.
 *   - 다른 노드 click : 새 노드로 selection 전환.
 *   - 배경(빈 캔버스) click : selection clear.
 *   - 엣지 mouseover : 임시 BFS path highlight (selection 없을 때만 작동).
 *   - 엣지 mouseout : 임시 highlight 해제 (selection 없을 때만).
 *
 *   click 트리거가 sub-row click / 드래그와 충돌하지 않도록:
 *   - sub-row 의 stopImmediatePropagation (meta-docs-flow.js::bindSubRowClick) 가 먼저 실행됨.
 *   - 4px 드래그 임계값으로 드래그 vs 클릭 구분.
 *
 * @param {SVGSVGElement} svgEl SVG 루트.
 * @param {{ getNodes: () => Array, getEdges: () => Array }} accessors
 *   현재 모듈의 _nodes / _edges 를 조회하는 closure — 노드 드래그·갱신을 그대로 반영.
 */
export function bindHighlight(svgEl, accessors) {
  if (!svgEl || !accessors) return;

  /** 현재 선택된 중심 노드 id (null = 선택 없음). 모듈 scope state. */
  let selectedNodeId = null;
  /** 드래그 vs 클릭 구분 — mousedown 위치 + moved flag. */
  let downX = 0, downY = 0, moved = false;
  const DRAG_THRESHOLD = 4;

  // ──────────────────────────────────────────────────────────────────────────
  // 드래그 감지 — capture 단계에서 mousedown / mousemove 만 관찰. click 이벤트는
  //   bubble 단계에서 처리. 드래그면 click 자체가 발생하지 않거나 moved=true 로 skip.
  // ──────────────────────────────────────────────────────────────────────────
  svgEl.addEventListener('mousedown', (e) => {
    downX = e.clientX; downY = e.clientY; moved = false;
  }, true);
  svgEl.addEventListener('mousemove', (e) => {
    if (!moved) {
      const dx = Math.abs(e.clientX - downX);
      const dy = Math.abs(e.clientY - downY);
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) moved = true;
    }
  }, true);

  // ──────────────────────────────────────────────────────────────────────────
  // click 채널 — 노드 또는 배경 click 처리.
  //   sub-row click (data-tool-name) 은 bindSubRowClick 가 stopImmediatePropagation
  //   으로 차단하므로 여기까지 도달하지 않는다.
  // ──────────────────────────────────────────────────────────────────────────
  svgEl.addEventListener('click', (e) => {
    if (moved) return; // 드래그 — click 무시.

    const fo = findNodeForeignObject(e.target);
    if (fo) {
      const nodeId = fo.dataset.nodeId;
      if (!nodeId) return;
      // 같은 노드 재클릭 → toggle off.
      if (selectedNodeId === nodeId) {
        selectedNodeId = null;
        clearAll(svgEl);
        return;
      }
      // 새 노드 선택 → 이전 selection 제거 후 적용.
      selectedNodeId = nodeId;
      applyFullPathSelection(svgEl, accessors.getEdges(), nodeId);
      return;
    }

    // 배경 클릭 — selection clear.
    if (selectedNodeId !== null) {
      selectedNodeId = null;
      clearAll(svgEl);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 엣지 hover 채널 — selection 이 없을 때만 임시 path highlight 표시.
  //   selection 활성 상태에선 hover 가 click highlight 를 덮지 않도록 무시.
  // ──────────────────────────────────────────────────────────────────────────
  const edgesLayer = svgEl.querySelector('#flowEdgesLayer');
  if (edgesLayer) {
    edgesLayer.addEventListener('mouseover', (e) => {
      if (selectedNodeId !== null) return;
      const edgeEl = findEdgeAncestor(e.target);
      if (!edgeEl) return;
      const edgeId = edgeEl.dataset.edgeId;
      if (!edgeId) return;
      applyEdgeHoverHighlight(svgEl, accessors.getEdges(), edgeId);
    });
    edgesLayer.addEventListener('mouseout', (e) => {
      if (selectedNodeId !== null) return;
      const edgeEl = findEdgeAncestor(e.target);
      if (!edgeEl) return;
      clearHoverOnly(svgEl);
    });
  }
}

// =============================================================================
// click 채널 — Full-Path BFS persistent highlight
// =============================================================================

/**
 * 중심 노드의 모든 조상(upstream) + 자손(downstream) BFS 추적 후 강조 적용.
 *
 *   BFS 두 방향:
 *     - upstream   : edge.target === currentNode 인 엣지의 source 로 거슬러 오름.
 *     - downstream : edge.source === currentNode 인 엣지의 target 으로 내려감.
 *
 *   강조 대상:
 *     - 노드  : 중심 + upstream 도달 가능한 모든 노드 + downstream 도달 가능한 모든 노드.
 *     - 엣지  : 강조 노드 두 개 사이의 모든 엣지. 외곽 엣지(한쪽만 강조 안 됨)는 제외.
 *
 *   클래스 적용:
 *     - 컨테이너 `.has-selection` — 비강조 요소 opacity 0.2.
 *     - 강조 노드 foreignObject — `.is-highlighted`.
 *     - 강조 엣지 path — `.is-highlighted` + `.is-flowing` (방향성 애니메이션).
 *
 *   hover 채널 잔여 클래스 정리 — selection 진입 시 .is-hovering 흔적 제거.
 */
function applyFullPathSelection(svgEl, edges, centerNodeId) {
  const adjacencyOut = buildAdjacency(edges, 'forward');
  const adjacencyIn = buildAdjacency(edges, 'backward');

  const highlightedNodes = new Set();
  highlightedNodes.add(centerNodeId);
  bfsCollect(adjacencyIn, centerNodeId, highlightedNodes);
  bfsCollect(adjacencyOut, centerNodeId, highlightedNodes);

  const highlightedEdges = new Set();
  for (const e of edges) {
    if (highlightedNodes.has(e.source) && highlightedNodes.has(e.target)) {
      highlightedEdges.add(e.id);
    }
  }

  // hover 상태 제거 후 selection 적용 — 두 클래스가 동시 활성화되지 않도록.
  svgEl.classList.remove(CLS_HOVERING);
  clearHighlightClasses(svgEl);

  svgEl.classList.add(CLS_SELECTION);
  for (const fo of svgEl.querySelectorAll('foreignObject[data-node-id]')) {
    if (highlightedNodes.has(fo.dataset.nodeId)) {
      fo.classList.add(CLS_HIGHLIGHT);
    }
  }
  for (const path of svgEl.querySelectorAll('[data-edge-id]')) {
    if (highlightedEdges.has(path.dataset.edgeId)) {
      path.classList.add(CLS_HIGHLIGHT);
      path.classList.add(CLS_FLOWING);
    }
  }
}

// =============================================================================
// hover 채널 — 엣지 mouseover 시 임시 BFS path highlight
// =============================================================================

/**
 * 엣지 hover 시 호출. selection 이 없는 동안에만 작동 — applyFullPathSelection 과 동일
 * 패턴이지만 시작점이 엣지의 양끝이고 적용 클래스는 .has-selection 대신 .is-hovering
 * (CSS 가 더 강한 블러 적용, 명시적으로 *임시 hover* 임을 시각 어휘로 분리).
 */
function applyEdgeHoverHighlight(svgEl, edges, edgeId) {
  const edge = edges.find((e) => e.id === edgeId);
  if (!edge) return;

  const adjacencyOut = buildAdjacency(edges, 'forward');
  const adjacencyIn = buildAdjacency(edges, 'backward');

  const fromId = edge.source;
  const toId = edge.target;

  const highlightedNodes = new Set();
  bfsCollect(adjacencyIn, fromId, highlightedNodes);
  bfsCollect(adjacencyOut, toId, highlightedNodes);
  highlightedNodes.add(fromId);
  highlightedNodes.add(toId);

  const highlightedEdges = new Set();
  for (const e of edges) {
    if (highlightedNodes.has(e.source) && highlightedNodes.has(e.target)) {
      highlightedEdges.add(e.id);
    }
  }

  svgEl.classList.add(CLS_HOVERING);
  for (const fo of svgEl.querySelectorAll('foreignObject[data-node-id]')) {
    if (highlightedNodes.has(fo.dataset.nodeId)) fo.classList.add(CLS_HIGHLIGHT);
  }
  for (const path of svgEl.querySelectorAll('[data-edge-id]')) {
    if (highlightedEdges.has(path.dataset.edgeId)) {
      path.classList.add(CLS_HIGHLIGHT);
      // hover 채널은 *방향성 애니메이션 X* — 짧은 시간 표시되는 transient signal 이라
      // 애니메이션이 오히려 산만함. is-flowing 미적용.
    }
  }
}

// =============================================================================
// clear 함수들 — selection / hover 모두 제거
// =============================================================================

/** 전체 강조 상태 제거 (selection + hover). */
export function clearHighlight(svgEl) {
  if (!svgEl) return;
  clearAll(svgEl);
}

/** 내부 — selection + hover 모두 제거. */
function clearAll(svgEl) {
  svgEl.classList.remove(CLS_SELECTION);
  svgEl.classList.remove(CLS_HOVERING);
  clearHighlightClasses(svgEl);
}

/** 내부 — hover 만 제거 (selection 활성 상태 보존). */
function clearHoverOnly(svgEl) {
  svgEl.classList.remove(CLS_HOVERING);
  clearHighlightClasses(svgEl);
}

/** is-highlighted / is-flowing 모든 자식에서 제거. */
function clearHighlightClasses(svgEl) {
  for (const el of svgEl.querySelectorAll('.' + CLS_HIGHLIGHT)) {
    el.classList.remove(CLS_HIGHLIGHT);
  }
  for (const el of svgEl.querySelectorAll('.' + CLS_FLOWING)) {
    el.classList.remove(CLS_FLOWING);
  }
}

// =============================================================================
// 내부 헬퍼 — BFS / DOM 탐색
// =============================================================================

/** edge.source → [edge.target, ...] 인접 리스트 (forward = 자손, backward = 조상). */
function buildAdjacency(edges, dir) {
  const adj = new Map();
  for (const e of edges) {
    const key = dir === 'forward' ? e.source : e.target;
    const val = dir === 'forward' ? e.target : e.source;
    if (!adj.has(key)) adj.set(key, []);
    adj.get(key).push(val);
  }
  return adj;
}

/** start 부터 BFS 로 도달 가능한 노드 id 를 set 에 누적. cycle 안전. */
function bfsCollect(adj, start, set) {
  const queue = [start];
  while (queue.length > 0) {
    const cur = queue.shift();
    const neighbors = adj.get(cur) || [];
    for (const n of neighbors) {
      if (set.has(n)) continue;
      set.add(n);
      queue.push(n);
    }
  }
}

/** target 으로부터 거슬러 올라가 `data-edge-id` 보유한 가장 가까운 ancestor 반환. */
function findEdgeAncestor(target) {
  let cur = target;
  while (cur && cur !== document) {
    if (cur.dataset && cur.dataset.edgeId) return cur;
    cur = cur.parentNode;
  }
  return null;
}

/**
 * target 으로부터 거슬러 올라가 `data-node-id` 보유한 foreignObject 반환.
 * @param {EventTarget|Node|null} target
 * @returns {HTMLElement|null}
 */
function findNodeForeignObject(target) {
  let cur = target;
  while (cur && cur !== document) {
    if (cur instanceof Element
        && cur.tagName.toLowerCase() === 'foreignobject'
        && /** @type {HTMLElement} */ (cur).dataset.nodeId) {
      return /** @type {HTMLElement} */ (cur);
    }
    cur = /** @type {Node} */ (cur).parentNode;
  }
  return null;
}
