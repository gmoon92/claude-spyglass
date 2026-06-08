/**
 * features/session-detail/FlowPane.tsx — flow-pane 조립체 (P3-06 진입점 컴포넌트)
 *
 * 원본 골격: assets/js/session-detail/turn-views.js#renderTurnCards 의 flow-pane <section>
 *  (turn-views.js:982-999) + renderActiveTurn 의 spine/flow-head 동기(turn-views.js:705-745).
 *
 * 책임(SessionLog.flowPane 슬롯 SSoT):
 *  - PrologueCard(turn_id NULL 행) → FlowHead(활성 턴 메타 + fhExtra=리마인더+spike) → TurnSpine.
 *  - renderTurnCards 의 명령형 골격 멱등 주입(turn-views.js:979-1032)·view-transition(727-742)·
 *    expand 캡처 복원(renderLogPane)은 **폐기** — React 가 골격을 선언적으로 보유(§3.2-2,3,4).
 *
 * SSoT 재사용(재구현 금지):
 *  - 칩/스파인 → Chip/ChipFlow/TurnSpine(turn-spine-equivalence 게이트로 oracle 동치 보증).
 *  - spike summary → render/anomaly-badges.tsx#TurnSpikeSummary(React 컴포넌트, B-2) — 판정 SSoT 는
 *    lib/anomaly-field, sparkline 마크업은 컴포넌트 내부 1:1 재현.
 *  - 리마인더 칩 → SystemReminderChip.
 *
 * 활성 턴 결정/집계는 상위(이식 후 useSessionDetailData 훅/스토어)가 책임진다 — 본 컴포넌트는
 *  주어진 turns/activeTurnId/파생 메타를 선언적으로 렌더한다(명령형 진입점 renderTurnCards 의 분해 산물).
 *
 * @module features/session-detail/FlowPane
 */
import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { TurnSpikeSummary } from '../../components/render/anomaly-badges';
import { FlowHead } from './FlowHead';
import { TurnSpine } from './TurnSpine';
import { PrologueCard } from './PrologueCard';
import { SystemReminderChip } from './SystemReminderChip';
import { installChipDelegation, type ChipJumpRefs } from './chip-jump';

interface TurnLike {
  turn_id: string;
  turn_index: number;
  prompt?: { preview?: string } | null;
  summary?: Record<string, number> | null;
  [k: string]: unknown;
}

interface FlowPaneProps {
  /** 보여줄 턴 목록(필터 결과). */
  turns: TurnLike[];
  /** 현재 활성 턴 ID. */
  activeTurnId: string | null;
  /** 세션 누적 토큰(비용 % 산출). */
  sessionTotalTokens: number;
  /** 프롤로그 행(turn_id NULL). */
  prologue?: Record<string, unknown>[] | null;
  /** 활성 턴 신규 reminder 본문(computeNewRemindersByTurn). */
  activeReminders?: string[];
  /** 활성 턴 agent_spike 객체(없으면 미노출). */
  agentSpike?: unknown;
  /** spike sparkline 샘플(자식 토큰 시계열). */
  spikeSamples?: number[];
  /** 비활성 마커 클릭 → 활성 턴 전환 위임(원본 main.js:803-804 toggleTurn). */
  onMarkerClick?: (turnId: string) => void;
  /** 칩 점프 탐색 ref 스코프(DetailView 제공) — 전역 DOM 조회 대체. */
  chipRefs: ChipJumpRefs;
}

/**
 * flow-pane 조립체. SessionLog 의 flowPane prop 으로 주입된다.
 */
export function FlowPane({
  turns,
  activeTurnId,
  sessionTotalTokens,
  prologue = null,
  activeReminders = [],
  agentSpike = null,
  spikeSamples = [],
  onMarkerClick,
  chipRefs,
}: FlowPaneProps): ReactElement {
  const { t } = useTranslation();
  // 활성 턴 선형 탐색 — 활성 턴/턴목록 불변 시 재탐색 생략(턴 20+ 세션에서 매 렌더 O(n) 회피).
  const activeTurn = useMemo(
    () => turns.find((t) => t.turn_id === activeTurnId) ?? null,
    [turns, activeTurnId],
  );
  const summaryLabel = t('session:session-detail.turn-views.meta-tool-count', { count: turns.length });

  // 칩 클릭 위임 — 원본 main.js#initChipActivationDelegation 대응. flow-pane section 한 곳에 1회 부착해
  //   turn-spine / flow-head 안 모든 [data-chip-key] 칩 클릭을 단일 핸들러로 처리(행 점프 + flash + 펼침).
  const flowRef = useRef<HTMLElement | null>(null);
  useEffect(() => installChipDelegation(flowRef.current, chipRefs), [chipRefs]);

  const extra = (
    <>
      {activeTurn ? <SystemReminderChip turnIndex={activeTurn.turn_index} reminders={activeReminders} /> : null}
      {activeTurn ? <TurnSpikeSummary agentSpike={agentSpike} samples={spikeSamples} /> : null}
    </>
  );

  return (
    <>
      <PrologueCard prologue={prologue as never} />
      <section
        ref={flowRef}
        className="flow-pane"
        aria-label={t('session:session-detail.turn-views.prologue-aria')}
        data-region="flow"
      >
        <FlowHead activeTurn={activeTurn} sessionTotalTokens={sessionTotalTokens} extra={extra} />
        <div className="turn-spine" id="turnSpine" role="tablist" aria-label={summaryLabel}>
          <TurnSpine turns={turns} activeTurnId={activeTurnId} onMarkerClick={onMarkerClick} />
        </div>
      </section>
    </>
  );
}
