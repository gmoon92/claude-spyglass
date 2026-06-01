/**
 * features/session-detail/DetailView.tsx — 세션 상세 조립체 (P3-07 진입점)
 *
 * 원본: assets/js/views/detail-view.js#loadSession (세션 헤더 텍스트/뱃지 + body) +
 *   turn-views.js#renderTurnCards 가 주입하던 flow-pane/log-pane 골격.
 * 조립 대상:
 *  - P3-06 FlowPane(turn-spine/flow-head/chip/reminder) + P3-05 SessionLog(9컬럼 log-pane).
 *  - P3-06 SessionBadges(헤더 집계 뱃지) — onBloatedSysHeader 콜백 주입으로 순환 차단.
 *
 * ★순환 해소(P3-04 §5, 본 task 핵심)★:
 *  - 원본 turn-views.js:60 → views/detail-view.js#applyBloatedSysHeader 직접 import,
 *    detail-view.js:12 → 루트 facade → index → re-export turn-views 로 모듈 순환.
 *  - DetailView 는 views/detail-view.js·turn-views.js·루트 facade 를 **import 하지 않는다**.
 *    bloated-sys 헤더 재부착은 SessionBadges 의 onBloatedSysHeader 콜백(store action 어댑터)으로
 *    호출부가 주입 → import 그래프에서 turn-views↔detail-view 간선 소멸.
 *  - 헤더 뱃지 자체는 SessionDetailHeader 가 badges.js HTML SSoT 를 선언적으로 렌더(DOM 변이 폐기).
 *
 * 비책임(상위/슬롯):
 *  - 세션 선택/AbortController/탭 전환·skeleton 등 명령형 부수효과 → useSessionLoad(detail-view.ts) +
 *    이식 후 라우터/스토어. 본 컴포넌트는 주어진 turns/activeTurnId/세션 메타를 선언적으로 렌더.
 *  - col-resize 보존 등 표 골격 가드 → SessionLog 가 소유(§4.2).
 *
 * @module features/session-detail/DetailView
 */
import type { ReactElement } from 'react';
import { fmtToken, fmtDate } from '../../../assets/js/formatters.js';
import { bloatedSysBadgeFullHtml, contextSaturationBadgeFullHtml } from '../../../assets/js/render/badges.js';
import { SessionLog } from './SessionLog';
import { FlowPane } from './FlowPane';
import { SessionBadges } from './SessionBadges';

declare const window: { I18n: { t: (key: string, vars?: Record<string, unknown>) => string } };

interface TurnLike {
  turn_id: string;
  turn_index: number;
  prompt?: { preview?: string } | null;
  summary?: Record<string, number> | null;
  tool_calls?: { tool_name?: string }[];
  [k: string]: unknown;
}

interface SessionDetailHeaderProps {
  sessionId: string;
  projectName?: string | null;
  totalTokens?: number | null;
  endedAt?: string | number | null;
  /** 단건 fetch 도착 anomaly — 미도착이면 null(뱃지 미렌더). */
  bloatedSys?: unknown;
  contextSaturation?: unknown;
  turnCount?: number | null;
}

