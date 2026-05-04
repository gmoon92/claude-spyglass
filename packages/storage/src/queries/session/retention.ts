/**
 * 멀티테이블 retention(일일 유지보수) 쿼리.
 *
 * 변경 이유: GC 대상 테이블 추가/제거, 부모-자식 삭제 순서 변경, 잔존 자식 보존
 * 정책 변경 시 수정. write.ts(단건/단일테이블 라이프사이클)와는 변경 이유가 다름.
 */

import type { Database } from 'bun:sqlite';

/**
 * 보관 기간이 지난 데이터 전체 삭제 (일일 유지보수용)
 *
 * 삭제 순서 (자식 → 부모):
 *  1. requests       — timestamp 기준 직접 삭제 (FK CASCADE에 의존하지 않음으로써
 *                      세션이 오늘 이후 활동 중이더라도 과거 requests를 정리)
 *  2. proxy_requests — timestamp 기준 (sessions FK 없음)
 *  3. claude_events  — timestamp 기준 (sessions FK 없음)
 *  4. sessions       — started_at 기준, 단 오늘 이후 자식이 남아있는 세션은 보존
 *                      (requests/claude_events/proxy_requests 모두 소진된 세션만 삭제)
 *  5. system_prompts — last_seen_at 기준, 살아있는 proxy_requests가 참조하지 않는 행만
 *
 * @returns 삭제된 sessions 행 수
 */
export function deleteOldData(db: Database, beforeTimestamp: number): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const run = (sql: string, ...params: unknown[]) => (db as any).run(sql, ...params);

  // 1. requests: timestamp 기준 직접 삭제
  run('DELETE FROM requests WHERE timestamp < ?', beforeTimestamp);

  // 2. proxy_requests: timestamp 기준
  run('DELETE FROM proxy_requests WHERE timestamp < ?', beforeTimestamp);

  // 3. claude_events: timestamp 기준
  run('DELETE FROM claude_events WHERE timestamp < ?', beforeTimestamp);

  // 4. sessions: started_at < cutoff 이고 살아있는 자식이 없는 것만 삭제
  //    - requests/claude_events/proxy_requests 에서 해당 session_id가 없는 세션만
  const { changes } = run(
    `DELETE FROM sessions
     WHERE started_at < ?
       AND id NOT IN (
         SELECT DISTINCT session_id FROM requests       WHERE session_id IS NOT NULL
         UNION
         SELECT DISTINCT session_id FROM claude_events  WHERE session_id IS NOT NULL
         UNION
         SELECT DISTINCT session_id FROM proxy_requests WHERE session_id IS NOT NULL
       )`,
    beforeTimestamp
  );

  // 5. system_prompts: last_seen_at < cutoff + 살아있는 proxy_requests 미참조 행만
  run(
    `DELETE FROM system_prompts
     WHERE last_seen_at < ?
       AND hash NOT IN (
         SELECT DISTINCT system_hash FROM proxy_requests
         WHERE system_hash IS NOT NULL
       )`,
    beforeTimestamp
  );

  return changes;
}
