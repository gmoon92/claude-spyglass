/**
 * render/cells.tsx — 테이블 셀 React 대응물 (P2-04)
 *
 * 원본: assets/js/render/cells.js (makeActionCell / targetInnerHtml / makeTargetCell / makeCacheCell).
 *
 * 전략(D형 골든마스터 — makeTargetCell 은 renderers.test.ts.snap 으로 고정):
 *  - 셀 구조(td class·data-cell·placeholder)와 Target 내부 분기(prompt/response/system/tool_call)를
 *    JSX 로 1:1 이식. 도구 아이콘은 동치 검증된 TSX ToolIcon 재사용.
 *  - 오류 배지(ToolStatusBadge)·agent-spike 배지(AgentSpikeBadge)는 React 컴포넌트로 직접 렌더
 *    (B-2: dangerouslySetInnerHTML 제거). 판정 SSoT 는 lib/anomaly-field·tool-status-field(순수).
 *  - shortModelName/escHtml 도 원본 formatters SSoT 재사용.
 *
 * @module render/cells
 */
import type { ReactElement, ReactNode } from 'react';
import { fmtToken, shortModelName } from '../../lib/formatters';
import { ToolIcon } from './badges';
import { ToolStatusBadge } from './tool-status-badge';
import { AgentSpikeBadge } from './anomaly-badges';
import { ToolDot } from '../design-system/icons';

interface RowLike {
  type?: string | null;
  tool_name?: string | null;
  tool_detail?: string | null;
  model?: string | null;
  event_type?: string | null;
  agent_spike?: unknown;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
  [k: string]: unknown;
}

/** 액션 셀 내부(배지) — 원본 cells.js#makeActionCell → TypeBadge. */
export { TypeBadge as ActionBadge } from './badges';

/**
 * Target 셀 내부 — 원본 cells.js#targetInnerHtml.
 * prompt/response/system 은 role-icon(ToolDot) + 라벨. tool_call 은 ToolIcon + 이름(+Skill/Agent detail).
 * tool_call 인데 tool_name 없으면 empty('—').
 *
 * 반환: { node, empty } — empty=true 면 셀이 '—' placeholder.
 */
export function targetInner(r: RowLike): { node: ReactNode; empty: boolean } {
  if (r.type === 'prompt') {
    return {
      node: (
        <span className="target-cell-inner target-role-user">
          <span className="action-name">
            <ToolDot size={12} />
            user
          </span>
        </span>
      ),
      empty: false,
    };
  }
  if (r.type === 'response') {
    return {
      node: (
        <span className="target-cell-inner target-role-assistant">
          <span className="action-name">
            <ToolDot size={12} />
            assistant
          </span>
        </span>
      ),
      empty: false,
    };
  }
  if (r.type === 'system') {
    return {
      node: (
        <span className="target-cell-inner target-role-system">
          <span className="action-name">
            <ToolDot size={12} />
            system
          </span>
        </span>
      ),
      empty: false,
    };
  }
  if (r.type !== 'tool_call' || !r.tool_name) {
    return { node: '—', empty: true };
  }
  const inProgress = r.event_type === 'pre_tool';
  const toolName = r.tool_name;
  let nameNode: ReactNode;
  if ((toolName === 'Skill' || toolName === 'Agent') && r.tool_detail) {
    const ms = shortModelName(r.model ?? null);
    // 원본: `${toolName}(<span class="action-sub-name">${detail}</span>)${modelBadge}`.
    // 원본은 detail 앞 '(' 와 modelBadge 앞 ' '(공백) 을 텍스트로 둔다. React 텍스트로 동치.
    nameNode = (
      <span className="action-name">
        <ToolIcon toolName={toolName} eventType={r.event_type ?? null} />
        {toolName}(<span className="action-sub-name">{r.tool_detail}</span>)
        {ms ? <> <span className="action-model">{ms}</span></> : null}
      </span>
    );
  } else {
    nameNode = (
      <span className="action-name">
        <ToolIcon toolName={toolName} eventType={r.event_type ?? null} />
        {toolName}
      </span>
    );
  }
  return {
    node: (
      <span className="target-cell-inner">
        {nameNode}
        {inProgress ? null : <ToolStatusBadge r={r} />}
        <AgentSpikeBadge agentSpike={r.agent_spike} />
      </span>
    ),
    empty: false,
  };
}

/** Target 셀 — 원본 cells.js#makeTargetCell. (골든마스터: makeTargetCell 5종) */
export function TargetCell({ r }: { r: RowLike }): ReactElement {
  const { node, empty } = targetInner(r);
  return empty ? (
    <td className="cell-target cell-empty" data-cell="target">
      {node}
    </td>
  ) : (
    <td className="cell-target" data-cell="target">
      {node}
    </td>
  );
}

/** Cache 셀 — 원본 cells.js#makeCacheCell. */
export function CacheCell({ r }: { r: RowLike }): ReactElement {
  if (r.type !== 'prompt' || !r.cache_read_tokens || r.cache_read_tokens <= 0) {
    return (
      <td className="cell-token num cell-empty" data-cell="cache">
        —
      </td>
    );
  }
  const readVal = r.cache_read_tokens;
  const writeVal = r.cache_creation_tokens || 0;
  return (
    <td
      className="cell-token num cache-cell"
      data-cell="cache"
      data-cache-read={readVal}
      data-cache-write={writeVal}
    >
      {fmtToken(readVal)}
    </td>
  );
}
