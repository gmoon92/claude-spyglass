/**
 * archive-retention — Warm Archive의 retention 경계 GC (roadmap Phase 5-6, ADR A1)
 *
 * @description
 *   retention(기본 30일)은 불변 상한이다. Archive는 그 '앞'의 선택적 중간 계층일 뿐이라, 이주된
 *   데이터도 retention 경계에 도달하면 **Hot과 동일하게 삭제**돼야 한다(디스크 총량 불변 — 목적은
 *   Hot 압박 감소지 보존 연장이 아님). 이주만 하고 archive GC가 없으면 archive_index/파일/집계
 *   버킷이 **무한 축적**된다.
 *
 *   삭제 대상(3종):
 *     1) archive 본문 파일 + archive_index 행 — '완전 만료 파일' 단위(파일=UTC일, ADR A4).
 *     2) archive_stats_hourly       — hour_ts < cutoff 버킷(retention.ts:stats_hourly 삭제와 대칭).
 *     3) archive_stats_proxy_hourly — 동.
 *
 *   완전 만료 파일 단위 GC 근거: archive 파일은 UTC일 1개 단위(migrate-to-archive.utcDateStr)라
 *   retention cutoff(UTC일 경계)와 straddle되지 않는다. 따라서 "모든 행의 timestamp < cutoff"인
 *   파일만 골라 파일+인덱스를 함께 지운다. 경계를 걸친 파일이 (비정상적으로) 있어도 지우지 않아
 *   손실 0(과잉 보존 측). 파일 삭제(FS)를 인덱스 삭제(DB)보다 먼저 하여 crash 시에도 self-healing:
 *   인덱스만 남으면 다음 GC가 재시도, 파일만 없으면 readDay가 []로 안전.
 *
 *   proxy_requests는 아직 이주 대상이 아니므로(ADR A7) CAS artifact ref_count 차감은 여기서 다루지
 *   않는다. proxy Archive 이주가 도입되면 이 함수에 ref_count 차감을 추가한다.
 *
 * @dependencies bun:sqlite, ./archive-index(deleteArchiveIndexByFile), ./archive-store(ArchiveStore)
 * @flow queries/session/retention.deleteOldData → deleteExpiredArchive(db, beforeTimestamp, store)
 */

import type { Database } from 'bun:sqlite';
import { deleteArchiveIndexByFile } from './archive-index';
import type { ArchiveStore } from './archive-store';

export interface ArchiveGcResult {
  /** 삭제된 archive_index 행 수. */
  indexRows: number;
  /** 삭제된 archive 본문 파일 수. */
  filesDeleted: number;
  /** 삭제된 archive_stats_hourly 버킷 수. */
  statsHourly: number;
  /** 삭제된 archive_stats_proxy_hourly 버킷 수. */
  statsProxy: number;
}

/**
 * retention 경계(beforeTimestamp, ms) 이전 archive 데이터를 삭제한다.
 * archive가 비어 있으면(이주 비활성 기본) 전부 no-op(0). env 게이트 없이 항상 안전 실행.
 *
 * @param db              archive_index/archive_stats_* 보유 DB
 * @param beforeTimestamp retention cutoff(ms). 이 시각 미만 데이터가 GC 대상.
 * @param store           본문 파일 저장소(FileArchiveStore). 파일 삭제에 사용.
 */
export function deleteExpiredArchive(
  db: Database,
  beforeTimestamp: number,
  store: ArchiveStore,
): ArchiveGcResult {
  // 1) '완전 만료 파일'만 선별 — 파일 내 모든 행 timestamp < cutoff (>= cutoff 행이 하나도 없는 파일).
  const files = (
    db
      .query(
        `SELECT DISTINCT archive_file FROM archive_index
          WHERE timestamp < ?
            AND archive_file NOT IN (SELECT archive_file FROM archive_index WHERE timestamp >= ?)`,
      )
      .all(beforeTimestamp, beforeTimestamp) as { archive_file: string }[]
  ).map((r) => r.archive_file);

  let indexRows = 0;
  let filesDeleted = 0;
  for (const file of files) {
    // FS 먼저(self-healing): 파일 삭제 후 인덱스 삭제. crash 시 인덱스만 남으면 다음 GC 재시도.
    store.remove(file);
    indexRows += deleteArchiveIndexByFile(db, file);
    filesDeleted++;
  }

  // 2·3) 집계 archive 버킷 — hour_ts(sec) < cutoff. retention.ts의 stats_hourly 삭제 컷과 동일 산식.
  const cutoffHourTs = Math.floor(beforeTimestamp / 1000 / 3600) * 3600;
  const statsHourly = db.run('DELETE FROM archive_stats_hourly WHERE hour_ts < ?', [cutoffHourTs]).changes;
  const statsProxy = db.run('DELETE FROM archive_stats_proxy_hourly WHERE hour_ts < ?', [cutoffHourTs]).changes;

  return { indexRows, filesDeleted, statsHourly, statsProxy };
}
