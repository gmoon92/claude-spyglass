/**
 * features/meta-docs/FlowNodeCard.tsx — xyflow 커스텀 노드(메타 문서 카드) (xyflow 재작성)
 *
 * 과거 MetaDocsFlow.makeNodeFO(명령형 createElementNS/appendChild)가 만들던 .node 카드를 **JSX 컴포넌트로
 *   1:1 이식**한다. 시각 산출물(아이콘/title-row/ds-chip/sub-list/sub-row/meta-pills)·className(.is-center/
 *   .is-spoke/.is-hot/.is-after)·시간축 tone(--card-tone-layer)은 동일 — flow-diagram.css 의 .node 규칙을
 *   그대로 사용한다(자사 디자인 100% 보존). 자연폭은 xyflow 가 DOM 측정(ResizeObserver)으로 잡으므로 동기
 *   offsetWidth 루프(layout thrashing) 제거. NODE_MAX_W 상한은 CSS max-width 로 대체(is-wrapped 불필요).
 *
 * 인터랙션:
 *  - sub-row click → onRecenter({mcp, fullName})  (FlowRecenterContext 주입). nodrag 로 드래그 흡수 방지 +
 *    stopPropagation 으로 노드 클릭(하이라이트)·dblclick(재중심)과 분리.
 *  - 노드 dblclick 재중심 / 클릭 하이라이트는 본체 ReactFlow onNodeDoubleClick/onNodeClick 가 담당.
 *  - 숨김 Handle 2개(source/target, isConnectable=false) — floating edge(FlowEdge)가 useInternalNode 로
 *    노드 박스를 직접 읽어 computeEdgeD 로 path 를 그리므로 Handle 위치는 무관(연결 생성 비활성).
 *
 * @module features/meta-docs/FlowNodeCard
 */
import { createContext, memo, useContext } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { FlowCardNode } from './flow-adapter';
import type { FlowActiveRow } from './flow-types';

/** 노드 dblclick/sub-row click 재중심 콜백 주입(본체 Provider → 카드 소비). */
export const FlowRecenterContext = createContext<((row: FlowActiveRow) => void) | null>(null);

// 아이콘 + 칩 매핑 (구 MetaDocsFlow.tsx:80-88 SSoT 이관). 정적·신뢰 SVG 마크업(사용자 데이터 0).
const ICONS: Record<string, string> = {
  cmd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
  agent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="3"/><circle cx="8.5" cy="13.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="13.5" r="1.2" fill="currentColor"/><path d="M12 3v4"/><circle cx="12" cy="2.5" r="1.2" fill="currentColor"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>',
  plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21l3-3 7-7 3 3-7 7-3 0z"/><path d="M14 4l6 6"/></svg>',
};
const KIND_TO_ICON: Record<string, string> = { command: 'cmd', skill: 'book', agent: 'agent', mcp: 'plan', tool: 'cmd' };
const KIND_TO_TONE: Record<string, string> = { skill: 'skill', agent: 'agent', tool: 'neutral', mcp: 'mcp', command: 'skill' };
const KIND_TO_LABEL: Record<string, string> = { skill: 'SKILL', agent: 'AGENT', tool: 'TOOL', mcp: 'MCP', command: 'CMD' };

/** center 노드 카드의 "turns · calls/%" 꼬리말(구 makeNodeFO:310-325 산술 1:1). */
function computeSubTail(isCenter: boolean, count: number | null, pct: number | null, invocations: number | null): string | null {
  if (count === null) return null;
  if (isCenter) {
    return invocations !== null && invocations !== count ? ` · ${invocations} calls` : '';
  }
  return pct !== null ? ` · ${Math.round(pct * 1000) / 10}%` : '';
}

function FlowNodeCardImpl({ data }: NodeProps<FlowCardNode>): React.ReactElement {
  const recenter = useContext(FlowRecenterContext);
  const isCenter = data.type === 'center';
  const kind = data.kind;
  const count = typeof data.count === 'number' ? data.count : null;
  const pct = typeof data.pct === 'number' ? data.pct : null;
  const invocations = typeof data.invocations === 'number' ? data.invocations : null;
  const subTail = computeSubTail(isCenter, count, pct, invocations);
  const tone = KIND_TO_TONE[kind];
  const label = KIND_TO_LABEL[kind];

  const cls = ['node', 'node-seq'];
  cls.push(isCenter ? 'is-center' : 'is-spoke');
  if (data.depth === 1) cls.push('is-hot');
  else if (data.timeline === 'after') cls.push('is-after');
  if (data.highlighted) cls.push('is-highlighted'); // 본체 BFS 주입 — .node.is-highlighted 강조(구 foreignObject.is-highlighted 재타겟)

  return (
    <div
      className={cls.join(' ')}
      data-node-id={data.id ?? undefined}
      data-kind={kind}
      {...(!isCenter ? { 'data-clickable': '1' } : {})}
      style={typeof data.layerTone === 'number' ? ({ '--card-tone-layer': String(data.layerTone) } as React.CSSProperties) : undefined}
    >
      {/* 숨김 Handle — floating edge 앵커(연결 생성 비활성). FlowEdge 가 노드 박스를 직접 측정. */}
      <Handle type="target" position={Position.Left} isConnectable={false} style={{ opacity: 0, border: 0, width: 1, height: 1, minWidth: 0, minHeight: 0 }} />
      <Handle type="source" position={Position.Right} isConnectable={false} style={{ opacity: 0, border: 0, width: 1, height: 1, minWidth: 0, minHeight: 0 }} />

      {/* 아이콘 — 정적 신뢰 SVG(ICONS SSoT). 복잡 SVG 1:1 보존 위해 dangerouslySetInnerHTML(사용자 데이터 0 → XSS 무관). */}
      <div className="icon" dangerouslySetInnerHTML={{ __html: ICONS[KIND_TO_ICON[kind] || 'cmd'] || '' }} />

      <div className="body">
        <div className="title-row">
          <div className="title">{data.title}</div>
          {!isCenter && tone && label ? (
            <span className="ds-chip" data-tone={tone}>
              {label}
            </span>
          ) : null}
        </div>

        {subTail !== null && count !== null ? (
          <div className="sub">
            <b>{count}</b>
            {` turns${subTail}`}
          </div>
        ) : null}

        {Array.isArray(data.subRows) && data.subRows.length > 0 ? (
          <div className="sub-list">
            {data.subRows.map((r) => (
              <div
                key={r.fullName}
                className="sub-row nodrag"
                data-tool-name={r.fullName}
                onClick={(e) => {
                  e.stopPropagation();
                  recenter?.({ type: 'mcp', name: r.fullName, id: null });
                }}
              >
                <span className="sub-row-name">{r.toolName}</span>
                <span className="sub-row-stats">
                  <b>{r.count}</b>
                  {` · ${r.pct}%`}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {Array.isArray(data.pills) && data.pills.length > 0 ? (
        <span className="meta-pills">
          {data.pills.map((p) =>
            p === 'hot' ? (
              <span key="hot" className="pill-hot">
                HOT
              </span>
            ) : (
              <span key={String(p)} className="pill-live">
                {String(p)}
              </span>
            ),
          )}
        </span>
      ) : null}
    </div>
  );
}

/** memo: nodes 배열 갱신 시 변경된 노드만 재렌더(xyflow 권장). */
export const FlowNodeCard = memo(FlowNodeCardImpl);
