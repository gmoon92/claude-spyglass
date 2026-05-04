/**
 * Request 모듈 barrel — 외부 시그니처(@spyglass/storage) 동결 (ADR-007 srp-redesign).
 *
 * @description
 *   storage/queries/request.ts(1165줄)를 변경 이유별로 분해 후 외부 호환을 위한 단일 진입점.
 *   호출자(`packages/server`, `packages/tui` 등)는 이 파일이 export하는 시그니처에만 의존하며,
 *   내부 4파일(read/write/aggregate/turn)이 어떻게 재배치되어도 영향 없음.
 *
 *   변경 이유 단일성 매핑:
 *   - 조회 정책 변경 → read.ts
 *   - 스키마 컬럼 추가/변경 → write.ts
 *   - 통계 지표 변경 → aggregate.ts
 *   - Turn 인터리빙 정책 변경 → turn.ts
 *   - 외부 export 추가/제거 → 이 index.ts
 *
 *   ACTIVE_REQUEST_FILTER_SQL은 read.ts에서 정의(조회 정책 SSoT). aggregate/turn은 import.
 */

export {
  // 조회 정책 SSoT
  ACTIVE_REQUEST_FILTER_SQL,
  // 타입
  type RequestQueryResult,
  type RequestFilterOptions,
  // 조회 함수
  getRequestById,
  getAllRequests,
  getRequestsBySession,
  getRequestsByType,
  getRequestsWithFilter,
  getTopTokenRequests,
  getChildRequestsByParentToolUseId,
  getChildRequestsByParents,
} from './read';

export {
  // 타입
  type CreateRequestParams,
  type UpdateRequestParams,
  // 생성/수정/삭제 함수
  createRequest,
  createRequests,
  updateRequest,
  deleteRequest,
  deleteRequestsBySession,
  deleteOldRequests,
} from './write';

export {
  // 집계 타입
  type RequestStats,
  type TypeStats,
  type ToolStats,
  type SessionToolStats,
  type HourlyStats,
  type StripStats,
  type CacheStats,
  // 집계 함수
  getAvgPromptDurationMs,
  getRequestStats,
  getRequestStatsBySession,
  getRequestStatsByType,
  getToolStats,
  getSessionToolStats,
  getHourlyRequestStats,
  getStripStats,
  getCacheStats,
  getP95DurationMs,
} from './aggregate';

export {
  // Turn 타입
  type TurnToolCall,
  type TurnResponse,
  type TurnItem,
  // Turn 함수
  getTurnsBySession,
} from './turn';
