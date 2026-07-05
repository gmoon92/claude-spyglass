/**
 * flush-gate — Archive 이주의 graph flush 정합 게이트 (ADR storage-evolution-adr-archive.md A3)
 *
 * @description
 *   결정적 안전 불변식: kuzu_outbox sync worker가 아직 flush하지 않은(=Ladybug로 MERGE 전) 행을
 *   Archive로 옮기면, worker가 enrich 시 SQLite 원본을 JOIN 조회할 때 행이 이미 Hot에서 사라져
 *   graph 투영이 영구 누락된다. 따라서 이주 상한을 "가장 오래된 미-flush 이벤트 시각"으로 제한한다.
 *
 *   retention 삭제는 graph도 같은 cutoff로 지워 flush 여부와 무관했지만, Archive는 "Hot에서 치우되
 *   데이터 생존"이라 이 게이트가 이주 고유의 신규 불변식이다.
 *
 * @dependencies bun:sqlite (kuzu_outbox — migrations/049)
 * @flow migrate-to-archive → computeSafeArchiveTs(archiveCutoffTs, getOldestUnflushedTs(db, cursor))
 */

import type { Database } from 'bun:sqlite';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 아직 flush되지 않은(cursor 미통과, dead 아님) 가장 오래된 outbox 이벤트의 ts(ms).
 * 미처리 이벤트가 없으면 null(=flush 제한 없음). cursor는 storage-graph SyncCursor가 조달(배선 단계).
 *
 * @param db     kuzu_outbox 보유 DB
 * @param cursor sync_state.json의 마지막 처리 id
 */
export function getOldestUnflushedTs(db: Database, cursor: number): number | null {
  const row = db
    .query(`SELECT ts FROM kuzu_outbox WHERE id > ? AND dead = 0 ORDER BY id ASC LIMIT 1`)
    .get(cursor) as { ts: number } | null;
  return row ? row.ts : null;
}

/** UTC 일 경계로 내림 — archive 파일=하루, hour 버킷 무분할 불변식(ADR A4). */
export function floorToUtcDay(ts: number): number {
  return Math.floor(ts / DAY_MS) * DAY_MS;
}

/**
 * 실제 이주 상한 = min(archive 경계, 가장 오래된 미-flush 시각)을 UTC 일 경계로 내림.
 * 이 값 미만(&& retention 이후 생존) 행만 이주 대상 — flush 정합(A3) + hour 버킷 무분할(A4) 동시 충족.
 *
 * @param archiveCutoffTs   getArchiveCutoffTs() (비활성이면 호출자가 이 함수를 부르지 않음)
 * @param oldestUnflushedTs getOldestUnflushedTs() (null이면 flush 제한 없음)
 */
export function computeSafeArchiveTs(archiveCutoffTs: number, oldestUnflushedTs: number | null): number {
  const bound = oldestUnflushedTs == null ? archiveCutoffTs : Math.min(archiveCutoffTs, oldestUnflushedTs);
  return floorToUtcDay(bound);
}
