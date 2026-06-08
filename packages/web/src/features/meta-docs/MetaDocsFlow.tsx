/**
 * features/meta-docs/MetaDocsFlow.tsx — 메타 문서 통합 Flow(@xyflow/react) (vanilla-js-audit 정공법 재작성)
 *
 * 구버전은 명령형 SVG(foreignObject appendChild + 동기 offsetWidth 측정 + setAttribute('viewBox') rAF
 *   줌/팬/드래그 + classList 하이라이트, 894줄)였다. 본 재작성은 @xyflow/react 선언형으로 전환하되 자사
 *   디자인을 100% 보존한다:
 *    - 노드 카드 = FlowNodeCard(구 makeNodeFO JSX 이식, .node 외형·--card-tone-layer·ds-chip·sub-row·pill 동일).
 *    - 엣지 = FlowEdge(floating, 구 computeEdgeD SSoT 그대로 — 자유 베지어 픽셀 재현).
 *    - 자연폭 = measure→layout: 노드 opacity:0 렌더 → useNodesInitialized 측정 → reflowColumns(순수) 재배치 →
 *      opacity:1 + fitView. 구 동기 offsetWidth 루프(layout thrashing) 제거 — xyflow ResizeObserver 가 측정.
 *    - 줌/팬/드래그 = xyflow 내장(구 bind 핸들러·flow-camera 폐기). 하이라이트 = flow-graph BFS → data 플래그(선언형).
 *
 * 보존 계약: Props(activeRow/project/onRecenter/depth/dateRange/t) 무변경, 컨테이너 #metaDocsFlowRegion 유지
 *   (useMetaDocsPanelResize 리사이즈 topEl 셀렉터). onRecenter 가 setActiveRow→re-fetch 체인을 구동.
 *
 * @module features/meta-docs/MetaDocsFlow
 */
import { memo, useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ReactFlow,
  ReactFlowProvider,
  Panel,
  ConnectionMode,
  useReactFlow,
  useNodesInitialized,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { FlowNodeCard, FlowRecenterContext } from './FlowNodeCard';
import { FlowEdge } from './FlowEdge';
import {
  toFlowNodes,
  toFlowEdges,
  toGraphEdges,
  FLOW_NODE_TYPE,
  FLOW_EDGE_TYPE,
  type FlowCardNode,
  type FlowFlowEdge,
  type UnifiedFlowPayload,
} from './flow-adapter';
import { reflowColumns, LAYOUT, type MeasuredSize } from './flow-layout';
import { collectFullPathNodes, collectHoverPathNodes, collectEdgesBetween, type FlowEdge as GraphEdge } from './flow-graph';
import { activeRowToFlowArgs, type FlowActiveRow, type FlowArgs } from './flow-types';

const CONTAINER_ID = 'metaDocsFlowRegion';
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

// 컴포넌트 밖 상수 — 재렌더 시 nodeTypes/edgeTypes 참조 불변(xyflow 경고/재마운트 방지).
const nodeTypes = { [FLOW_NODE_TYPE]: FlowNodeCard };
const edgeTypes = { [FLOW_EDGE_TYPE]: FlowEdge };

// activeRowToFlowArgs 는 flow-types 로 이관됨 — re-export(소비처/index 호환 보존).
export { activeRowToFlowArgs };
export type { FlowActiveRow, FlowArgs };

export interface MetaDocsFlowProps {
  /** 활성 행(catalog→flow 단방향). null = 빈 flow. effect 가 fetch+render. */
  activeRow: FlowActiveRow | null;
  /** 현재 프로젝트(fetch scope). */
  project?: string | null;
  /** 재중심 통지(dblclick/sub-row → 새 center). 호출처가 activeRow 갱신. */
  onRecenter?: (row: FlowActiveRow) => void;
  /** flow fetch depth(기본 3). */
  depth?: number;
  /** 날짜 범위(app-store.activeRange→rangeToParams). fetch fromTs/toTs 로 전파. */
  dateRange?: { from?: number; to?: number };
}

// =============================================================================
// fetch — unified-flow (구 flow.js:289 동치)
// =============================================================================
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
  return (json?.data ?? json) as UnifiedFlowPayload;
}

// =============================================================================
// 종단 상태 — 구 emptyNode/skeletonNode/errorNode JSX 이식.
// =============================================================================
function EmptyState({ centerName }: { centerName: string | null }): ReactElement {
  const { t } = useTranslation();
  const title = !centerName
    ? t('ui:meta-docs-view.flow.empty-no-center')
    : t('ui:meta-docs-view.flow.empty-zero-turns', { name: centerName });
  return (
    <div className="flow-empty flow-empty-sequential">
      <span className="flow-empty-title">{title}</span>
      <span>{t('ui:meta-docs-view.flow.empty-hint')}</span>
    </div>
  );
}

/** 화살표 marker(#flowArr) — 구 shellHtml defs 동치. context-stroke 로 엣지 색 상속. */
function FlowArrowDefs(): ReactElement {
  return (
    <svg aria-hidden="true" style={{ position: 'absolute', width: 0, height: 0 }}>
      <defs>
        <marker id="flowArr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 Z" fill="context-stroke" />
        </marker>
      </defs>
    </svg>
  );
}

