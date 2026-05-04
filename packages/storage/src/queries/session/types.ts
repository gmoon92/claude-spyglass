/**
 * Session 모듈 DTO/Result 인터페이스 모음.
 *
 * 변경 이유: 외부 호출자와의 데이터 계약(파라미터·반환 모양)이 바뀔 때만 수정.
 */

import type { Session } from '../../schema';

/** 세션 생성 파라미터 */
export interface CreateSessionParams {
  id: string;
  project_name: string;
  started_at: number;
  total_tokens?: number;
}

/** 세션 업데이트 파라미터 */
export interface UpdateSessionParams {
  ended_at?: number;
  total_tokens?: number;
}

/** 세션 필터 옵션 */
export interface SessionFilterOptions {
  project_name?: string;
  started_after?: number;
  started_before?: number;
  limit?: number;
  offset?: number;
}

/** 세션 조회 결과 */
export interface SessionQueryResult extends Session {}

/** 세션 통계 결과 */
export interface SessionStats {
  total_sessions: number;
  total_tokens: number;
  avg_tokens_per_session: number;
  active_sessions: number;
}

/** 프로젝트별 세션 통계 결과 */
export interface ProjectStats {
  project_name: string;
  session_count: number;
  total_tokens: number;
}
