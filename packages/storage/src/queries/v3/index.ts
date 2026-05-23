/**
 * storage-redesign-v3 query helpers — re-export hub.
 *
 * @see .claude/docs/plans/storage-redesign-v3/redesign-plan.md
 */

export {
  appendEventV3,
  getEventsAfter,
  getMaxEventId,
  getEventByEventId,
  countEventsBySession,
  type EventV3Row,
  type EventKind,
} from './events-v3';

export {
  enqueueOutboxEvent,
  claimOutboxBatch,
  markOutboxDone,
  releaseOutboxClaim,
  releaseStuckClaims,
  countOutboxPending,
  type OutboxRow,
} from './outbox';

export {
  getAllProjectionState,
  getProjectionState,
  advanceWatermark,
  recordProjectionError,
  type ProjectionStateRow,
} from './projection-state';

export {
  upsertRequestView,
  getRequestViewBySession,
  getRecentRequestView,
  countRequestView,
  type RequestViewRow,
  type UpsertRequestViewParams,
} from './request-view';

export {
  upsertTurnView,
  getTurnViewBySession,
  countTurnView,
  type TurnViewRow,
  type UpsertTurnViewParams,
} from './turn-view';

export {
  upsertAgentChainEdge,
  getDescendantsForRoot,
  sumDescendantTokens,
  getAncestorsForDescendant,
  countAgentChainView,
  type AgentChainRow,
  type UpsertAgentChainEdgeParams,
} from './agent-chain-view';
