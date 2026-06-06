/**
 * features/session-detail/SessionBadges.tsx — 세션 헤더 집계 뱃지 (P3-06)
 *
 * 원본: assets/js/session-detail/turn-views.js#updateSessionBadges (turn-views.js:839).
 *  - 최고 비용 Turn 뱃지 + 최다 호출 Tool 뱃지. sessionTotalTokens<=0 이면 hidden.
 *  - 원본은 #detailBadges DOM 에 innerHTML 주입 + applyBloatedSysHeader(detail-view.js) 호출.
 *
 * ★순환 차단(P3-04 §5, 본 task 핵심)★:
 *  - 원본 turn-views.js:60 은 `../views/detail-view.js#applyBloatedSysHeader` 를 직접 import →
 *    detail-view.js:12 가 루트 facade 를 import 하여 turn-views ⇄ detail-view 모듈 순환 발생.
 *  - 본 컴포넌트는 detail-view 를 **import 하지 않는다**. bloated-sys 헤더 재부착은
 *    `onBloatedSysHeader?: (sessionId) => void` **콜백 prop(store action 어댑터)** 로 위임한다
 *    (§5 가드 #1). 즉 헤더 갱신 책임은 호출부(detail-view/store)가 store action 으로 주입 →
 *    React import 그래프에서 turn-views→detail-view 간선이 사라져 순환이 소멸한다.
 *  - 콜백 미주입 시 bloated-sys 재부착만 생략(뱃지 본체는 정상 렌더) — P3-07 이전에도 컴파일/동작.
 *
 * @module features/session-detail/SessionBadges
 */
import { useEffect, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtToken } from '../../lib/formatters';

interface TurnSummary {
  total_tokens?: number;
}
interface TurnLike {
  turn_index: number;
  summary: TurnSummary;
  tool_calls?: { tool_name?: string }[];
}

interface SessionBadgesProps {
  /** 헤더 집계용 전체 턴(원본 bTurns). */
  badgeTurns: TurnLike[];
  /** 세션 누적 토큰(원본 sessionTotalTokens). <=0 이면 뱃지 숨김. */
  sessionTotalTokens: number;
  /** 선택된 세션 id — bloated-sys 헤더 재부착 콜백에 전달. */
  selectedSessionId?: string | null;
  /**
   * bloated-sys 헤더 재부착 어댑터(§5 순환 차단). 원본 applyBloatedSysHeader(getBloatedSysFor(sid)).
   * 미주입이면 재부착 생략 — detail-view 직접 import 를 피하는 핵심 가드.
   */
  onBloatedSysHeader?: (sessionId: string) => void;
}

/**
 * 세션 헤더 집계 뱃지. 원본 updateSessionBadges(turn-views.js:839) 동치(DOM 변이 → 선언적).
 */
export function SessionBadges({
  badgeTurns,
  sessionTotalTokens,
  selectedSessionId = null,
  onBloatedSysHeader,
}: SessionBadgesProps): ReactElement | null {
  const { t } = useTranslation();
  // bloated-sys 헤더 재부착 — 콜백으로 위임(순환 차단). 렌더 후 1회(원본 updateSessionBadges 말미).
  useEffect(() => {
    if (sessionTotalTokens > 0 && selectedSessionId && onBloatedSysHeader) {
      onBloatedSysHeader(selectedSessionId);
    }
  }, [sessionTotalTokens, selectedSessionId, onBloatedSysHeader]);

  if (sessionTotalTokens <= 0) {
    return <div id="detailBadges" className="detail-agg-badges detail-agg-badges--hidden" />;
  }

  // 최고 비용 Turn — 원본 reduce(turn-views.js:846-847).
  const maxCostTurn = badgeTurns.reduce((a, b) =>
    a.summary.total_tokens! > b.summary.total_tokens! ? a : b,
  );

  // 최다 호출 Tool — 원본 toolCountMap(turn-views.js:848-852).
  const toolCountMap: Record<string, number> = {};
  badgeTurns.forEach((t) =>
    (t.tool_calls ?? []).forEach((tc) => {
      if (tc.tool_name) toolCountMap[tc.tool_name] = (toolCountMap[tc.tool_name] || 0) + 1;
    }),
  );
  const topTool = Object.entries(toolCountMap).sort((a, b) => b[1] - a[1])[0];

  return (
    <div id="detailBadges" className="detail-agg-badges">
      <span
        className="detail-agg-badge ds-badge"
        data-tone="neutral"
        data-tip={t('session.session-detail.turn-views.max-cost-badge-title')}
      >
        {t('session.session-detail.turn-views.max-cost-badge', {
          n: maxCostTurn.turn_index,
          tokens: fmtToken(maxCostTurn.summary.total_tokens),
        })}
      </span>
      {topTool ? (
        <span
          className="detail-agg-badge ds-badge"
          data-tone="neutral"
          data-tip={t('session.session-detail.turn-views.top-tool-badge-title')}
        >
          {t('session.session-detail.turn-views.top-tool-badge', {
            name: topTool[0],
            count: topTool[1],
          })}
        </span>
      ) : null}
    </div>
  );
}
