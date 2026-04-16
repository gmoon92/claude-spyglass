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
  INIT_SCHEMA,
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
  // 타입
  type CreateRequestParams,
  type UpdateRequestParams,
  type RequestFilterOptions,
  type RequestQueryResult,
  type RequestStats,
  type TypeStats,
  type ToolStats,
  type HourlyStats,
} from './queries/request';
