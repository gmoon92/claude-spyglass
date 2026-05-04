/**
 * Observability Metrics — 모든 쿼리에서 재사용하는 시간 윈도우 WHERE 빌더.
 *
 * 변경 이유: 시간 필터 의미 변경(예: half-open 구간) 시 한 곳만 수정.
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
