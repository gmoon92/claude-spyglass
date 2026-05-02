/**
 * @spyglass/storage - SQLite storage layer for spyglass
 *
 * @example
 * ```typescript
 * import { getDatabase, createSession, getSessionById } from '@spyglass/storage';
 *
 * const db = getDatabase();
 * const sessionId = createSession(db.instance, {
 *   id: crypto.randomUUID(),
 *   project_name: 'my-project',
 *   started_at: Date.now(),
 * });
 * ```
 */

// =============================================================================
// 스키마 및 타입
// =============================================================================

export {
  // 상수
  CREATE_SESSION_TABLE,
  CREATE_REQUEST_TABLE,
  WAL_MODE_PRAGMAS,
  SCHEMA_VERSION,
  SCHEMA_META,
  // 타입
  type Session,
  type Request,
  type RequestType,
} from './schema';

// =============================================================================
// 연결 관리
// =============================================================================

export {
  SpyglassDatabase,
  getDatabase,
  closeDatabase,
  resetDatabase,
  getDefaultDbPath,
  databaseExists,
  // 타입
  type ConnectionOptions,
  type DatabaseStatus,
} from './connection';

// =============================================================================
// Session CRUD
// =============================================================================

export {
  // 생성
  createSession,
  createSessions,
  // 조회
  getSessionById,
  getAllSessions,
  getSessionsWithFilter,
  getSessionsByProject,
  getActiveSessions,
  // 수정
  updateSession,
  endSession,
  reactivateSession,
  updateSessionTokens,
  // 삭제
  deleteSession,
  deleteSessions,
  deleteOldSessions,
  // 집계
  getSessionStats,
  getProjectStats,
  // 타입
  type CreateSessionParams,
  type UpdateSessionParams,
  type SessionFilterOptions,
  type SessionQueryResult,
  type SessionStats,
  type ProjectStats,
} from './queries/session';

// =============================================================================
// Request CRUD
// =============================================================================

export {
  // 생성
  createRequest,
  createRequests,
  // 조회
  getRequestById,
  getAllRequests,
  getRequestsBySession,
  getChildRequestsByParentToolUseId,
  getChildRequestsByParents,
  getRequestsByType,
  getRequestsWithFilter,
  getTopTokenRequests,
  // 수정
  updateRequest,
  // 삭제
  deleteRequest,
  deleteRequestsBySession,
  deleteOldRequests,
  // 집계
  getRequestStats,
  getRequestStatsBySession,
  getRequestStatsByType,
  getToolStats,
  getHourlyRequestStats,
  getAvgPromptDurationMs,
  getStripStats,
  getP95DurationMs,
  getCacheStats,
  // 턴 집계
  getTurnsBySession,
  // 세션 범위 도구 성능 통계
  getSessionToolStats,
  // 타입
  type CreateRequestParams,
  type UpdateRequestParams,
  type RequestFilterOptions,
  type RequestQueryResult,
  type RequestStats,
  type TypeStats,
  type ToolStats,
  type SessionToolStats,
  type HourlyStats,
  type StripStats,
  type CacheStats,
  type TurnItem,
  type TurnToolCall,
} from './queries/request';

// =============================================================================
// Metadata
// =============================================================================

export { getMetadata, setMetadata } from './queries/metadata';

// =============================================================================
// ClaudeEvent CRUD
// =============================================================================

export {
  createEvent,
  getEventsBySession,
  getEventsByType,
  getRecentEvents,
  getEventStats,
  type ClaudeEvent,
} from './queries/event';

// =============================================================================
// Observability Metrics (UI Redesign Phase 2 — Tier 1+2+3 시각 지표)
// =============================================================================

export {
  // Tier 1
  getModelUsageStats,
  getModelCacheMatrix,
  getSessionContextUsage,
  // Tier 2
  getActivityHeatmap,
  getTurnsPerSession,
  getCompactionSessionCount,
  getActiveSessionCount,
  getAgentCallsPerSession,
  // Tier 3
  getToolCategoryRawCounts,
  getAnomalyTimeSeriesInputs,
  // 옵저빌리티 사이드바 (left-panel-observability-revamp)
  getBurnRateBuckets,
  getCacheTrendBuckets,
  // 타입
  type ModelUsageRow,
  type ModelCacheMatrixRow,
  type SessionContextUsageRow,
  type ActivityHeatmapRow,
  type TurnsPerSessionRow,
  type ToolCategoryRawRow,
  type AnomalyInputRow,
  type BurnRateBucketRow,
  type CacheTrendBucketRow,
} from './queries/metrics';

// =============================================================================
// 가격 관리
// =============================================================================

export {
  loadPricing,
  getPricingForModel,
  resetPricingCache,
  // 타입
  type ModelPricingEntry,
  type ModelPricing,
} from './pricing';

// =============================================================================
// Proxy Request CRUD (HTTP 레벨 메트릭)
// =============================================================================

export {
  createProxyRequest,
  getRecentProxyRequests,
  getProxyRequestById,
  getProxyStats,
  getLatestProxyResponseBefore,
  type ProxyRequest,
  type CreateProxyRequestParams,
  type ProxyStats,
  type LatestProxyResponse,
} from './queries/proxy';

// =============================================================================
// System Prompt Catalog (v22 — content-addressable dedup)
// =============================================================================

export {
  upsertSystemPrompt,
  getSystemPromptByHash,
  listSystemPrompts,
  type SystemPromptRow,
  type SystemPromptSummary,
  type UpsertSystemPromptParams,
  type SystemPromptOrderBy,
} from './queries/system-prompt';
