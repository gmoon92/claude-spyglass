/**
 * Session 모듈 barrel.
 *
 * 변경 이유: 카테고리별 re-export — 외부 표면(packages/storage/src/index.ts)이
 * 의존하는 단일 진입점. 새 함수 추가/이름 변경 시에만 수정.
 */

// 타입
export type {
  CreateSessionParams,
  UpdateSessionParams,
  SessionFilterOptions,
  SessionQueryResult,
  SessionStats,
  ProjectStats,
} from './types';

export type { SessionHubEnv } from './write';

// 조회
export {
  getSessionById,
  getAllSessions,
  getSessionsWithFilter,
  getSessionsByProject,
  getActiveSessions,
} from './read';

// 생성·수정·단건/단일테이블 삭제 (setSessionHubEnv: 허브 환경 태그 — Migration 069)
export {
  createSession,
  createSessions,
  updateSession,
  endSession,
  reactivateSession,
  setSessionHubEnv,
  updateSessionTokens,
  deleteSession,
  deleteSessions,
  deleteOldSessions,
} from './write';

// 멀티테이블 retention
export { deleteOldData, runRetentionCycle, pruneSummaryTables } from './retention';

// 집계
export { getSessionStats, getProjectStats } from './aggregate';

// 허브 세션 요약(#3) — 메타·토큰·스킬/에이전트/명령
export {
  getSessionSummaryCore,
  listSessionIdsForSummary,
  getSessionWindowActivity,
  type SessionWindowActivity,
  type SessionSummaryCore,
  type SessionSummaryListOptions,
} from './summary';

// LIVE 술어 SSoT (외부 라우트 캐시 키 버킷화 등에서 참조)
export { LIVE_STALE_THRESHOLD_MS } from './_shared';
