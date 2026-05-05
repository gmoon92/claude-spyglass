/**
 * Session 모듈 내부 공유 SQL 조각 — **저수준 빌더**.
 *
 * # 책임
 *
 *  - "유의미한 request"(visible request) JOIN 보조절 정의
 *  - 시간 윈도우 WHERE 빌더 (fromTs/toTs)
 *  - LIVE / visible / live_state 술어 빌더 (SSoT 한 단계)
 *
 * # 가시성 (중요)
 *
 *  - **이 모듈의 빌더들을 외부(routes/* 등)에서 직접 import하지 말 것.**
 *    "결과 함수 SSoT"는 한 단계 위(`storage/src/domain/session-status.ts`)에 있다.
 *    빌더는 도메인 모듈 내부 구현이며, 호출자가 SQL 조각을 조립하면 화면별 정의
 *    분기(예: 5 vs 4 visible 불일치)가 재발한다.
 *
 *  - 허용 호출자:
 *    1) `domain/session-status.ts` (도메인 결과 함수)
 *    2) `queries/session/read.ts` `aggregate.ts` (도메인 함수의 thin wrapper)
 *    3) `server/routes/dashboard.ts`의 캐시 키 버킷용 `LIVE_STALE_THRESHOLD_MS` 상수
 *       (값 1개만 참조, SQL 빌더는 사용 안 함)
 *
 * # 변경 이유
 *
 *  - "활성 요청" 정의(LEFT JOIN 보조절) 변경 시 `ACTIVE_SESSION_REQUEST_JOIN_SQL`만 수정.
 *  - "LIVE" 정의 변경 시 `LIVE_STALE_THRESHOLD_MS`와 `buildLiveSessionPredicate`만 수정.
 *  - "visible" 정의 변경 시 `buildVisibleSessionPredicate`만 수정.
 *
 * NOTE: buildTimeWindow는 metrics/_shared.ts와 의도적으로 동일한 구현이다.
 *       모듈 간 의존을 만드는 비용보다 디커플 가치가 크다고 판단.
 */

/**
 * fromTs/toTs 조건을 WHERE 조각으로 변환 (column명 지정 가능).
 * 인자는 SQL params 배열에 push, 반환은 SQL 조각.
 */
export function buildTimeWindow(
  column: string,
  fromTs: number | undefined,
  toTs: number | undefined,
  params: number[]
): string[] {
  const conds: string[] = [];
  if (fromTs !== undefined) { conds.push(`${column} >= ?`); params.push(fromTs); }
  if (toTs   !== undefined) { conds.push(`${column} <= ?`); params.push(toTs); }
  return conds;
}

/**
 * "유의미한" requests만 세션에 LEFT JOIN하기 위한 ON 조건의 보조절.
 *
 * pre_tool 이벤트(Agent 제외)는 세션 활성도 판단·정렬·HAVING 필터에서 제외해야
 * 한다. 사이드바의 "빈 세션" 노출 정책(getAllSessions 주석 참고)이 이 한 줄에
 * 의존하므로 SSoT로 격리.
 */
export const ACTIVE_SESSION_REQUEST_JOIN_SQL = `LEFT JOIN requests r ON r.session_id = s.id
      AND (r.event_type IS NULL OR r.event_type != 'pre_tool' OR r.tool_name = 'Agent')`;

/**
 * "visible 세션" 술어 빌더 — 적어도 1개의 visible request가 존재하는 세션.
 *
 * 사이드바·프로젝트 카운트·세션 통계 모두 같은 "세션" 정의를 사용해야 사용자
 * 화면 숫자가 일치한다. read.ts의 LEFT JOIN + `HAVING MAX(r.timestamp) IS NOT NULL`
 * 패턴과 의미적으로 동치 — read.ts는 last_activity_at 컬럼 derive 때문에 LEFT JOIN/MAX
 * 형태를 유지하고, 집계 쿼리(GROUP BY project 등)에서는 이 EXISTS 술어로 컴팩트하게 표현.
 *
 * 빈 세션 정의(visible_req = 0): 사용자가 데이터를 정리한 뒤 sessions 테이블에만
 * 잔존하거나, SessionEnd만 도달하고 다른 hook은 도달 안 한 ghost 행. 사이드바에
 * 노이즈로 노출되지 않으므로 카운트에서도 제외해야 일관.
 *
 * @param sessionAlias sessions 테이블 별칭 (기본 's').
 * @returns SQL 조각 (boolean 식, 파라미터 없음).
 */