// =============================================================================
// 본체(Provider 내부) — useReactFlow/useNodesInitialized 사용.
// =============================================================================
function MetaDocsFlowInner({ activeRow, project = null, onRecenter, depth = 3, dateRange }: MetaDocsFlowProps): ReactElement {
  const { t } = useTranslation();
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowCardNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowFlowEdge>([]);
  const [status, setStatus] = useState<'empty' | 'loading' | 'error' | 'ready'>('empty');
  const [errMsg, setErrMsg] = useState('');
  const [centerName, setCenterName] = useState<string | null>(null);
  const [layers, setLayers] = useState<string[][]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoverEdgeId, setHoverEdgeId] = useState<string | null>(null);
  const [laidOut, setLaidOut] = useState(false);

  // onRecenter 최신값 — effect 재구독 없이 콜백만 갱신(stale closure 방지).
  const recenterRef = useRef(onRecenter);
  recenterRef.current = onRecenter;
  const recenter = useCallback((row: FlowActiveRow) => recenterRef.current?.(row), []);

  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const nodesInitialized = useNodesInitialized();

  // ── fetch: activeRow → unified-flow → nodes/edges(opacity:0, 측정 대기) ──
  useEffect(() => {
    const args = activeRowToFlowArgs(activeRow, project, depth);
    if (!args) {
      setStatus('empty');
      setCenterName(activeRow?.name ?? null);
      setNodes([]);
      setEdges([]);
      return undefined;
    }
    let cancelled = false;
    setStatus('loading');
    setSelectedNodeId(null);
    const getDateRange = (): { from?: number; to?: number } => dateRange ?? {};
    fetchUnifiedFlow(args, getDateRange)
      .then((payload) => {
        if (cancelled) return;
        if (!payload || !Array.isArray(payload.nodes) || payload.nodes.length === 0) {
          setStatus('empty');
          setCenterName(args.centerName);
          setNodes([]);
          setEdges([]);
          return;
        }
        const fEdges = toFlowEdges(payload);
        // 측정 전 깜빡임 방지 — opacity:0 으로 렌더 후 measure→layout 패스에서 노출.
        setNodes(toFlowNodes(payload).map((n) => ({ ...n, style: { ...n.style, opacity: 0 } })));
        setEdges(fEdges);
        setLayers((Array.isArray(payload.columns) ? payload.columns : []).map((c) => c.nodeIds));
        setGraphEdges(toGraphEdges(fEdges));
        setCenterName(payload.meta?.centerName ?? args.centerName);
        setLaidOut(false);
        setStatus('ready');
      })
      .catch((err) => {
        if (!cancelled) {
          setStatus('error');
          setErrMsg((err as { message?: string })?.message ? String((err as { message: string }).message) : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
    // dateRange.from/to 원시값 deps — 기간 변경 시 재fetch(객체 참조 무관).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRow, project, depth, dateRange?.from, dateRange?.to]);

  // ── measure → layout: 측정 완료 → reflowColumns 재배치 → opacity:1 + fitView ──
  useEffect(() => {
    if (status !== 'ready' || !nodesInitialized || laidOut) return;
    const measured = new Map<string, MeasuredSize>();
    for (const n of nodes) {
      measured.set(n.id, { w: n.measured?.width ?? LAYOUT.nodeW, h: n.measured?.height ?? LAYOUT.nodeH });
    }
    const pos = reflowColumns(layers, measured);
    setNodes((nds) =>
      nds.map((n) => {
        const p = pos.get(n.id);
        return { ...n, position: p ?? n.position, style: { ...n.style, opacity: 1 } };
      }),
    );
    setLaidOut(true);
    // 배치 반영 후 화면맞춤(구 computeFitView 대체).
    requestAnimationFrame(() => {
      try {
        void fitView({ padding: 0.12, duration: 0, maxZoom: 1 });
      } catch {
        /* viewport 미준비(언마운트 경합) 무시 */
      }
    });
  }, [status, nodesInitialized, laidOut, layers, nodes, setNodes, fitView]);

  // ── 하이라이트: 선택 노드(click, 영구) 우선 → 없으면 hover 엣지(임시) → BFS path → 노드/엣지 data 플래그.
  //    선언형 — 구 applyFullPathSelection/applyEdgeHoverHighlight 동치(classList 토글 폐기). flowing 은 click 채널만.
  useEffect(() => {
    let hNodes: Set<string> | null = null;
    if (selectedNodeId) {
      hNodes = collectFullPathNodes(graphEdges, selectedNodeId);
    } else if (hoverEdgeId) {
      const e = graphEdges.find((g) => g.id === hoverEdgeId);
      if (e) hNodes = collectHoverPathNodes(graphEdges, e.source, e.target);
    }
    const hEdges = hNodes ? collectEdgesBetween(graphEdges, hNodes) : new Set<string>();
    setNodes((nds) =>
      nds.map((n) => {
        const hl = hNodes ? hNodes.has(n.id) : false;
        return n.data.highlighted === hl ? n : { ...n, data: { ...n.data, highlighted: hl } };
      }),
    );
    setEdges((eds) =>
      eds.map((e) => {
        const hl = hEdges.has(e.id);
        const flow = selectedNodeId !== null && hl; // 선택(click) 경로 엣지만 흐름 애니메이션(hover 는 강조만)
        if (e.data?.highlighted === hl && e.data?.flowing === flow) return e;
        return { ...e, data: { ...(e.data ?? { edgeType: 'call' }), highlighted: hl, flowing: flow } };
      }),
    );
  }, [selectedNodeId, hoverEdgeId, graphEdges, setNodes, setEdges]);

  // 노드 클릭 → full-path 하이라이트 토글. dblclick → 재중심(center 제외). pane → 해제.
  const onNodeClick = useCallback((_e: unknown, node: FlowCardNode) => {
    setSelectedNodeId((prev) => (prev === node.id ? null : node.id));
  }, []);
  const onNodeDoubleClick = useCallback((_e: unknown, node: FlowCardNode) => {
    if (node.data.type === 'center') return;
    setSelectedNodeId(null);
    recenterRef.current?.({ type: node.data.kind, name: node.data.title, id: null });
  }, []);
  const onPaneClick = useCallback(() => setSelectedNodeId(null), []);
  // 엣지 hover — 선택(click)이 없을 때만 임시 강조(구 edgesLayer mouseover/out 동치).
  const onEdgeMouseEnter = useCallback((_e: unknown, edge: FlowFlowEdge) => setHoverEdgeId(edge.id), []);
  const onEdgeMouseLeave = useCallback(() => setHoverEdgeId(null), []);

  const regionCls = selectedNodeId
    ? 'meta-docs-flow-region has-selection'
    : hoverEdgeId
      ? 'meta-docs-flow-region is-hovering'
      : 'meta-docs-flow-region';

  if (status === 'empty') {
    return (
      <div id={CONTAINER_ID} className="meta-docs-flow-region">
        <EmptyState centerName={centerName} />
      </div>
    );
  }
  if (status === 'loading') {
    return (
      <div id={CONTAINER_ID} className="meta-docs-flow-region">
        <div className="flow-empty">
          <span>…</span>
        </div>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div id={CONTAINER_ID} className="meta-docs-flow-region">
        <div className="flow-empty">
          <span className="flow-empty-title">{t('ui:meta-docs-view.flow.fetch-failed', { message: errMsg })}</span>
        </div>
      </div>
    );
  }

  return (
    <div id={CONTAINER_ID} className={regionCls}>
      <FlowRecenterContext.Provider value={recenter}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionMode={ConnectionMode.Loose}
          nodesConnectable={false}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onPaneClick={onPaneClick}
          onEdgeMouseEnter={onEdgeMouseEnter}
          onEdgeMouseLeave={onEdgeMouseLeave}
          minZoom={ZOOM_MIN}
          maxZoom={ZOOM_MAX}
          proOptions={{ hideAttribution: true }}
        >
          <FlowArrowDefs />
          <Panel position="top-left" className="flow-toolbar flow-toolbar-sequential">
            <span className="flow-scope">
              {t('ui:meta-docs-view.flow.scope-center')}: <b data-flow-scope-name>{centerName ?? '—'}</b>
            </span>
            <div className="flow-spacer" />
            <span className="flow-zoom-group">
              <button
                type="button"
                className="flow-zoom-btn"
                data-tip={t('ui:meta-docs-view.flow.zoom-out-title')}
                aria-label={t('ui:meta-docs-view.flow.zoom-out-title')}
                onClick={() => void zoomOut({ duration: 200 })}
              >
                −
              </button>
              <button
                type="button"
                className="flow-zoom-btn"
                data-tip={t('ui:meta-docs-view.flow.zoom-in-title')}
                aria-label={t('ui:meta-docs-view.flow.zoom-in-title')}
                onClick={() => void zoomIn({ duration: 200 })}
              >
                ＋
              </button>
            </span>
            <button
              type="button"
              className="flow-reset-btn"
              onClick={() => {
                setSelectedNodeId(null);
                void fitView({ padding: 0.12, duration: 600, maxZoom: 1 });
              }}
            >
              {t('ui:meta-docs-view.flow.reset-label')}
            </button>
          </Panel>
        </ReactFlow>
      </FlowRecenterContext.Provider>
    </div>
  );
}

/**
 * MetaDocsFlow — ReactFlowProvider 래핑(useReactFlow/useNodesInitialized 가 Provider 컨텍스트 요구).
 * memo: 부모 재렌더 시 props 불변이면 재렌더 스킵(구 동치).
 */
function MetaDocsFlowImpl(props: MetaDocsFlowProps): ReactElement {
  return (
    <ReactFlowProvider>
      <MetaDocsFlowInner {...props} />
    </ReactFlowProvider>
  );
}

export const MetaDocsFlow = memo(MetaDocsFlowImpl);
