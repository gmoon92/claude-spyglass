/**
 * Session 집계(Aggregate) — 외부 호환 표면.
 *
 * # 책임
 *
 * `domain/session-status.ts`의 결과 함수에 위임하는 thin wrapper.
 *
 * # 왜 thin wrapper인가
 *
 * 통계 정의(visible/LIVE)가 결과 함수 SSoT(도메인 모듈)에 응집되어, 새로운 라우트가
 * 추가될 때 SQL 조각을 직접 조립하는 분기가 발생하지 않도록 차단한다 — 3차례 회귀의
 * 근본 원인이었던 "호출자 조립 책임 분산"을 구조적으로 제거.
 *
 * 변경 이유: 외부 시그니처/응답 모양이 바뀔 때만 수정. 정의 자체는 도메인 모듈에서.
 *
 * 호출자:
 *  - server/routes/dashboard.ts (`/api/dashboard`)
 *  - server/routes/stats.ts (`/api/stats/sessions`, `/api/stats/projects`)
 */

import type { Database } from 'bun:sqlite';
import type { ProjectStats, SessionStats } from './types';
import { aggregateProjectStatus, aggregateSessionStatus } from '../../domain/session-status';

/**
 * 전체 세션 통계 — 도메인 `aggregateSessionStatus` thin wrapper.
 *
 * 응답 키 호환:
 *   total_sessions     ← visible 세션 수
 *   total_tokens       ← visible 세션 토큰 합
 *   avg_tokens_per_session ← visible 세션 평균 토큰
 *   active_sessions    ← LIVE 세션 수 (stale·빈 세션 자연 제외)
 */
export function getSessionStats(
  db: Database,
  now: number = Date.now(),
  fromTs?: number,
  toTs?: number,
): SessionStats {
  const m = aggregateSessionStatus(db, now, { fromTs, toTs });
  return {
    total_sessions: m.totalSessions,
    total_tokens: m.totalTokens,
    avg_tokens_per_session: m.avgTokensPerSession,
    active_sessions: m.activeSessions,
  };
}

/**
 * 프로젝트별 세션 통계 — 도메인 `aggregateProjectStatus` thin wrapper.
 *
 * 응답 키 호환: project_name / session_count / active_count / total_tokens.
 * 모두 visible 정의 통일 → 사이드바 그룹 카운트와 일치.
 */
export function getProjectStats(
  db: Database,
  limit: number = 10,
  now: number = Date.now(),
  fromTs?: number,
  toTs?: number,
): ProjectStats[] {
  return aggregateProjectStatus(db, limit, now, { fromTs, toTs }) as ProjectStats[];
}
