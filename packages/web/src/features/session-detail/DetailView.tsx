/**
 * features/session-detail/DetailView.tsx — 세션 상세 조립체 (P3-07 진입점)
 *
 * 원본: assets/js/views/detail-view.js#loadSession (세션 헤더 텍스트/뱃지 + body) +
 *   turn-views.js#renderTurnCards 가 주입하던 flow-pane/log-pane 골격.
 * 조립 대상(레거시 #turnUnifiedBody 1:1):
 *  - P3-06 FlowPane(turn-spine/flow-head/chip/reminder) + P3-05 SessionLog(9컬럼 log-pane).
 *
 * ★detail-header 오포함 제거(레거시 정합)★:
 *  - 레거시 detail-view.css:2 "기존 .detail-header DOM은 제거됨. .chart-detail-meta 자손으로 동작" —
 *    세션 id/project/tokens/ended-at/집계 뱃지는 chartSection 의 `.chart-detail-meta`(BrowseLayout 소유,
 *    index.html:403-409) 가 단일 SSoT 다. 레거시 `#turnUnifiedBody`(turn-views.js:972-1012)는
 *    prologue + flow-pane + log-pane 만 담는다 — 본문 안에 detail-header/detailBadges 가 없다.
 *  - 과거 React DetailView 가 본문(#turnUnifiedBody) 안에 SessionDetailHeader(.detail-header)+SessionBadges
 *    (#detailBadges)를 함께 렌더해 (a) BrowseLayout 의 chart-detail-meta 와 id(detailSessionId/detailBadges)
 *    가 **중복**되고 (b) 두 비-flow 자식이 `#turnUnifiedBody` flex column 에 끼어 log-pane(flex:1) 의
 *    스크롤 축을 무너뜨려, 턴 뱃지 클릭으로 행 수가 늘면 log-table-wrap 이 스크롤 대신 찌그러졌다.
 *    → 본문에서 두 컴포넌트를 제거하고 레거시처럼 flow-pane + log-pane 만 남긴다.
 *  - SessionDetailHeader 컴포넌트 자체는 헤더 뱃지 선언 렌더 SSoT 로 export 유지(단독 단위 검증 대상).
 *    헤더 영역 렌더 책임은 BrowseLayout `.chart-detail-meta` 가 갖는다(본 컴포넌트 범위 밖).
 *
 * 비책임(상위/슬롯):
 *  - 세션 선택/AbortController/탭 전환·skeleton 등 명령형 부수효과 → useSessionLoad(detail-view.ts) +
 *    이식 후 라우터/스토어. 본 컴포넌트는 주어진 turns/activeTurnId/세션 메타를 선언적으로 렌더.
 *  - col-resize 보존 등 표 골격 가드 → SessionLog 가 소유(§4.2).
 *
 * @module features/session-detail/DetailView
 */
import { useMemo, useRef, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtToken, fmtDate } from '../../../assets/js/formatters.js';
import { bloatedSysBadgeFullHtml, contextSaturationBadgeFullHtml } from '../../../assets/js/render/badges.js';
import { SessionLog } from './SessionLog';
import { FlowPane } from './FlowPane';

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
  const { t } = useTranslation();
  const bloatedHtml = bloatedSysBadgeFullHtml(bloatedSys) || '';
  const ctxSatHtml = contextSaturationBadgeFullHtml(contextSaturation) || '';
  const showTurnHint = Number.isFinite(turnCount) && (turnCount as number) >= 20;
  const turnHint = showTurnHint
    ? t('ui.detail-view.turn-count-hint', { count: turnCount as number })
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
          ? t('ui.detail-view.total-tokens', { tokens: fmtToken(totalTokens) })
          : ''}
      </span>
      <span id="detailEndedAt">
        {endedAt ? t('ui.detail-view.ended-at', { time: fmtDate(endedAt) }) : ''}
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
  /** 선택 세션 id — 호출부 식별용(본문 렌더에는 미사용, 헤더는 chart-detail-meta 가 소유). */
  sessionId?: string;
  /** 세션 누적 토큰(flow-head 비용 % 산출 — FlowPane 으로 전달). */
  totalTokens?: number | null;
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
  /** turn 단위 anomaly flags(log-pane). */
  anomalyFlags?: Map<string, Set<string>> | null;
  /** 비활성 마커 클릭 → 활성 턴 전환(원본 main.js:803-804 toggleTurn). FlowPane 으로 위임. */
  onMarkerClick?: (turnId: string) => void;
}

/**
 * 세션 상세 본문 조립체 — 레거시 #turnUnifiedBody 1:1(prologue + flow-pane + log-pane).
 *  - 헤더(세션 id/project/tokens/ended-at/집계 뱃지)는 chart-detail-meta(BrowseLayout) SSoT 라
 *    본문에 포함하지 않는다(detail-header 오포함 제거 — 모듈 상단 주석 참조).
 */
export function DetailView({
  totalTokens = 0,
  turns,
  activeTurnId,
  activeTurn,
  prologue = null,
  activeReminders = [],
  agentSpike = null,
  spikeSamples = [],
  anomalyFlags = null,
  onMarkerClick,
}: DetailViewProps): ReactElement {
  const sessionTotalTokens = totalTokens ?? 0;
  const resolvedActiveTurn =
    activeTurn ?? turns.find((t) => t.turn_id === activeTurnId) ?? null;

  // 칩 점프 탐색 ref — 전역 getElementById/querySelector 대체(React 통일성). ref 는 안정값이라
  //   chipRefs 만 useMemo 로 고정하면 FlowPane 의 installChipDelegation useEffect 가 mount 1회만 돈다.
  const logBodyRef = useRef<HTMLElement | null>(null);
  const detailRootRef = useRef<HTMLDivElement | null>(null);
  const chipRefs = useMemo(() => ({ logBodyRef, detailRootRef }), []);

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
      chipRefs={chipRefs}
    />
  );

  // ★로그 영역 스크롤 복원(legacy 정합)★: 본 래퍼는 레거시 #turnUnifiedBody 다.
  //   turn-view.css `#turnUnifiedBody { flex:1; min-height:0; display:flex; flex-direction:column }`
  //   가 #detailTurnView.detail-content(flex column, overflow:hidden) 안에서 flow-pane/log-pane 의
  //   flex 축을 만든다. flow-pane=flex:0 0 auto(고정), log-pane=flex:1 1 auto + log-table-wrap
  //   overflow-y:auto(스크롤). 본문에 비-flow 자식(detail-header/detailBadges)을 끼우면 log-pane 의
  //   flex:1 분배가 어긋나 행이 많은 턴으로 전환 시 log-table-wrap 이 스크롤 대신 찌그러진다 —
  //   레거시처럼 flow-pane + log-pane 만 직계 자식으로 둔다.
  return (
    <div id="turnUnifiedBody" ref={detailRootRef}>
      <SessionLog
        activeTurn={resolvedActiveTurn as never}
        anomalyFlags={anomalyFlags}
        flowPane={flowPane}
        logBodyRef={logBodyRef}
      />
    </div>
  );
}
