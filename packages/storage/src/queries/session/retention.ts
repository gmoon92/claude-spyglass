/**
 * 멀티테이블 retention(일일 유지보수) 쿼리.
 *
 * 변경 이유: GC 대상 테이블 추가/제거, 부모-자식 삭제 순서 변경, 잔존 자식 보존
 * 정책 변경 시 수정. write.ts(단건/단일테이블 라이프사이클)와는 변경 이유가 다름.
 */

import type { Database } from 'bun:sqlite';
import { rebuildStatsHourly } from '../stats/build-aggregate';
import { runVacuumMaintenance } from '../../runtime/vacuum';

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
 *  6. stats_hourly  — requests 대량 DELETE로 인한 stats 오염을 보정 (ADR-004).
 *                      AFTER DELETE 트리거를 두지 않는 대신, retention 직후 영향 받은
 *                      hour 버킷 범위만 재집계한다.
 *
 * @returns 삭제된 sessions 행 수
 */
export function deleteOldData(db: Database, beforeTimestamp: number): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const run = (sql: string, ...params: unknown[]) => (db as any).run(sql, ...params);

  // 0. request_payloads: requests off-row payload(Migration 061). timestamp 컬럼이 없으므로
  //    삭제 대상 requests 의 id 기준으로 먼저 정리한다(FK ON DELETE CASCADE 는 PRAGMA foreign_keys
  //    ON 일 때만 강제되므로 명시 DELETE 로 SSoT 보장). requests DELETE 보다 선행해야 id 참조가 유효.
  run('DELETE FROM request_payloads WHERE request_id IN (SELECT id FROM requests WHERE timestamp < ?)', beforeTimestamp);

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

  // 6. stats_hourly: cutoff 이전의 hour 버킷을 모두 삭제. 트리거가 없으므로 retention
  //    이후 stats가 실제 requests와 어긋날 수 있고, 이를 즉시 보정한다 (ADR-004).
  const cutoffHourTs = Math.floor(beforeTimestamp / 1000 / 3600) * 3600;
  run('DELETE FROM stats_hourly WHERE hour_ts < ?', cutoffHourTs);
  // 경계 hour 버킷(요청 일부 삭제·일부 잔존)은 잔여 행을 다시 집계해 정확도를 맞춘다.
  rebuildStatsHourly(db, { sinceTs: cutoffHourTs, truncate: true });

  return changes;
}

/**
 * 보존 기간 초과 데이터 삭제 + VACUUM — 일일 정리의 단일 사이클 SSoT.
 *
 * delete → vacuum 은 한 묶음으로 수행해야 디스크가 실제로 회수된다.
 * 이 사이클의 동작을 변경할 때(쿼리 추가, vacuum 전략 변경 등) 이 파일만 수정하면 된다.
 *
 * VACUUM 전략 자체는 `runtime/vacuum.ts`가 SSoT다(incremental vs full, disk 가드).
 * (과거 버그: 여기서 `PRAGMA VACUUM`을 호출했는데 이는 존재하지 않는 pragma라 silent no-op
 *  였고, 그래서 삭제분이 freelist에 무한 누적됐다. 반드시 vacuum.ts 경유로만 회수한다.)
 *
 * @param dbPath full VACUUM의 임시 공간 disk 가드에 필요(생략 시 기본 경로).
 * @returns 삭제된 sessions 행 수
 */
export function runRetentionCycle(
  db: Database,
  beforeTimestamp: number,
  dbPath: string = `${process.env.HOME || process.env.USERPROFILE}/.spyglass/spyglass.db`,
): number {
  const deleted = deleteOldData(db, beforeTimestamp);
  runVacuumMaintenance(db, dbPath);
  return deleted;
}
