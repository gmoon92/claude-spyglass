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
  /** 누적 세션 수 (빈 세션·종료 세션 포함). 운영 통계용. */
  session_count: number;
  /**
   * 라이브 세션 수 — `_shared.buildLiveSessionPredicate` 정의.
   * 헤더 LIVE 카운트와 동일한 정의 (ended_at IS NULL AND 직전 STALE_THRESHOLD 이내 visible request).
   */
  active_count: number;
  total_tokens: number;
}
