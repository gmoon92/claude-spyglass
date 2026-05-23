/**
 * Flow Chart Active Row Filter — Dedicated SQL SSoT
 *
 * 책임:
 *  - 흐름 차트 BFS 쿼리만 사용하는 row filter
 *  - ACTIVE_REQUEST_FILTER_SQL (request/read.ts) 과 의도적으로 분리
 *  - flow/ 외 코드가 이 상수를 수정하지 못하도록 격리
 *
 * 정책 차이:
 *  - ACTIVE_REQUEST_FILTER_SQL: pre_tool 제외, Agent 도구는 예외 포함
 *    (= 로그 피드/대시보드에 노출되는 행 set)
 *  - FLOW_ACTIVE_ROW_SQL: pre_tool 제외, tool + post_tool + null 포함
 *    (= BFS 트리 탐색용. Agent 예외 정책 없음)
 */

/**
 * Flow BFS 쿼리에서만 사용.
 *
 * pre_tool 은 미완성 행(in-flight) 이라 흐름 차트 노드로 부적합.
 * tool / post_tool / null(old) 행만 완성된 호출로 취급.
 *
 * WHERE (r.event_type IS NULL OR r.event_type = 'tool' OR r.event_type = 'post_tool')
 *   AND r.tool_use_id IS NOT NULL
 */
export const FLOW_ACTIVE_ROW_SQL =
  "(event_type IS NULL OR event_type = 'tool' OR event_type = 'post_tool') AND tool_use_id IS NOT NULL";
