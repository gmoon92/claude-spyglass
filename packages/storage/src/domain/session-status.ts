/**
 * Session 상태(LIVE / visible) 도메인 SSoT.
 *
 * # 책임
 *
 * "지금 LIVE인가 / visible인가"의 정의를 **결과 함수**로 노출한다.
 * 외부 호출자(routes/*, queries/* 의 thin wrapper)는 SQL 조각을 직접 조립하지 않는다.
 *
 * # 왜 결과 함수 SSoT인가
 *
 * 직전 3차례 회귀(LIVE 정의 분산, SQL 파라미터 순서 어긋남, 5 vs 4 visible 불일치)는
 * 모두 "빌더 조각은 SSoT지만 호출자가 매번 조립" 패턴에서 유래했다.
 * 빌더만 공유하면 라우트가 늘어날 때마다 같은 조립 책임이 새 호출자로 분산되어
 * 정의 일관성이 호출자 수만큼 검증 부담이 된다.
 *
 * 결과 함수만 노출하면:
 *  - 새 라우트가 생겨도 SQL 조립을 만질 일이 없다 → 정의 분기 자체가 불가능.
 *  - 정의(LIVE/visible/STALE_THRESHOLD) 변경 시 이 파일 한 곳만 수정.
 *  - 화면별로 같은 의미의 카운트가 다른 path로 derive되는 문제 자연 차단.
 *
 * # 의존
 *
 *  - `../queries/session/_shared`: SQL 조각 빌더 (이 모듈 내부에서만 사용)
 *  - `../schema`: Session 타입
 *
 * # 호출자
 *
 *  - `queries/session/read.ts`, `queries/session/aggregate.ts`: thin wrapper로 위임.
 *  - `server/routes/dashboard.ts`, `routes/sessions.ts` 등: 직접 호출 가능.
 *
 * # 정의 (요약)
 *
 *  - **visible 세션**: 적어도 1개 visible request(pre_tool 제외, Agent 예외) 존재.
 *    → 사이드바 노출 / 프로젝트 session_count / 통계 total_sessions 모두 동일.
 *  - **live 세션**: visible 세션 + ended_at NULL + 직전 STALE_THRESHOLD_MS 이내 활동.
 *    → 헤더 LIVE / 프로젝트 active_count / Live Pulse / 사이드바 ● 마커 모두 동일.
 *  - **stale 세션**: ended_at NULL인데 직전 활동이 cutoff 미만 (SessionEnd 누락 의심).
 *    → 사이드바 ◐ 마커.
 *  - **ended 세션**: ended_at IS NOT NULL.
 *    → 사이드바 ○ 마커.
 */

import type { Database } from 'bun:sqlite';
import type { Session } from '../schema';
import {
  ACTIVE_SESSION_REQUEST_JOIN_SQL,
  buildLiveSessionPredicate,
  buildLiveStateColumn,
  buildVisibleSessionPredicate,
} from '../queries/session/_shared';

/**
 * 시간/프로젝트 필터 — 모든 도메인 함수 공용 옵션.
 */
export interface SessionStatusFilter {
  /** 시작 시간(ms) 하한 (>= ). 미지정 시 무제한 과거. */
  fromTs?: number;
  /** 시작 시간(ms) 상한 (<= ). 미지정 시 무제한 미래. */
  toTs?: number;
  /** 프로젝트명 정확 일치. 미지정 시 전체. */
  projectName?: string;
}

/**
 * 도메인 통합 집계 결과 — getSessionStats 응답 모양과 호환.
 */
export interface SessionStatusAggregate {
  /** visible 세션 수 (전체). */
  totalSessions: number;
  /** visible 세션 토큰 합계. */
  totalTokens: number;
  /** visible 세션 평균 토큰. */
  avgTokensPerSession: number;
  /** LIVE 세션 수. */
  activeSessions: number;
}

/**
 * 프로젝트별 도메인 집계 — getProjectStats 응답 모양과 호환.
 */
