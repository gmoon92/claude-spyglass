/**
 * features/meta-docs/flow-edge.ts — 엣지 path 좌표 순수 기하 (P4-03)
 *
 * 원본: assets/js/meta-docs-flow.js computeEdgeD/chooseAnchors/anchorPoint/offsetOutward
 *   (flow.js:672-731)를 순수 함수로 1:1 추출. SVG/DOM 무관 — path d 문자열만 산출(arch §4.2).
 *   마커 가림 방지 외곽 offset 정책(flow.js:653) 보존.
 *
 * @module features/meta-docs/flow-edge
 */

export type Side = 'left' | 'right' | 'top' | 'bottom';
export interface FlowBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Point {
  x: number;
  y: number;
}

/**
 * EDGE_END_OFFSET: 화살표 머리가 카드에 가려지지 않도록 끝점을 노드 경계 밖으로 옮기는 px.
 * markerWidth=7 / refX=9 / strokeWidth 1.8 조합에서 carbon-tested 한 값. (flow.js:653)
 */
export const EDGE_END_OFFSET = 6;

/** 노드 박스의 4면 중심 좌표. (flow.js:693) */
export function anchorPoint(node: FlowBox, side: Side): Point {
  switch (side) {
    case 'left':
      return { x: node.x, y: node.y + node.h / 2 };
    case 'right':
      return { x: node.x + node.w, y: node.y + node.h / 2 };
    case 'top':
      return { x: node.x + node.w / 2, y: node.y };
    case 'bottom':
      return { x: node.x + node.w / 2, y: node.y + node.h };
    default:
      return { x: node.x + node.w / 2, y: node.y + node.h / 2 };
  }
}

/** 앵커 점을 노드 경계의 *바깥* 방향으로 offset 만큼 이동. marker 가림 방지. (flow.js:704) */
export function offsetOutward(p: Point, side: Side, off: number): Point {
  switch (side) {
    case 'left':
      return { x: p.x - off, y: p.y };
    case 'right':
      return { x: p.x + off, y: p.y };
    case 'top':
      return { x: p.x, y: p.y - off };
    case 'bottom':
      return { x: p.x, y: p.y + off };
    default:
      return p;
  }
}

/**
 * from/to 의 상대 위치에 따라 자연스러운 앵커 면 쌍 [from-side, to-side] 선택. (flow.js:724)
 *  - |dy| > |dx| * 0.8 : vertical (top/bottom). 그 외 horizontal (left/right).
 */
export function chooseAnchors(from: FlowBox, to: FlowBox): [Side, Side] {
  const dx = to.x + to.w / 2 - (from.x + from.w / 2);
  const dy = to.y + to.h / 2 - (from.y + from.h / 2);
  if (Math.abs(dy) > Math.abs(dx) * 0.8) {
    return dy > 0 ? ['bottom', 'top'] : ['top', 'bottom'];
  }
  return dx > 0 ? ['right', 'left'] : ['left', 'right'];
}

/** 두 카드 사이 3차 베지어 path 의 d 속성. (flow.js:672) */
export function computeEdgeD(from: FlowBox, to: FlowBox): string {
  const [sa, sb] = chooseAnchors(from, to);
  const p1 = anchorPoint(from, sa);
  const p2Raw = anchorPoint(to, sb);
  const p2 = offsetOutward(p2Raw, sb, EDGE_END_OFFSET);

  let c1: Point;
  let c2: Point;
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
