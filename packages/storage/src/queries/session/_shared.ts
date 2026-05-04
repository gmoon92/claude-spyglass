/**
 * Session 모듈 내부 공유 SQL 조각 + 시간 윈도우 빌더.
 *
 * 변경 이유:
 *  - "활성 요청"의 정의(LEFT JOIN 보조절)가 바뀔 때 ACTIVE_SESSION_REQUEST_JOIN_SQL만 수정.
 *  - 시간 필터 의미(half-open 등) 변경 시 buildTimeWindow만 수정.
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
