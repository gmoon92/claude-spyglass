/**
 * features/meta-docs/flow-adapter.ts — unified-flow payload → xyflow Node[]/Edge[] 순수 변환 (xyflow 재작성)
 *
 * 배경: MetaDocsFlow 가 @xyflow/react 로 전환되며, 서버 `/api/graph/unified-flow` 응답(RawFlowNode/edges/
 *   columns)을 xyflow 의 nodes/edges 모델로 옮기는 경계가 필요하다. 본 모듈은 그 변환만 담당하는 순수 함수다
 *   (DOM·React 무관 — 단위 테스트 용이). 좌표는 flow-layout.computePositions(SSoT)가 산출한 컬럼 기반
 *   초기 좌표를 그대로 쓴다(자연폭 측정 후 재배치는 본체의 measure→layout 패스가 reflowColumns 로 수행).
 *
 * 노드 표시 필드(kind/title/layerTone/count/pct/invocations/timeline/subRows/pills 등)는 data 로 옮겨
 *   FlowNodeCard 가 렌더한다(makeNodeFO 와 동일 시각 산출). 엣지는 type(CALL/AFTER)/strength 를 data 로
 *   옮겨 FlowEdge 가 className(.edge-call/.edge-after/.is-strength-*)으로 반영한다.
 *
 * @module features/meta-docs/flow-adapter
 */
import type { Node, Edge } from '@xyflow/react';
import { computePositions, type RawFlowNode, type FlowColumn, type PositionedNode } from './flow-layout';

/** unified-flow 원시 엣지 — flow-graph.FlowEdge(id/source/target) + 표시 메타(type/strength). */
export interface RawFlowEdge {
  id: string;
  source: string;
  target: string;
  /** 'CALL'(인과) | 'AFTER'(시간 흐름). 대소문자 무관 — className 은 소문자화. */
  type?: string;
  /** 빈도 기반 강도 — 'strong'|'medium'|'weak'|'sparse'. */
  strength?: string;
}

/** unified-flow 응답 페이로드(서버 SSoT). enrichUnifiedFlow 산출물. */
export interface UnifiedFlowPayload {
  nodes: RawFlowNode[];
  edges: RawFlowEdge[];
  columns?: FlowColumn[];
  meta?: { centerName?: string };
}

/**
 * xyflow 노드 data — PositionedNode 의 표시 필드(좌표 x/y 제외, position 으로 분리) + index signature.
 *   xyflow Node<T extends Record<string, unknown>> 제약을 만족하도록 교차로 index signature 를 부여한다.
 */
export type FlowNodeData = Omit<PositionedNode, 'x' | 'y' | '_expanded'> & {
  /** 하이라이트 경로(.node.is-highlighted) — 본체가 BFS 결과로 주입. */
  highlighted?: boolean;
  [k: string]: unknown;
};

/** xyflow 엣지 data — 표시 className 결정용 메타. */
export interface FlowEdgeData extends Record<string, unknown> {
  /** 소문자 엣지 종류(.edge-call / .edge-after). */
  edgeType: string;
  /** 강도(.is-strength-*) — 없으면 미부여. */
  strength?: string;
  /** 하이라이트 경로(.is-highlighted) — 본체가 BFS 결과로 주입(Task 5). */
  highlighted?: boolean;
  /** 흐름 애니메이션(.is-flowing) — 선택 경로 엣지에만(본체 주입). */
  flowing?: boolean;
}

export type FlowCardNode = Node<FlowNodeData, 'card'>;
export type FlowFlowEdge = Edge<FlowEdgeData>;

/** card 노드 타입 키(nodeTypes 등록 키 SSoT). */
export const FLOW_NODE_TYPE = 'card';
/** flow 엣지 타입 키(edgeTypes 등록 키 SSoT). */
export const FLOW_EDGE_TYPE = 'flow';

/**
 * payload → xyflow 노드. computePositions(컬럼 기반 초기 좌표) 결과를 position+data 로 분해.
 *   columns 미존재/빈 경우 빈 배열(컬럼 매핑 안 된 노드는 computePositions 가 이미 제외).
 */
export function toFlowNodes(payload: UnifiedFlowPayload): FlowCardNode[] {
  const columns = Array.isArray(payload.columns) ? payload.columns : [];
  const positioned = computePositions(payload.nodes, columns);
  return positioned.map((n) => {
    const { x, y, _expanded, ...data } = n;
    void _expanded;
    return {
      id: n.id,
      type: FLOW_NODE_TYPE,
      position: { x, y },
      data: data as FlowNodeData,
    };
  });
}

/** payload → xyflow 엣지. type 소문자화(className), strength 보존. */
export function toFlowEdges(payload: UnifiedFlowPayload): FlowFlowEdge[] {
  const edges = Array.isArray(payload.edges) ? payload.edges : [];
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: FLOW_EDGE_TYPE,
    data: {
      edgeType: String(e.type ?? 'call').toLowerCase(),
      ...(e.strength ? { strength: e.strength } : {}),
    },
  }));
}

/** flow-graph BFS 입력용 — xyflow 엣지에서 {id,source,target} 추출(하이라이트 경로 계산 SSoT 재사용). */
export function toGraphEdges(edges: ReadonlyArray<{ id: string; source: string; target: string }>): Array<{
  id: string;
  source: string;
  target: string;
}> {
  return edges.map((e) => ({ id: e.id, source: e.source, target: e.target }));
}
