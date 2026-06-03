/**
 * features/session-detail/FlowHead.tsx — 활성 턴 메타 헤더 (P3-06)
 *
 * 원본(두 군집 통합):
 *  - 골격 마크업: assets/js/session-detail/turn-views.js#renderTurnCards (turn-views.js:983-997)
 *    flow-head-row(prompt / IN / OUT / 복잡도 / 비용 + fhExtra 슬롯).
 *  - 값 갱신 로직: turn-views.js#updateFlowHead (turn-views.js:321) — 원본은 DOM id 로 setText.
 *    React 에선 props 로 받은 turn/sessionTotalTokens 를 선언적으로 렌더(DOM 변이 폐기, §3.2-2).
 *
 * 복잡도/비용 분기 1:1(turn-views.js:340-364):
 *  - 복잡도: tool_call_count > 15 → high(warn) / > 5 → mid(info) / 그 외 빈 라벨(display:none).
 *  - 비용 %: sessionTotalTokens>0 → round(total/sessionTotal*100)% / 0 → '—'.
 *
 * fhExtra 슬롯: 시스템 리마인더 칩 + spike summary 를 호출부(FlowPane)가 주입(원본 fhExtra innerHTML).
 *
 * @module features/session-detail/FlowHead
 */
import { fmtToken } from '../../lib/formatters';
import { useTranslation } from 'react-i18next';
import type { ReactElement, ReactNode } from 'react';

/** i18n 번역 함수 시그니처(react-i18next t / 레거시 window.I18n.t 공통). */
type TFn = (key: string, vars?: Record<string, unknown>) => string;

interface TurnSummary {
  tokens_input?: number;
  tokens_output?: number;
  total_tokens?: number;
  tool_call_count?: number;
}
interface TurnLike {
  prompt?: { preview?: string } | null;
  summary?: TurnSummary | null;
  [k: string]: unknown;
}

/** 복잡도 라벨/톤 — 원본 updateFlowHead(turn-views.js:340-355) 분기 1:1. t 는 호출처(컴포넌트)가 주입. */
function complexityOf(toolCount: number, t: TFn): { label: string; tone: string } {
  if (toolCount > 15) {
    return { label: t('session.session-detail.turn-views.complexity-high'), tone: 'warn' };
  }
  if (toolCount > 5) {
    return { label: t('session.session-detail.turn-views.complexity-mid'), tone: 'info' };
  }
  return { label: '', tone: 'neutral' };
}

/**
 * 활성 턴 메타 헤더(flow-head). 원본 골격 + updateFlowHead 값 분기 통합.
 *  - activeTurn 이 null 이면 빈 값(IN/OUT '—', 비용 '—') 으로 골격만 유지.
 */
export function FlowHead({
  activeTurn,
  sessionTotalTokens,
  extra,
}: {
  activeTurn: TurnLike | null | undefined;
  sessionTotalTokens: number;
  /** fhExtra 슬롯 — 리마인더 칩 + spike summary(FlowPane 주입). */
  extra?: ReactNode;
}): ReactElement {
  const { t } = useTranslation();
  const promptText = activeTurn?.prompt?.preview || '';
  const summary = activeTurn?.summary ?? null;
  const toolCount = summary?.tool_call_count || 0;
  const { label: complexityLabel, tone: complexityTone } = complexityOf(toolCount, t);
  const costPct =
    sessionTotalTokens > 0 ? `${Math.round(((summary?.total_tokens || 0) / sessionTotalTokens) * 100)}%` : '—';

  return (
    <header className="flow-head">
      <div className="flow-head-row flow-head-active" id="flowHeadActive">
        <span className="turn-line-prompt" id="fhPrompt" title={promptText}>
          {promptText}
        </span>
        <span className="turn-line-meta">
          IN <span id="fhTokIn">{activeTurn ? fmtToken(summary?.tokens_input || 0) : '—'}</span>
          <span className="meta-sep">·</span>
          OUT <span id="fhTokOut">{activeTurn ? fmtToken(summary?.tokens_output || 0) : '—'}</span>
          <span className="meta-sep">·</span>
          <span
            className="ds-badge"
            data-tone={complexityTone}
            id="fhComplexity"
            style={complexityLabel ? undefined : { display: 'none' }}
          >
            {complexityLabel}
          </span>
          <span className="meta-sep">·</span>
          <span id="fhCost">{costPct}</span>
        </span>
        <span className="flow-head-extra" id="fhExtra">
          {extra}
        </span>
      </div>
    </header>
  );
}
