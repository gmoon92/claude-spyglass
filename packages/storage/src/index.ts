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
// Migrator — 마이그레이션 실행 + 결과 회수 (auto-update-migration-hardening)
// =============================================================================

export {
  runMigrations,
  getLastMigrationRun,
  getLatestMigrationFile,
  detectMigrationLag,
  parseMigrationVersion,
  type MigrationRunResult,
  type MigrationLag,
} from './migrator';

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
  deleteOldData,
  // 집계
  getSessionStats,
  getProjectStats,
  // LIVE 술어 SSoT
  LIVE_STALE_THRESHOLD_MS,
  // 타입
  type CreateSessionParams,
  type UpdateSessionParams,
  type SessionFilterOptions,
  type SessionQueryResult,
  type SessionStats,
  type ProjectStats,
} from './queries/session';

// =============================================================================
// Session Status — 도메인 결과 함수 SSoT (visible/LIVE 정의 통일)
// 새 라우트는 queries/* 가 아닌 이쪽을 우선 사용. queries/session/{read,aggregate}.ts는
// 외부 시그니처 호환을 위한 thin wrapper.
// =============================================================================

export {
  countLiveSessions,
  countVisibleSessions,
  listLiveSessions,
  listVisibleSessions,
  aggregateSessionStatus,
  aggregateProjectStatus,
  type SessionStatusFilter,
  type SessionStatusAggregate,
  type ProjectStatusMetrics,
} from './domain/session-status';

// =============================================================================
// Request CRUD
// =============================================================================

export {
  // 생성
  createRequest,
  createRequests,
  // R3: payload 인코딩 헬퍼(raw INSERT/UPDATE 경로에서 동일 정책 적용용)
  encodeRequestPayload,
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
  countTurnsForSession,
  getOrphanRowsBySession,
  // 세션 범위 도구 성능 통계
  getSessionToolStats,
  // 프로젝트 범위 도구 성능 통계 (ADR-004 meta-docs-tool-stats)
  getProjectToolStats,
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
// Proxy 통계 (proxy-hourly — stats_proxy_hourly 사전 집계 기반)
// =============================================================================

export {
  getProxyHourlyStats,
  getProxyHourlyStatsByModel,
  type ProxyHourlyStats,
  type ProxyHourlyStatsByModel,
} from './queries/proxy-stats';

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
  getProxyRequestsBySession,
  getProxyRequestsBySystemHash,
  getProxyRequestById,
  getProxyStats,
  getLatestProxyResponseBefore,
  getMaxContextProxyForSession,
  // anomaly-bloated-sys (Migration 033/034): 세션 system context 메타 조회
  getSessionSystemContextMeta,
  // ADR-001 P1-E (v23): tool_use_id ↔ api_request_id 정확 매핑
  persistProxyToolUses,
  getProxyToolUseById,
  getProxyResponseByApiRequestId,
  backfillRequestApiRequestIdByToolUse,
  type ProxyRequest,
  type CreateProxyRequestParams,
  type ProxyStats,
  type LatestProxyResponse,
  type ProxyToolUse,
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

// =============================================================================
// Meta Document Catalog (v24 — Migration 024)
// =============================================================================

// migration-plan §B: SQLite ego BFS (`getMetaFlowEgo` + MetaFlowEgo* 타입) 는
// `@spyglass/storage-graph` 의 `getUnifiedFlow` 로 대체됨. 카탈로그 + aggregate 만 유지.
export {
  upsertMetaDocument,
  markMissingAsDeleted,
  softDeleteBySourceRoot,
  replaceResolutionsForCwd,
  listMetaDocsWithUsage,
  getMetaDocByFilePath,
  countMetaDocs,
  getMetaFlowAggregate,
  type MetaDocType,
  type MetaDocSource,
  type MetaDocumentRow,
  type UpsertMetaDocParams,
  type MetaDocUsageRow,
  type ListMetaDocsFilter,
  type MetaFlowAggregate,
  type MetaFlowFilter,
} from './queries/meta-document';

// =============================================================================
// 모델 한도 (Migration 026 — SSoT for context window mapping)
// =============================================================================

export {
  getAllModelLimits as getAllModelLimitsFromDb,
  getObservedMaxContextForModel,
  type ModelLimitRow,
} from './queries/model-limits';

// =============================================================================
// 모델 한도 추론 (T02 선반출 — 헤더/suffix 우선순위 + 시드·관측 결합 정책)
// raw `getAllModelLimitsFromDb`(위)와 달리 추론 wrapper. 소비처: metrics, routes/sessions.
// =============================================================================

export {
  getModelMaxTokens,
  getAllModelLimits,
  invalidateModelLimitsCache,
  DEFAULT_MAX_TOKENS,
  EXTENDED_MAX_TOKENS,
} from './domain/model-limits';

// =============================================================================
// Anomaly Thresholds (T02 선반출 — Migration 033 bloated-sys / agent-spike 임계 정책)
// 소비처: metrics/calculators/anomaly, cli/analyze.
// =============================================================================

export {
  getAnomalyThresholds,
  getAllAnomalyThresholds,
  invalidateAnomalyThresholdsCache,
  DEFAULT_ANOMALY_THRESHOLDS,
  type AnomalyThresholds,
} from './queries/anomaly-thresholds';

// =============================================================================
// Retention 정책 (SQLite + Graph 공통 SoT — packages/storage-graph 도 본 모듈 참조)
// =============================================================================

export {
  DEFAULT_RETENTION_DAYS,
  getRetentionDays,
  getRetentionCutoffTs,
  DEFAULT_RAW_LOG_RETENTION_DAYS,
  getRawLogRetentionDays,
  getRawLogRetentionCutoffTs,
} from './runtime/retention';

// 디스크 가드 (서버 diag-log·maintenance + hook 이 동일 임계치 참조하는 SoT)
export {
  DEFAULT_DISK_MIN_FREE_MB,
  DEFAULT_DISK_WARN_FREE_MB,
  getDiskMinFreeBytes,
  getDiskWarnFreeBytes,
  getDiskFreeBytes,
  getDiskStatus,
  shouldSuppressNonEssentialWrites,
} from './runtime/disk-space';
export type { DiskStatus, DiskSpaceReport } from './runtime/disk-space';

// =============================================================================
// At-rest 컬럼 암호화 (R3) — AES-256-GCM + payload_algo 분기 codec SSoT
// 소비처: 본문 컬럼(payload/content) 쓰기·읽기 전 경로. 기본 OFF(옵트인).
// =============================================================================

export {
  isEncryptionEnabled,
  resolveEncryptionKey,
  generateKey,
  parseKeyBase64,
  encryptBytes,
  decryptBytes,
  defaultKeyFilePath,
  type ResolveKeyOptions,
} from './crypto';

export {
  encodeText,
  decodeText,
  encodeBlob,
  decodeBlob,
  type PayloadAlgo,
} from './payload-codec';

export {
  getActiveKey,
  shouldEncrypt,
  resetEncryptionRuntime,
} from './runtime/encryption';