/** badges.js HTML SSoT 안전 주입 — 빈 문자열이면 미렌더. */
function BadgeHtml({ html }: { html: string }): ReactElement | null {
  if (!html) return null;
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * 세션 상세 헤더 — 원본 loadSession 의 헤더 텍스트(:59-64) + applyBloatedSysHeader(:166)/
 * applyContextSaturationHeader(:141) 의 DOM 변이를 선언적 렌더로 대체.
 *  - id 8자 + … / project / total-tokens / ended-at.
 *  - #detailBadges: bloated-sys full + context-saturation full + turn-count(>=20) 힌트.
 *    (값 미도착이면 빈 골격 유지 — 원본도 빈 문자열 → 자연 미노출.)
 */
export function SessionDetailHeader({
  sessionId,
  projectName = '',
  totalTokens = null,
  endedAt = null,
  bloatedSys = null,
  contextSaturation = null,
  turnCount = null,
}: SessionDetailHeaderProps): ReactElement {
  const bloatedHtml = bloatedSysBadgeFullHtml(bloatedSys) || '';
  const ctxSatHtml = contextSaturationBadgeFullHtml(contextSaturation) || '';
  const showTurnHint = Number.isFinite(turnCount) && (turnCount as number) >= 20;
  const turnHint = showTurnHint
    ? window.I18n.t('ui.detail-view.turn-count-hint', { count: turnCount as number })
    : '';
  const badgesHidden = !bloatedHtml && !ctxSatHtml && !showTurnHint;

  return (
    <div className="detail-header">
      <span id="detailSessionId" title={sessionId}>
        {sessionId.slice(0, 8)}…
      </span>
      <span id="detailProject">{projectName ?? ''}</span>
      <span id="detailTokens">
        {totalTokens != null
          ? window.I18n.t('ui.detail-view.total-tokens', { tokens: fmtToken(totalTokens) })
          : ''}
      </span>
      <span id="detailEndedAt">
        {endedAt ? window.I18n.t('ui.detail-view.ended-at', { time: fmtDate(endedAt) }) : ''}
      </span>
      <div
        id="detailBadges"
        className={badgesHidden ? 'detail-agg-badges detail-agg-badges--hidden' : 'detail-agg-badges'}
      >
        <BadgeHtml html={bloatedHtml} />
        <BadgeHtml html={ctxSatHtml} />
        {showTurnHint ? (
          <span
            className="badge-turn-count--hint ds-badge"
            data-tone="muted"
            data-turn-count={turnCount as number}
            title={turnHint}
            aria-label={turnHint}
          >
            ⟲ {turnCount as number}t
          </span>
        ) : null}
      </div>
    </div>
  );
}

interface DetailViewProps {
  sessionId: string;
  projectName?: string | null;
  totalTokens?: number | null;
  endedAt?: string | number | null;
  /** 필터 결과 턴 목록. */
  turns: TurnLike[];
  /** 현재 활성 턴 ID. */
  activeTurnId: string | null;
  /** 활성 턴(log-pane tbody). 미지정이면 turns 에서 activeTurnId 로 탐색. */
  activeTurn?: TurnLike | null;
  /** 프롤로그 행(turn_id NULL). */
  prologue?: Record<string, unknown>[] | null;
  /** 활성 턴 신규 reminder(computeNewRemindersByTurn). */
  activeReminders?: string[];
  /** 활성 턴 agent_spike + sparkline 샘플. */
  agentSpike?: unknown;
  spikeSamples?: number[];
  /** 단건 fetch 도착 anomaly(헤더 뱃지). */
  bloatedSys?: unknown;
  contextSaturation?: unknown;
  turnCount?: number | null;
  /** turn 단위 anomaly flags(log-pane). */
  anomalyFlags?: Map<string, Set<string>> | null;
  /**
   * bloated-sys 헤더 재부착 어댑터(§5 순환 차단). SessionBadges 로 위임 — 미주입이면 재부착 생략.
   * import 그래프에서 turn-views→detail-view 간선을 제거하는 핵심 가드.
   */
  onBloatedSysHeader?: (sessionId: string) => void;
  /** 비활성 마커 클릭 → 활성 턴 전환(원본 main.js:803-804 toggleTurn). FlowPane 으로 위임. */
  onMarkerClick?: (turnId: string) => void;
}

/**
 * 세션 상세 조립체. 헤더 + (FlowPane → SessionLog) body + SessionBadges(콜백 위임).
 */
export function DetailView({
  sessionId,
  projectName = '',
  totalTokens = 0,
  endedAt = null,
  turns,
  activeTurnId,
  activeTurn,
  prologue = null,
  activeReminders = [],
  agentSpike = null,
  spikeSamples = [],
  bloatedSys = null,
  contextSaturation = null,
  turnCount = null,
  anomalyFlags = null,
  onBloatedSysHeader,
  onMarkerClick,
}: DetailViewProps): ReactElement {
  const sessionTotalTokens = totalTokens ?? 0;
  const resolvedActiveTurn =
    activeTurn ?? turns.find((t) => t.turn_id === activeTurnId) ?? null;

  const flowPane = (
    <FlowPane
      turns={turns as never}
      activeTurnId={activeTurnId}
      sessionTotalTokens={sessionTotalTokens}
      prologue={prologue}
      activeReminders={activeReminders}
      agentSpike={agentSpike}
      spikeSamples={spikeSamples}
      onMarkerClick={onMarkerClick}
    />
  );

  // ★로그 영역 스크롤 복원(legacy 정합)★: 본 래퍼는 레거시 #turnUnifiedBody 다.
  //   turn-view.css `#turnUnifiedBody { flex:1; min-height:0; display:flex; flex-direction:column }`
  //   가 #detailTurnView.detail-content(flex column, overflow:hidden) 안에서 flow-pane/log-pane 의
  //   flex 축을 만든다. flow-pane=flex:0 0 auto(고정), log-pane=flex:1 1 auto + log-table-wrap
  //   overflow-y:auto(스크롤). 과거 클래스 `.detail-view` 는 어떤 CSS 도 매칭되지 않아 flex 컨텍스트가
  //   끊겨(자식 min-height:0 없음) log-table-wrap 이 스크롤되지 않았다.
  return (
    <div id="turnUnifiedBody">
      <SessionDetailHeader
        sessionId={sessionId}
        projectName={projectName}
        totalTokens={totalTokens}
        endedAt={endedAt}
        bloatedSys={bloatedSys}
        contextSaturation={contextSaturation}
        turnCount={turnCount}
      />
      {/* 헤더 집계 뱃지 + bloated-sys 재부착 콜백 위임(순환 차단). */}
      <SessionBadges
        badgeTurns={turns as never}
        sessionTotalTokens={sessionTotalTokens}
        selectedSessionId={sessionId}
        onBloatedSysHeader={onBloatedSysHeader}
      />
      <SessionLog activeTurn={resolvedActiveTurn as never} anomalyFlags={anomalyFlags} flowPane={flowPane} />
    </div>
  );
}
