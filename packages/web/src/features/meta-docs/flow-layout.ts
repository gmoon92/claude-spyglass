/**
 * features/meta-docs/flow-layout.ts — column 좌표 부여 + 콘텐츠 bbox 순수 (P4-03)
 *
 * 원본: assets/js/meta-docs-flow.js LAYOUT 상수 + computePositions/contentBBox(flow.js:89,318,1142)를
 *   순수 함수로 1:1 추출. unified-flow payload → viewport 좌표 부여 노드. DOM 무관(arch §4.2).
 *   자연폭 재측정(resizeNodeToContent, offsetWidth 의존)은 명령형이라 MetaDocsFlow effect 잔류.
 *
 * @module features/meta-docs/flow-layout
 */

/** 레이아웃 SSoT — 원본 flow.js:89 LAYOUT 1:1. */
export const LAYOUT = {
  /** layer 간 수직 간격 (px). */
  layerGapY: 140,
  /** 노드 카드 폭/높이. */
  nodeW: 180,
  nodeH: 56,
  /** 컬럼(시간/인과 깊이) 간 수평 간격. */
  colGap: 100,
  /** 좌측 여백. */
  leftPad: 80,
  /** 상단 여백. */
  topPad: 60,
} as const;

/** unified-flow 응답 노드(raw). data 는 enrich 부착 필드. */
export interface RawFlowNode {
  id: string;
  type?: string;
  data?: {
    kind?: string;
    name?: string;
    depth?: number;
    layerTone?: number;
    tool_use_id?: string;
    started_at?: number;
    count?: number;
    pct?: number;
    invocations?: number;
    timeline?: string;
    subRows?: Array<{ fullName: string; toolName: string; count: number; pct: number }>;
    pills?: string[];
  };
}

export interface FlowColumn {
  nodeIds: string[];
}

export interface PositionedNode {
  id: string;
  kind: string;
  type?: string;
  title: string;
  depth: number;
  column: number;
  slot: number;
  layerTone: number;
  tool_use_id?: string;
  started_at?: number;
  count?: number;
  pct?: number;
  invocations?: number;
  timeline?: string;
  subRows?: Array<{ fullName: string; toolName: string; count: number; pct: number }>;
  pills?: string[];
  x: number;
  y: number;
  w: number;
  h: number;
  _expanded?: boolean;
}

export interface ContentBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * unified-flow 응답을 viewport 좌표가 부여된 노드로 정규화. (flow.js:318)
 *  - columns[i].nodeIds 인덱스 = column 인덱스 = x 컬럼.
 *  - 컬럼 내 nodeIds 순서 = count DESC 슬롯(위→아래).
 *  - 컬럼 매핑 안 된 노드 제외(flow.js:325).
 */
export function computePositions(rawNodes: RawFlowNode[], columns: FlowColumn[]): PositionedNode[] {
  const colOf = new Map<string, { colIdx: number; slotIdx: number }>();
  columns.forEach((col, colIdx) => {
    col.nodeIds.forEach((id, slotIdx) => colOf.set(id, { colIdx, slotIdx }));
  });

  return rawNodes
    .filter((n) => colOf.has(n.id))
    .map((n) => {
      const co = colOf.get(n.id)!;
      const d = n.data ?? {};
      return {
        id: n.id,
        kind: d.kind ?? n.type ?? 'tool',
        type: n.type,
        title: d.name ?? '?',
        depth: d.depth ?? 0,
        column: co.colIdx,
        slot: co.slotIdx,
        layerTone: typeof d.layerTone === 'number' ? d.layerTone : 0,
        tool_use_id: d.tool_use_id,
        started_at: d.started_at,
        count: d.count,
        pct: d.pct,
        invocations: d.invocations,
        timeline: d.timeline,
        subRows: Array.isArray(d.subRows) ? d.subRows.map((r) => ({ ...r })) : undefined,
        pills: Array.isArray(d.pills) ? d.pills.slice() : undefined,
        x: LAYOUT.leftPad + co.colIdx * (LAYOUT.nodeW + LAYOUT.colGap),
        y: LAYOUT.topPad + co.slotIdx * LAYOUT.layerGapY,
        w: LAYOUT.nodeW,
        h: LAYOUT.nodeH,
        _expanded: true,
      } as PositionedNode;
    });
}

/** 컬럼 내 노드 수직 간격(px) — 구 MetaDocsFlow 재배치 루프의 `cursorY += h + 12` 상수. */
export const NODE_GAP_Y = 12;

/** 측정된 노드 크기(px) — xyflow ResizeObserver 측정값(node.measured) 주입용. */
export interface MeasuredSize {
  w: number;
  h: number;
}

/**
 * 자연폭 측정 후 컬럼 x 재배치 — 구 MetaDocsFlow.tsx:591-617 명령형 루프의 순수 추출(xyflow 재작성).
 *
 *  - 컬럼(layers[i])마다 측정 width 의 최대값(colMaxW, 최소 LAYOUT.nodeW)을 구해 다음 컬럼 x 를 민다
 *    (자연폭이 넓은 카드가 다음 컬럼을 침범하지 않게 — 구 동치).
 *  - 컬럼 내 노드는 위→아래로 측정 height + NODE_GAP_Y 누적 배치.
 *  - 측정값이 없는 노드는 LAYOUT.nodeW/nodeH 기본값 사용(측정 전/누락 안전).
 *  - 반환: id → {x,y}. 본체가 xyflow setNodes(position) 로 반영. (totalMaxBottom/viewBox 는 fitView 가 대체.)
 *
 * @param layers   컬럼별 노드 id 배열(columns.map(c => c.nodeIds)).
 * @param measured 노드 id → 측정 크기. 동기 offsetWidth 루프(layout thrashing) 대신 xyflow 측정 주입.
 */
export function reflowColumns(
  layers: ReadonlyArray<ReadonlyArray<string>>,
  measured: ReadonlyMap<string, MeasuredSize>,
): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  let cursorX: number = LAYOUT.leftPad;
  for (const ids of layers) {
    let colMaxW: number = LAYOUT.nodeW;
    for (const id of ids) {
      const m = measured.get(id);
      if (m && m.w > colMaxW) colMaxW = m.w;
    }
    let cursorY = LAYOUT.topPad;
    for (const id of ids) {
      pos.set(id, { x: cursorX, y: cursorY });
      const m = measured.get(id);
      cursorY += (m?.h ?? LAYOUT.nodeH) + NODE_GAP_Y;
    }
    cursorX += colMaxW + LAYOUT.colGap;
  }
  return pos;
}

/**
 * 노드 geometry 직접 합집합으로 콘텐츠 경계(SVG 좌표) 계산. (flow.js:1142)
 * getBBox(foreignObject) 의 브라우저 편차 회피 — 레이아웃 단계 확정값 사용.
 */
export function contentBBox(nodes: Array<Pick<PositionedNode, 'x' | 'y' | 'w' | 'h'>>): ContentBox | null {
  if (!nodes.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + n.w > maxX) maxX = n.x + n.w;
    if (n.y + n.h > maxY) maxY = n.y + n.h;
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
