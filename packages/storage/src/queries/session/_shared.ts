/**
 * Session 모듈 내부 공유 SQL 조각 + 시간 윈도우 빌더 + LIVE predicate SSoT.
 *
 * 책임:
 *  - "유의미한 request"(visible request) JOIN 보조절 정의
 *  - 시간 윈도우 WHERE 빌더 (fromTs/toTs)
 *  - "라이브(LIVE) 세션" 술어 정의 — 헤더 LIVE 카운트, 프로젝트 active_count,
 *    Live Pulse 카드, 사이드바 ● 마커가 모두 같은 정의를 공유하기 위한 SSoT
 *
 * 의존성: 외부 의존 없음 (SQL 텍스트만 노출)
 * 호출자:
 *  - read.ts (getActiveSessions, getAllSessions, getSessionsByProject 등)
 *  - aggregate.ts (getSessionStats, getProjectStats)
 *  - server/routes/dashboard.ts (캐시 키 버킷화)
 *
 * 변경 이유:
 *  - "활성 요청"의 정의(LEFT JOIN 보조절)가 바뀔 때 ACTIVE_SESSION_REQUEST_JOIN_SQL만 수정.
 *  - 시간 필터 의미(half-open 등) 변경 시 buildTimeWindow만 수정.
 *  - "라이브"의 정의(stale 임계값, 추가 조건 등) 변경 시 LIVE_STALE_THRESHOLD_MS와
 *    buildLiveSessionPredicate만 수정.
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
 * "라이브" 세션 stale 임계값(ms).
 *
 * 의미: 마지막 visible request로부터 이 시간 이상 경과하면 SessionEnd hook이
 *       누락되었더라도 더 이상 LIVE로 보지 않는다.
 * 30분 선택 근거: 한 turn 평균 1~2분, 일반 세션 ~1시간 이내, 자리비움/긴 사고
 *                turn까지 포섭 가능, 22시간+ stale은 명확히 격리됨.
 */
export const LIVE_STALE_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * 라이브 세션 술어(predicate) 빌더 — sessions 테이블에 적용할 SQL 조각.
 *
 * 정의: 세션 s가 LIVE이려면
 *   1) ended_at IS NULL (SessionEnd 미수신)
 *   2) 직전 STALE_THRESHOLD_MS 이내 visible request 존재 (stale 보정)
 *
 * (2)는 ACTIVE_SESSION_REQUEST_JOIN_SQL과 동일한 visible 정의를 사용 — pre_tool
 * (Agent 제외)은 활성도 판단에서 제외. EXISTS 서브쿼리는 인덱스
 * (idx_requests_session, idx_requests_session_type)에 친화적이며 GROUP BY 없이
 * SELECT 컬럼식·HAVING 모두에 합성 가능하다.
 *
 * @param now 현재 시각(ms). 라우트 레이어에서 1회 결정 후 모든 호출에 동일 값
 *            전달 → 같은 응답 안에서 일관성 보장.
 * @param sessionAlias sessions 테이블의 별칭 (기본 's'). 다른 별칭이면 'sessions' 등.
 * @param params SQL params 배열 (cutoff timestamp가 push 됨)
 * @returns SQL 조각 (괄호로 감싸진 boolean 식). 플레이스홀더 ?는 1개 사용.
 *
 * 사용 예:
 *   const conds: string[] = [];
 *   conds.push(buildLiveSessionPredicate(now, 's', params));
 *   const where = `WHERE ${conds.join(' AND ')}`;
 */
export function buildLiveSessionPredicate(
  now: number,
  sessionAlias: string,
  params: number[],
): string {
  const cutoff = now - LIVE_STALE_THRESHOLD_MS;
  params.push(cutoff);
  return `(${sessionAlias}.ended_at IS NULL AND EXISTS (
    SELECT 1 FROM requests r2
    WHERE r2.session_id = ${sessionAlias}.id
      AND r2.timestamp >= ?
      AND (r2.event_type IS NULL OR r2.event_type != 'pre_tool' OR r2.tool_name = 'Agent')
  ))`;
}