export function buildVisibleSessionPredicate(sessionAlias: string): string {
  return `EXISTS (
    SELECT 1 FROM requests r3
    WHERE r3.session_id = ${sessionAlias}.id
      AND (r3.event_type IS NULL OR r3.event_type != 'pre_tool' OR r3.tool_name = 'Agent')
  )`;
}

/**
 * "라이브" 세션 stale 임계값(ms).
 *
 * 의미: 마지막 visible request로부터 이 시간 이상 경과하면 SessionEnd hook이
 *       누락되었더라도 더 이상 LIVE로 보지 않는다.
 * 30분 선택 근거: 한 turn 평균 1~2분, 일반 세션 ~1시간 이내, 자리비움/긴 사고
 *                turn까지 포섭 가능, 22시간+ stale은 명확히 격리됨.
 */
export const LIVE_STALE_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * SQL 조각 + 바인딩 파라미터를 묶어 반환하는 자기완결형 빌더 결과.
 *
 * 외부 params 배열에 push하지 않는 이유: SQL 텍스트의 `?` 등장 순서와 push 시점이
 * 호출 측에서 따로 관리되면 회귀 지점이 반복 발생한다. 호출 측은 SQL 텍스트를
 * 작성하는 그 라인에서 `...x.params`로 같이 spread → 자리·순서가 한눈에 정합 확인 가능.
 */
export interface SqlFragment {
  sql: string;
  params: number[];
}

/**
 * 라이브 세션 술어(predicate) 빌더 — sessions 테이블에 적용할 WHERE/EXISTS 조각.
 *
 * 정의: 세션이 LIVE이려면
 *   1) ended_at IS NULL (SessionEnd 미수신)
 *   2) 직전 STALE_THRESHOLD_MS 이내 visible request 존재 (stale 보정)
 *
 * (2)는 ACTIVE_SESSION_REQUEST_JOIN_SQL과 동일한 visible 정의(pre_tool 제외, Agent 예외).
 *
 * @param now 현재 시각(ms). 라우트에서 1회 결정한 값을 그대로 전달 → 한 응답 내 일관.
 * @param sessionAlias sessions 테이블 별칭 (기본 's').
 * @returns SqlFragment(`?` 1개)
 *
 * 사용 예 (호출 측):
 *   const live = buildLiveSessionPredicate(now, 's');
 *   db.query(`... WHERE ${live.sql} ...`).all(...live.params, ...otherParams)
 */
export function buildLiveSessionPredicate(
  now: number,
  sessionAlias: string,
): SqlFragment {
  const cutoff = now - LIVE_STALE_THRESHOLD_MS;
  const sql = `(${sessionAlias}.ended_at IS NULL AND EXISTS (
    SELECT 1 FROM requests r2
    WHERE r2.session_id = ${sessionAlias}.id
      AND r2.timestamp >= ?
      AND (r2.event_type IS NULL OR r2.event_type != 'pre_tool' OR r2.tool_name = 'Agent')
  ))`;
  return { sql, params: [cutoff] };
}

/**
 * live_state SELECT 컬럼식 빌더 — sessions 응답에 'live' | 'stale' | 'ended' 노출.
 *
 * 정의:
 *   ended  : ended_at IS NOT NULL (정상 종료)
 *   live   : ended_at NULL + 마지막 visible 활동이 cutoff 이상
 *   stale  : ended_at NULL + 마지막 visible 활동이 cutoff 미만 (또는 활동 자체 없음)
 *
 * `buildLiveSessionPredicate`와 같은 LIVE_STALE_THRESHOLD_MS·visible 정의를 공유.
 * 한 상수에 의존하므로 SSoT 무결.
 *
 * 사용 시 SELECT 절에 derive된 last_activity_at(예: `MAX(r.timestamp)`) 표현식이
 * 같은 SQL 안에 있어야 한다 (LEFT JOIN + GROUP BY 패턴이 일반적).
 *
 * @param now 현재 시각(ms).
 * @param endedAtExpr "s.ended_at" 등 ended_at 표현식.
 * @param lastActivityAtExpr "MAX(r.timestamp)" 등 마지막 활동 표현식.
 * @returns SqlFragment(`?` 1개).
 */
export function buildLiveStateColumn(
  now: number,
  endedAtExpr: string,
  lastActivityAtExpr: string,
): SqlFragment {
  const cutoff = now - LIVE_STALE_THRESHOLD_MS;
  const sql = `CASE
    WHEN ${endedAtExpr} IS NOT NULL THEN 'ended'
    WHEN ${lastActivityAtExpr} IS NOT NULL AND ${lastActivityAtExpr} >= ? THEN 'live'
    ELSE 'stale'
  END`;
  return { sql, params: [cutoff] };
}
