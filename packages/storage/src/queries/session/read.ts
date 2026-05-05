/**
 * Session 조회(Read) 쿼리.
 *
 * 변경 이유: 세션 조회 정책(빈 세션 hide, 정렬 우선순위, 첫 prompt payload 포함 등)
 * 이 바뀔 때 수정.
 */

import type { Database } from 'bun:sqlite';
import type { SessionFilterOptions, SessionQueryResult } from './types';
import {
  ACTIVE_SESSION_REQUEST_JOIN_SQL,
  buildLiveSessionPredicate,
  buildLiveStateColumn,
} from './_shared';

/**
 * 세션 단건 조회 (ID 기준)
 */
export function getSessionById(
  db: Database,
  id: string
): SessionQueryResult | null {
  return db.query('SELECT * FROM sessions WHERE id = ?').get(id) as SessionQueryResult | null;
}

/**
 * 모든 세션 조회 (최근순, first_prompt_payload 포함, 날짜 필터 지원)
 *
 * 개선:
 *  - LEFT JOIN + GROUP BY로 N+1 쿼리 제거
 *  - v22: HAVING last_activity_at IS NOT NULL — requests가 0건인 빈 세션 hide
 *    (사용자가 데이터 삭제·정리한 뒤 sessions 테이블에만 남은 잔존 행이 사이드바에
 *     노이즈로 노출되던 문제 해결. 활성 세션은 첫 hook 도달 시 last_activity_at이 채워지므로
 *     영향 없음.)
 */
export function getAllSessions(
  db: Database,
  limit: number = 100,
  fromTs?: number,
  toTs?: number,
  now: number = Date.now(),
): SessionQueryResult[] {
  // 자기완결형 SQL 조각 — 외부 params 배열 push 패턴은 SQL 등장 순서와 어긋나는
  // 회귀를 반복 유발했기에 폐기. 호출 측이 SQL 텍스트를 쓰는 라인에서 곧바로
  // `...frag.params`로 spread하여 자리·순서를 명시 결합한다.
  const live = buildLiveStateColumn(now, 's.ended_at', 'MAX(r.timestamp)');

  const whereConds: string[] = [];
  const whereParams: number[] = [];
  if (fromTs) { whereConds.push('s.started_at >= ?'); whereParams.push(fromTs); }
  if (toTs)   { whereConds.push('s.started_at <= ?'); whereParams.push(toTs); }
  const where = whereConds.length ? `WHERE ${whereConds.join(' AND ')}` : '';

  return db.query(`
    SELECT s.*,
      (SELECT r.payload FROM requests r
       WHERE r.session_id = s.id AND r.type = 'prompt'
       ORDER BY r.timestamp ASC LIMIT 1) as first_prompt_payload,
      MAX(r.timestamp) as last_activity_at,
      ${live.sql} as live_state
    FROM sessions s
    ${ACTIVE_SESSION_REQUEST_JOIN_SQL}
    ${where}
    GROUP BY s.id
    HAVING last_activity_at IS NOT NULL
    ORDER BY (s.ended_at IS NULL) DESC, COALESCE(MAX(r.timestamp), s.started_at) DESC
    LIMIT ?
  `).all(...live.params, ...whereParams, limit) as SessionQueryResult[];
}

/**
 * 필터링된 세션 조회
 */
export function getSessionsWithFilter(
  db: Database,
  options: SessionFilterOptions = {}
): SessionQueryResult[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (options.project_name) {
    conditions.push('project_name = ?');
    params.push(options.project_name);
  }
  if (options.started_after) {
    conditions.push('started_at >= ?');
    params.push(options.started_after);
  }
  if (options.started_before) {
    conditions.push('started_at <= ?');
    params.push(options.started_before);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitClause = options.limit ? `LIMIT ${options.limit}` : 'LIMIT 100';
  const offsetClause = options.offset ? `OFFSET ${options.offset}` : '';

  const sql = `SELECT * FROM sessions ${whereClause} ORDER BY started_at DESC ${limitClause} ${offsetClause}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return db.query(sql).all(...params as any[]) as SessionQueryResult[];
}

/**
 * 프로젝트별 세션 조회
 * 개선: LEFT JOIN + GROUP BY로 N+1 쿼리 제거
 */
export function getSessionsByProject(
  db: Database,
  projectName: string,
  limit: number = 100,
  fromTs?: number,
  toTs?: number,
  now: number = Date.now(),
): SessionQueryResult[] {
  const live = buildLiveStateColumn(now, 's.ended_at', 'MAX(r.timestamp)');

  const whereConds: string[] = ['s.project_name = ?'];
  const whereParams: (string | number)[] = [projectName];
  if (fromTs) { whereConds.push('s.started_at >= ?'); whereParams.push(fromTs); }
  if (toTs)   { whereConds.push('s.started_at <= ?'); whereParams.push(toTs); }

  return db.query(`
    SELECT s.*,
      (SELECT r.payload FROM requests r
       WHERE r.session_id = s.id AND r.type = 'prompt'
       ORDER BY r.timestamp ASC LIMIT 1) as first_prompt_payload,
      MAX(r.timestamp) as last_activity_at,
      ${live.sql} as live_state
    FROM sessions s
    ${ACTIVE_SESSION_REQUEST_JOIN_SQL}
    WHERE ${whereConds.join(' AND ')}
    GROUP BY s.id
    HAVING last_activity_at IS NOT NULL
    ORDER BY (s.ended_at IS NULL) DESC, COALESCE(MAX(r.timestamp), s.started_at) DESC
    LIMIT ?
  `).all(...live.params, ...whereParams, limit) as SessionQueryResult[];
}

/**
 * 라이브 세션 조회 — "ended_at IS NULL AND 최근 STALE_THRESHOLD_MS 이내 활동" 술어 적용.
 *
 * 반환 컬럼: sessions.* + last_activity_at + live_state ('live' 고정 — WHERE에서 선별).
 *
 * 다른 read 함수(getAllSessions/getSessionsByProject)와 last_activity_at 계산 형태,
 * visible request 정의(ACTIVE_SESSION_REQUEST_JOIN_SQL), live_state derive를 모두
 * 동일 패턴으로 사용한다 → 응답 페이로드 모양 일관.
 *
 * 변경 이력:
 *  - v(이번): live_state SELECT 컬럼 추가 + LEFT JOIN GROUP BY 형태로 통일.
 *    클라이언트가 stale 판정 로직을 가지지 않도록 서버에서 SSoT로 결정.
 *  - v(직전): SessionEnd hook 누락(Ctrl+C, 크래시 등)으로 ended_at이 영원히 NULL인
 *    stale 세션이 헤더 LIVE 카운트에 누적되던 문제 해결. buildLiveSessionPredicate
 *    SSoT로 헤더/프로젝트 active_count/Live Pulse 카드 정의 통일.
 *
 * @param db   DB 핸들
 * @param now  현재 시각(ms). 라우트 레이어에서 1회 결정 후 같은 응답에서 재사용
 *             해야 카운트 일관성 보장. 미지정 시 Date.now() (테스트용 편의 시그니처).
 */
export function getActiveSessions(
  db: Database,
  now: number = Date.now(),
): SessionQueryResult[] {
  // 두 빌더는 같은 LIVE_STALE_THRESHOLD_MS 상수를 참조하므로 SSoT 무결.
  // SQL `?` 등장 순서: SELECT의 liveStateCol → WHERE의 livePredicate → spread 순서 동일.
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
  `).all(...liveStateCol.params, ...livePred.params) as SessionQueryResult[];
}
