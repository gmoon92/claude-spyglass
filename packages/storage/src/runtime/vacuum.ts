/**
 * vacuum.ts — VACUUM 전략 단일 SSoT.
 *
 * @description
 *   freelist(삭제 후 미회수 페이지) 회수 전략을 한 곳에서 결정한다. 이전에는
 *   `runRetentionCycle`이 `PRAGMA VACUUM`(존재하지 않는 pragma → silent no-op)을 호출해
 *   VACUUM이 실제로는 돌지 않았고, retention 삭제분이 freelist에 무한 누적됐다.
 *   (dev 2.5GB DB에서 freelist만 2.4GB까지 관측 — 이 모듈이 그 회수의 SoT.)
 *
 *   전략:
 *     - auto_vacuum = INCREMENTAL 인 DB → `PRAGMA incremental_vacuum`(저비용, 추적된 free page만 반환).
 *     - 그 외(NONE 등) + freelist가 임계 이상 → full `VACUUM`. 이 full VACUUM은 동시에
 *       마이그레이션(065)이 설정해 둔 `auto_vacuum = INCREMENTAL`을 **실제로 전환**시킨다
 *       (auto_vacuum 변경은 full VACUUM 1회로만 적용되기 때문). 즉 자동업데이트로 마이그레이션이
 *       퍼지면, 첫 retention 사이클에서 1회 full VACUUM → 이후로는 incremental만으로 유지된다.
 *     - full VACUUM은 DB 크기만큼의 임시 여유 공간이 필요하므로 disk 가드로 보호.
 *
 * @dependencies bun:sqlite, ./disk-space
 * @see ../queries/session/retention.ts (호출자), migrations/065-auto-vacuum-incremental.sql
 */

import type { Database } from 'bun:sqlite';
import { getDiskFreeBytes } from './disk-space';

/** auto_vacuum pragma 값. */
const AUTO_VACUUM_INCREMENTAL = 2;

/** full VACUUM을 트리거하는 freelist 임계(기본 256MB). env로 조정. */
const DEFAULT_FULL_THRESHOLD_MB = 256;

export type VacuumAction = 'incremental' | 'full' | 'skipped-disk' | 'skipped-error' | 'noop';

export interface VacuumResult {
  action: VacuumAction;
  autoVacuum: number; // 실행 전 PRAGMA auto_vacuum
  freelistBytesBefore: number;
  freelistBytesAfter: number;
  reclaimedBytes: number;
  reason?: string;
}

function fullThresholdBytes(): number {
  const raw = parseInt(process.env.SPYGLASS_VACUUM_FULL_THRESHOLD_MB ?? '', 10);
  const mb = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_FULL_THRESHOLD_MB;
  return mb * 1024 * 1024;
}

function readFreelistBytes(db: Database): number {
  const pageSize = (db.query('PRAGMA page_size').get() as { page_size: number }).page_size;
  const freelist = (db.query('PRAGMA freelist_count').get() as { freelist_count: number })
    .freelist_count;
  return freelist * pageSize;
}

function readAutoVacuum(db: Database): number {
  return (db.query('PRAGMA auto_vacuum').get() as { auto_vacuum: number }).auto_vacuum;
}

/**
 * freelist 회수 유지보수. VACUUM은 트랜잭션 밖에서 호출해야 하므로 호출자(retention 사이클)는
 * 트랜잭션을 열지 않은 상태에서 부른다.
 *
 * @param db       대상 DB
 * @param dbPath   disk 가드용 파일 경로(full VACUUM 임시 공간 확인)
 * @param force    true면 freelist 임계와 무관하게 full VACUUM(수동 1회성 회수용)
 */
export function runVacuumMaintenance(
  db: Database,
  dbPath: string,
  force = false,
): VacuumResult {
  const autoVacuum = readAutoVacuum(db);
  const before = readFreelistBytes(db);

  // 1) 이미 incremental 모드 → 저비용 incremental_vacuum로 추적된 free page 반환.
  if (!force && autoVacuum === AUTO_VACUUM_INCREMENTAL) {
    try {
      db.run('PRAGMA incremental_vacuum');
    } catch (err) {
      return {
        action: 'skipped-error',
        autoVacuum,
        freelistBytesBefore: before,
        freelistBytesAfter: before,
        reclaimedBytes: 0,
        reason: `incremental_vacuum failed: ${(err as Error)?.message ?? err}`,
      };
    }
    const after = readFreelistBytes(db);
    return {
      action: 'incremental',
      autoVacuum,
      freelistBytesBefore: before,
      freelistBytesAfter: after,
      reclaimedBytes: Math.max(0, before - after),
    };
  }

  // 2) NONE/FULL + freelist가 임계 미만 → 아직 손댈 가치 없음(노이즈성 full VACUUM 회피).
  if (!force && before < fullThresholdBytes()) {
    return {
      action: 'noop',
      autoVacuum,
      freelistBytesBefore: before,
      freelistBytesAfter: before,
      reclaimedBytes: 0,
      reason: `freelist ${(before / 1024 / 1024).toFixed(0)}MB < threshold`,
    };
  }

  // 3) full VACUUM 필요 — 단, 임시 공간(≈DB 크기)이 확보돼야 안전.
  const free = getDiskFreeBytes(dbPath);
  let dbFileBytes = 0;
  try {
    dbFileBytes = require('node:fs').statSync(dbPath).size;
  } catch {
    /* 측정 실패는 가드 통과 */
  }
  if (free !== null && dbFileBytes > 0 && free < dbFileBytes * 1.1) {
    return {
      action: 'skipped-disk',
      autoVacuum,
      freelistBytesBefore: before,
      freelistBytesAfter: before,
      reclaimedBytes: 0,
      reason: `disk free ${(free / 1024 / 1024).toFixed(0)}MB < required ~${((dbFileBytes * 1.1) / 1024 / 1024).toFixed(0)}MB`,
    };
  }

  // full VACUUM: freelist 전량 회수 + 마이그레이션이 설정한 auto_vacuum=INCREMENTAL 전환.
  // ⚠️ best-effort: 자동업데이트(`bun run dev`)의 daily-cleanup 단계는 옛 서버가 살아있는 동안
  //    실행되므로, full VACUUM이 'database is locked'로 실패할 수 있다. 여기서 throw하면
  //    daily-cleanup이 exit(1) → `&&` 체인 단절 → 서버 재시작 누락 → 업데이트 중단으로 이어진다.
  //    따라서 실패는 흡수하고 다음 사이클(서버가 단독 소유일 때)로 미룬다 — 회수는 결국 수렴한다.
  try {
    db.run('VACUUM');
  } catch (err) {
    return {
      action: 'skipped-error',
      autoVacuum,
      freelistBytesBefore: before,
      freelistBytesAfter: before,
      reclaimedBytes: 0,
      reason: `VACUUM failed (likely locked by live server): ${(err as Error)?.message ?? err}`,
    };
  }
  const after = readFreelistBytes(db);
  return {
    action: 'full',
    autoVacuum,
    freelistBytesBefore: before,
    freelistBytesAfter: after,
    reclaimedBytes: Math.max(0, before - after),
  };
}