export interface ProjectStatusMetrics {
  project_name: string;
  /** visible 세션 수. */
  session_count: number;
  /** LIVE 세션 수. */
  active_count: number;
  /** visible 세션 토큰 합계. */
  total_tokens: number;
}

// ============================================================================
// 내부: WHERE 컴파일러 (필터 → SQL + params)
// ============================================================================

interface CompiledWhere {
  sql: string;
  params: (number | string)[];
}

/**
 * SessionStatusFilter를 sessions 테이블 WHERE 절로 컴파일.
 * 항상 's' 별칭을 가정한다 (도메인 모듈은 한 별칭으로 SSoT).
 */
function compileFilter(f: SessionStatusFilter): CompiledWhere {
  const conds: string[] = [];
  const params: (number | string)[] = [];
  if (f.projectName) { conds.push('s.project_name = ?'); params.push(f.projectName); }
  if (f.fromTs)      { conds.push('s.started_at >= ?'); params.push(f.fromTs); }
  if (f.toTs)        { conds.push('s.started_at <= ?'); params.push(f.toTs); }
  return { sql: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params };
}

// ============================================================================
// 카운트 — 단일 숫자만 필요할 때 (가장 효율적)
// ============================================================================

/**
 * 라이브 세션 수.
 *
 * 헤더 LIVE 카운트 / 프로젝트 active_count / SessionStats.active_sessions 등
 * 모든 "지금 살아있는 세션 수" 표시는 이 함수 1개에서 derive되어야 한다.
 */
export function countLiveSessions(
  db: Database,
  now: number = Date.now(),
  filter: SessionStatusFilter = {},
): number {
  const live = buildLiveSessionPredicate(now, 's');
  const where = compileFilter(filter);
  const whereSql = where.sql ? `${where.sql} AND ${live.sql}` : `WHERE ${live.sql}`;
  const row = db.query(`SELECT COUNT(*) as c FROM sessions s ${whereSql}`)
    .get(...where.params, ...live.params) as { c: number } | undefined;
  return row?.c ?? 0;
}

/**
 * visible 세션 수 (적어도 1개 visible request 존재).
 *
 * 사이드바 노출 / 프로젝트 session_count / SessionStats.total_sessions가 모두 이 정의 사용.
 */
export function countVisibleSessions(
  db: Database,
  filter: SessionStatusFilter = {},
): number {
  const visible = buildVisibleSessionPredicate('s');
  const where = compileFilter(filter);
  const whereSql = where.sql ? `${where.sql} AND ${visible}` : `WHERE ${visible}`;
  const row = db.query(`SELECT COUNT(*) as c FROM sessions s ${whereSql}`)
    .get(...where.params) as { c: number } | undefined;
  return row?.c ?? 0;
}

// ============================================================================
// 리스트 — 행 단위 응답이 필요할 때
// ============================================================================

/**
 * LIVE 세션 리스트.
 *
 * /api/sessions/active, /api/dashboard `data.active` 응답 등이 사용.
 * 응답 컬럼: sessions.* + last_activity_at + live_state ('live' 고정).
 */
export function listLiveSessions(
  db: Database,
  now: number = Date.now(),
): Session[] {
  const liveStateCol = buildLiveStateColumn(now, 's.ended_at', 'MAX(r.timestamp)');
  const livePred = buildLiveSessionPredicate(now, 's');
  return db.query(`
    SELECT s.*,
      MAX(r.timestamp) as last_activity_at,
      ${liveStateCol.sql} as live_state
    FROM sessions s
    ${ACTIVE_SESSION_REQUEST_JOIN_SQL}
    WHERE ${livePred.sql}
    GROUP BY s.id
    ORDER BY s.started_at DESC
  `).all(...liveStateCol.params, ...livePred.params) as Session[];
}

/**
 * visible 세션 리스트 (사이드바 + 모든 세션 페이지).
 *
 * 응답 컬럼: sessions.* + first_prompt_payload + last_activity_at + live_state.
 *
 * 정렬: 활성 우선(`ended_at IS NULL` desc) → 마지막 활동 desc.
 */
