/**
 * features/meta-docs/FlowEdge.tsx — xyflow 커스텀 floating edge (xyflow 재작성)
 *
 * 구 MetaDocsFlow.makeEdgePath(명령형 createElementNS + setAttribute('d'))를 대체한다. xyflow 의 핸들 고정
 *   엣지가 아니라 **floating edge**: useInternalNode 로 source/target 노드의 측정 박스(positionAbsolute +
 *   measured w/h)를 읽어 **기존 순수 computeEdgeD(SSoT) 를 그대로 호출**한다 — 4면 앵커 자동 선택 + 마커 가림
 *   offset(EDGE_END_OFFSET)까지 동일 베지어를 픽셀 재현(자사 자유 베지어 디자인 보존). 노드 드래그 시 xyflow 가
 *   measured 를 갱신하므로 path 가 자동 추종(구 refreshEdgePath 불요).
 *
 * className(.edge / .edge-call / .edge-after / .is-strength-* / .is-highlighted / .is-flowing)은 data 로
 *   결정 — flow-diagram.css 의 엣지 규칙을 그대로 사용. 화살표 marker(#flowArr)는 본체가 ReactFlow 안에
 *   1회 정의(defs), 여기선 markerEnd 로 참조(context-stroke 로 엣지 색 상속 — 구 동치).
 *
 * @module features/meta-docs/FlowEdge
 */
import { BaseEdge, useInternalNode, type EdgeProps, type InternalNode } from '@xyflow/react';
import { computeEdgeD, type FlowBox } from './flow-edge';
import type { FlowFlowEdge } from './flow-adapter';

/** 화살표 marker 참조 — 본체 defs 의 #flowArr(구 makeEdgePath 와 동일 id). */
export const FLOW_EDGE_MARKER = 'url(#flowArr)';

/** InternalNode → computeEdgeD 가 받는 FlowBox(절대좌표 + 측정 크기). 미측정 시 null. */
function boxOf(node: InternalNode | undefined): FlowBox | null {
  if (!node) return null;
  const w = node.measured?.width;
  const h = node.measured?.height;
  const p = node.internals?.positionAbsolute;
  if (typeof w !== 'number' || typeof h !== 'number' || !p) return null;
  return { x: p.x, y: p.y, w, h };
}

export function FlowEdge({ id, source, target, data, markerEnd }: EdgeProps<FlowFlowEdge>): React.ReactElement | null {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const from = boxOf(sourceNode);
  const to = boxOf(targetNode);
  if (!from || !to) return null; // 측정 전(첫 패스) — measure→layout 후 재렌더에서 그려짐.

  const d = computeEdgeD(from, to);
  const cls = ['edge', `edge-${data?.edgeType ?? 'call'}`];
  if (data?.strength) cls.push(`is-strength-${data.strength}`);
  if (data?.highlighted) cls.push('is-highlighted');
  if (data?.flowing) cls.push('is-flowing');

  return <BaseEdge id={id} path={d} markerEnd={markerEnd ?? FLOW_EDGE_MARKER} className={cls.join(' ')} />;
}
