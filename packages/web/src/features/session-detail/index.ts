/**
 * features/session-detail/index.ts — barrel (P3-05·P3-06)
 *
 * flat-view.js → SessionLog + computeDetailFilterResult(selector)
 * turn-rows.js → TurnRows (chipKey SSoT 는 turn-rows.js export 재사용, 재구현 없음)
 * turn-views.js(1117) → 턴 카드 서브컴포넌트 분해(P3-06):
 *   Chip/ChipFlow/TurnSpine(turn-spine 칩) · FlowHead/SystemReminderChip/PrologueCard/SessionBadges(메타)
 *   · FlowPane(조립체 = SessionLog.flowPane 슬롯) · buildTurnHaystack(검색 lib).
 *   순환(turn-views⇄detail-view)은 SessionBadges.onBloatedSysHeader 콜백으로 차단(§5).
 *
 * @module features/session-detail
 */
export { SessionLog, LOG_TABLE_COLS } from './SessionLog';
export { TurnRows } from './TurnRows';
export { computeDetailFilterResult } from './filter-result';
export type { DetailFilterInput, DetailFilterResult } from './filter-result';

// P3-06 — turn-views 분해 서브컴포넌트.
export { Chip, ChipArrow, SpineArrow, type FlowItem } from './Chip';
export { ChipFlow } from './ChipFlow';
export { TurnLine, TurnSpine } from './TurnSpine';
export { FlowHead } from './FlowHead';
export { SystemReminderChip } from './SystemReminderChip';
export { PrologueCard } from './PrologueCard';
export { SessionBadges } from './SessionBadges';
export { FlowPane } from './FlowPane';
export { buildTurnHaystack, HAYSTACK_MAX, type HaystackTurn } from './turn-haystack';

// P3-07 — system-reminder*/detail-view → TSX.
//   system-reminder.js → lib/system-reminder.ts(순수, 재노출). popover → useSystemReminderPopover 훅.
//   views/detail-view.js → DetailView 조립(FlowPane+SessionLog) + useSessionLoad. 순환은
//   SessionBadges.onBloatedSysHeader 콜백 위임으로 단절(§5).
export {
  parseReminderBodies,
  computeNewRemindersByTurn,
  type ReminderTurn,
} from '../../lib/system-reminder';
export {
  useSystemReminderPopover,
  computePopoverPosition,
  createPopoverController,
  type PopoverDom,
  type PopoverElement,
  type ChipRect,
  type PopoverPosition,
} from './system-reminder-popover';
export { DetailView, SessionDetailHeader } from './DetailView';
export {
  useSessionLoad,
  parseAnomaliesResponse,
  type SessionAnomalies,
  type UseSessionLoadOptions,
} from './detail-view';

// P3-07 — 세션 상세 데이터 배선(turns fetch + 턴뷰 결선 + 상세 탭바).
//   lead 가 BrowseLayout #detailView 안에서 <SessionDetailContainer/> 로 마운트한다(DetailView 직접
//   마운트를 대체). turns 는 colocated turns-fetcher → useSessionDetail 로 흐른다.
export { SessionDetailContainer, type SessionDetailContainerProps } from './SessionDetailContainer';
export {
  useSessionDetail,
  type UseSessionDetailResult,
} from './use-session-detail';
export {
  fetchSessionTurns,
  type SessionTurnsResult,
  type TurnRow,
  type PrologueRow,
} from './turns-fetcher';