export function listVisibleSessions(
  db: Database,
  limit: number = 100,
  filter: SessionStatusFilter = {},
  now: number = Date.now(),
): Session[] {
  const liveStateCol = buildLiveStateColumn(now, 's.ended_at', 'MAX(r.timestamp)');
  const where = compileFilter(filter);

  return db.query(`
    SELECT s.*,
      (SELECT r.payload FROM requests r
       WHERE r.session_id = s.id AND r.type = 'prompt'
       ORDER BY r.timestamp ASC LIMIT 1) as first_prompt_payload,
      MAX(r.timestamp) as last_activity_at,
      ${liveStateCol.sql} as live_state
    FROM sessions s
    ${ACTIVE_SESSION_REQUEST_JOIN_SQL}
    ${where.sql}
    GROUP BY s.id
    HAVING last_activity_at IS NOT NULL
    ORDER BY (s.ended_at IS NULL) DESC, COALESCE(MAX(r.timestamp), s.started_at) DESC
    LIMIT ?
  `).all(...liveStateCol.params, ...where.params, limit) as Session[];
}

// ============================================================================
// 집계 — 한 번에 여러 지표 (헤더 stats / 프로젝트 카드)
// ============================================================================

/**
 * 전체 세션 통계 (visible 정의로 통일된 total_sessions + LIVE active_sessions).
 */
export function aggregateSessionStatus(
  db: Database,
  now: number = Date.now(),
  filter: SessionStatusFilter = {},
): SessionStatusAggregate {
  const live = buildLiveSessionPredicate(now, 's');
  const visible = buildVisibleSessionPredicate('s');
  const where = compileFilter(filter);

  const row = db.query(`
    SELECT
      SUM(CASE WHEN ${visible} THEN 1 ELSE 0 END) as total_sessions,
      COALESCE(SUM(CASE WHEN ${visible} THEN s.total_tokens ELSE 0 END), 0) as total_tokens,
      COALESCE(AVG(CASE WHEN ${visible} THEN s.total_tokens END), 0) as avg_tokens_per_session,
      SUM(CASE WHEN ${live.sql} THEN 1 ELSE 0 END) as active_sessions
    FROM sessions s
    ${where.sql}
  `).get(...live.params, ...where.params) as {
    total_sessions: number | null;
    total_tokens: number | null;
    avg_tokens_per_session: number | null;
    active_sessions: number | null;
  } | undefined;

  return {
    totalSessions: row?.total_sessions ?? 0,
    totalTokens: row?.total_tokens ?? 0,
    avgTokensPerSession: row?.avg_tokens_per_session ?? 0,
    activeSessions: row?.active_sessions ?? 0,
  };
}

/**
 * 프로젝트별 세션 통계 (visible 통일 session_count + LIVE active_count + 토큰 합).
 *
 * `HAVING session_count > 0` 으로 visible 세션이 0인 프로젝트(예: 빈 ghost만 있는
 * 프로젝트)를 자연 hide → 사이드바 그룹과 일치.
 */
export function aggregateProjectStatus(
  db: Database,
  limit: number = 10,
  now: number = Date.now(),
  filter: SessionStatusFilter = {},
): ProjectStatusMetrics[] {
  const live = buildLiveSessionPredicate(now, 's');
  const visible = buildVisibleSessionPredicate('s');
  const where = compileFilter(filter);

  return db.query(`
    SELECT
      s.project_name,
      SUM(CASE WHEN ${visible} THEN 1 ELSE 0 END) as session_count,
      SUM(CASE WHEN ${live.sql} THEN 1 ELSE 0 END) as active_count,
      SUM(CASE WHEN ${visible} THEN s.total_tokens ELSE 0 END) as total_tokens
    FROM sessions s
    ${where.sql}
    GROUP BY s.project_name
    HAVING session_count > 0
    ORDER BY total_tokens DESC
    LIMIT ?
  `).all(...live.params, ...where.params, limit) as ProjectStatusMetrics[];
}
