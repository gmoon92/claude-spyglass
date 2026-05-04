/**
 * Request 모듈 barrel — 외부 시그니처(@spyglass/storage) 동결 (ADR-007 srp-redesign).
 *
 * @description
 *   storage/queries/request.ts(1165줄)를 변경 이유별로 분해 후 외부 호환을 위한 단일 진입점.
 *   호출자(`packages/server`, `packages/tui` 등)는 이 파일이 export하는 시그니처에만 의존하며,
 *   내부 파일들이 어떻게 재배치되어도 영향 없음.
 *
 *   변경 이유 단일성 매핑:
 *   - 조회 정책 변경 → read.ts
 *   - 스키마 컬럼 추가/변경 → write.ts
 *   - 통계 지표 변경 → aggregate-{도메인}.ts (general/tool/time/latency/strip/cache)
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

// 일반 통계 — 헤더/요약 카드
export {
  type RequestStats,
  type TypeStats,
  getRequestStats,
  getRequestStatsBySession,
  getRequestStatsByType,
} from './aggregate-general';

// 도구 성능 — Feature F: Tool Performance
export {
  type ToolStats,
  type SessionToolStats,
  getToolStats,
  getSessionToolStats,
} from './aggregate-tool';

// 시계열 — 히트맵/선그래프
export {
  type HourlyStats,
  getHourlyRequestStats,
} from './aggregate-time';

// 응답 시간 — 평균/P95
export {
  getAvgPromptDurationMs,
  getP95DurationMs,
} from './aggregate-latency';

// Command Center Strip — P95 + 오류율 합성
export {
  type StripStats,
  getStripStats,
} from './aggregate-strip';

// Cache Intelligence — 히트율/절감 토큰
export {
  type CacheStats,
  getCacheStats,
} from './aggregate-cache';

export {
  // Turn 타입
  type TurnToolCall,
  type TurnResponse,
  type TurnItem,
  // Turn 함수
  getTurnsBySession,
} from './turn';
