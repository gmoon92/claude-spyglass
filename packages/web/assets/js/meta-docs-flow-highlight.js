/**
 * meta-docs-flow-highlight.js — 엣지 hover 인과 경로 강조 (두 모드 공용)
 *
 * 책임:
 *   엣지 mouseover 시 그래프에서 양방향 인과 경로를 추적해 *경로상의 노드/엣지* 에
 *   유채색 시그널을 부여하고, *그 외 모든 요소* 에 무채색 블러를 부여한다.
 *   mouseout 시 즉시 복원. 06 보고서 §3.5 의 시각 어휘 (색상=시그널, 무채색=노이즈)
 *   엄격 준수.
 *
 * 의존성:
 *   - 없음 (순수 DOM 조작).
 *
 * 호출자:
 *   - meta-docs-flow-view.js (bindHighlight 호출로 활성화)
 *   - meta-docs-flow-sequential.js (동일)
 *
 * 사용 패턴:
 *   bindHighlight(svgEl, { getNodes: () => _nodes, getEdges: () => _edges });
 *
 * 강조 클래스 SSoT (flow-diagram.css 추가 룰):
 *   .flow-svg.is-hovering  — SVG 컨테이너에 부여, 비강조 요소에 블러 적용 트리거.
 *   .is-highlighted        — 강조 대상(node 카드 / edge path) 에 부여, 액센트 색.
 *
 * 시각 어휘 (메모리: feedback_chip_color_semantics):
 *   .is-highlighted = Anthropic 주황 #d97757 (`--accent` token)
 *   비강조 = opacity 0.25 + filter blur(0.5px) — 색상 톤다운 + 시각적 후퇴.
 */

// =============================================================================
// 상수 — 클래스 이름 SSoT
// =============================================================================

const CLS_HOVERING = 'is-hovering';
const CLS_HIGHLIGHT = 'is-highlighted';

// =============================================================================
// 본체
// =============================================================================

/**
 * SVG 의 모든 엣지에 mouseover/mouseout 핸들러를 부착.
 *
 * @param {SVGSVGElement} svgEl SVG 루트.
 * @param {{ getNodes: () => Array, getEdges: () => Array }} accessors
 *   현재 모듈의 _nodes / _edges 를 조회하는 closure — 노드 드래그·갱신을 그대로 반영.
 */
export function bindHighlight(svgEl, accessors) {
  if (!svgEl || !accessors) return;

  const edgesLayer = svgEl.querySelector('#flowEdgesLayer');
  if (!edgesLayer) return;

  // 위임 핸들러 — 엣지 path 가 자주 재생성되므로 위임이 안전.
  edgesLayer.addEventListener('mouseover', (e) => {
    const edgeEl = findEdgeAncestor(e.target);
    if (!edgeEl) return;
    const edgeId = edgeEl.dataset.edgeId;
    if (!edgeId) return;
    applyHighlight(svgEl, accessors.getNodes(), accessors.getEdges(), edgeId);
  });

  edgesLayer.addEventListener('mouseout', (e) => {
    const edgeEl = findEdgeAncestor(e.target);
    if (!edgeEl) return;
    clearHighlight(svgEl);
  });
}

/**
 * 엣지 id 에서 시작해 양방향으로 인과 경로 collect → 강조 클래스 부여.
 *
 * 알고리즘:
 *   1) edgeId 의 source, target 추출 (edge.source/edge.target 또는 id 파싱).
 *   2) source 에서 incoming 으로 BFS (조상 chain).
 *   3) target 에서 outgoing 으로 BFS (자손 chain).
 *   4) 모은 nodeId 집합 + edgeId 집합에 .is-highlighted 부여.
 *   5) SVG 컨테이너에 .is-hovering 부여 (CSS 가 비강조 블러 적용).
 */
function applyHighlight(svgEl, _nodes, edges, edgeId) {
  const edge = edges.find((e) => e.id === edgeId);
  if (!edge) return;

  const adjacencyOut = buildAdjacency(edges, 'forward');
  const adjacencyIn = buildAdjacency(edges, 'backward');

  // 시작 노드 = edge.from / edge.to
  const fromId = edge.from;
  const toId = edge.to;

  // 강조 대상 node 집합 — fromId 의 조상 + toId 의 자손 + 둘 자신.
  const highlightedNodes = new Set();
  bfsCollect(adjacencyIn, fromId, highlightedNodes);
  bfsCollect(adjacencyOut, toId, highlightedNodes);
  highlightedNodes.add(fromId);
  highlightedNodes.add(toId);

  // 강조 대상 edge 집합 — node 집합 안의 두 노드를 잇는 모든 엣지.
  const highlightedEdges = new Set();
  for (const e of edges) {
    if (highlightedNodes.has(e.from) && highlightedNodes.has(e.to)) {
      highlightedEdges.add(e.id);
    }
  }

  // DOM 클래스 부여.
  svgEl.classList.add(CLS_HOVERING);
  for (const fo of svgEl.querySelectorAll('foreignObject[data-node-id]')) {
    if (highlightedNodes.has(fo.dataset.nodeId)) fo.classList.add(CLS_HIGHLIGHT);
  }
  for (const path of svgEl.querySelectorAll('[data-edge-id]')) {
    if (highlightedEdges.has(path.dataset.edgeId)) path.classList.add(CLS_HIGHLIGHT);
  }
}

/**
 * 강조 상태를 모두 제거. mouseout 시 즉시 호출 — 트랜지션은 CSS 가 책임.
 */
export function clearHighlight(svgEl) {
  if (!svgEl) return;
  svgEl.classList.remove(CLS_HOVERING);
  for (const el of svgEl.querySelectorAll('.' + CLS_HIGHLIGHT)) {
    el.classList.remove(CLS_HIGHLIGHT);
  }
}

// =============================================================================
// 내부 헬퍼
// =============================================================================

/** edge.from → [edge.to, ...] 인접 리스트 (forward = 자손, backward = 조상). */
function buildAdjacency(edges, dir) {
  const adj = new Map();
  for (const e of edges) {
    const key = dir === 'forward' ? e.from : e.to;
    const val = dir === 'forward' ? e.to : e.from;
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
