/**
 * Session 집계(Aggregate) 쿼리.
 *
 * 책임:
 *  - 전체 세션 통계 (총합/평균/라이브 카운트)
 *  - 프로젝트별 세션 통계 (전체/라이브/토큰)
 *
 * 변경 이유: 통계 정의(평균/합계 컬럼, 활성 세션 카운트 기준, 프로젝트 정렬 기준)
 * 가 바뀔 때 수정.
 *
 * 의존성:
 *  - `_shared.buildLiveSessionPredicate`: "라이브" 술어 SSoT
 *
 * 호출자:
 *  - server/routes/dashboard.ts (`/api/dashboard`)
 *  - server/routes/stats.ts (`/api/stats/sessions`, `/api/stats/projects`)
 */

import type { Database } from 'bun:sqlite';
import type { ProjectStats, SessionStats } from './types';
import { buildLiveSessionPredicate } from './_shared';

/**
 * 전체 세션 통계.
 *
 * `active_sessions`는 `_shared.buildLiveSessionPredicate`로 계산되어 stale active
 * (SessionEnd 누락) 세션과 빈 세션을 자연 제외한다. 헤더 LIVE 카운트의 진실
 * 소스는 dashboard 라우트에서 별도로 `getActiveSessions(db, now).length`를 사용
 * 하지만, 두 경로가 같은 술어를 공유하므로 결과는 일관된다.
 *
 * @param now 현재 시각(ms). 라우트에서 1회 결정 후 같은 응답에서 재사용. 미지정 시 Date.now().
 */
export function getSessionStats(
  db: Database,
  now: number = Date.now(),
  fromTs?: number,
  toTs?: number,
): SessionStats {
  const conditions: string[] = [];
  const params: number[] = [];

  if (fromTs) { conditions.push('s.started_at >= ?'); params.push(fromTs); }
  if (toTs) { conditions.push('s.started_at <= ?'); params.push(toTs); }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // 라이브 predicate는 SELECT 식 안에서 CASE의 boolean으로 사용된다.
  // params 순서: [fromTs?, toTs?, livePredicate cutoff]
  const livePredicate = buildLiveSessionPredicate(now, 's', params);

  const result = db.query(`
    SELECT
      COUNT(*) as total_sessions,
      COALESCE(SUM(s.total_tokens), 0) as total_tokens,
      COALESCE(AVG(s.total_tokens), 0) as avg_tokens_per_session,
      SUM(CASE WHEN ${livePredicate} THEN 1 ELSE 0 END) as active_sessions
    FROM sessions s
    ${whereClause}
  `).get(...params) as SessionStats;

  return result;
}

/**
 * 프로젝트별 세션 통계.
 *
 * 컬럼 의미:
 *  - `session_count`: 전체 세션 수 (사이드바 visible과 정렬 위해 모든 세션 포함).
 *    빈 세션도 포함되므로 사이드바의 visible 카운트와 정확히 일치하지 않는다.
 *    UI 컬럼 의미는 "누적 세션" — 운영 통계용.
 *  - `active_count`: 라이브 세션 수 (`_shared.buildLiveSessionPredicate` 적용).
 *    헤더 LIVE 카운트와 동일 정의 → 사용자가 "지금 진짜 작업 중"으로 신뢰 가능.
 *  - `total_tokens`: 누적 토큰 합.
 *
 * @param now 현재 시각(ms). 미지정 시 Date.now().
 */
export function getProjectStats(
  db: Database,
  limit: number = 10,
  now: number = Date.now(),
  fromTs?: number,
  toTs?: number,
): ProjectStats[] {
  const conditions: string[] = [];
  const params: (number | string)[] = [];

  if (fromTs) { conditions.push('s.started_at >= ?'); params.push(fromTs); }
  if (toTs) { conditions.push('s.started_at <= ?'); params.push(toTs); }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  // params 순서: [fromTs?, toTs?, livePredicate cutoff, limit]
  const livePredicate = buildLiveSessionPredicate(now, 's', params as number[]);
  params.push(limit.toString());

  return db.query(`
    SELECT
      s.project_name,
      COUNT(*) as session_count,
      SUM(CASE WHEN ${livePredicate} THEN 1 ELSE 0 END) as active_count,
      SUM(s.total_tokens) as total_tokens
    FROM sessions s
    ${whereClause}
    GROUP BY s.project_name
    ORDER BY total_tokens DESC
    LIMIT ?
  `).all(...params) as ProjectStats[];
}
