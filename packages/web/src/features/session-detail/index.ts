/**
 * features/session-detail/index.ts — barrel (P3-05)
 *
 * flat-view.js → SessionLog + computeDetailFilterResult(selector)
 * turn-rows.js → TurnRows (chipKey SSoT 는 turn-rows.js export 재사용, 재구현 없음)
 *
 * @module features/session-detail
 */
export { SessionLog, LOG_TABLE_COLS } from './SessionLog';
export { TurnRows } from './TurnRows';
export { computeDetailFilterResult } from './filter-result';
export type { DetailFilterInput, DetailFilterResult } from './filter-result';
