/**
 * 일별 유지보수 스케줄 — 보존 기간 초과 데이터 삭제 + VACUUM + 그래프 동기 정리.
 *
 * 변경 이유:
 *   - RDB 와 그래프 DB(LadybugDB) 의 retention 정책은 본 모듈이 단일 책임으로 결정.
 *   - 보존 기간(일수)은 `@spyglass/storage` 의 `getRetentionCutoffTs()` 가 SSoT — RDB·그래프
 *     양쪽 호출이 *같은 cutoff* 를 사용하므로 두 저장소의 데이터가 항상 일치한다.
 *   - 그래프 DB 는 *데이터 단위* DELETE 로만 정리. 폴더(`~/.spyglass/graph/`) 자체 삭제
 *     경로는 본 시스템에 존재하지 않는다 (자동 throw-away · 수동 reset 모두 제거).
 */

import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  SpyglassDatabase,
  deleteOldData,
  getMetadata,
  setMetadata,
  getRetentionDays,
  getRetentionCutoffTs,
  getRawLogRetentionDays,
  getRawLogRetentionCutoffTs,
  getDiskStatus,
} from '@spyglass/storage';
import { deleteOldGraphData } from '@spyglass/storage-graph';

const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000; // 1시간마다 조건 체크
const METADATA_KEY_LAST_CLEANUP = 'last_cleanup_date'; // 저장 형식: YYYY-MM-DD

const SPYGLASS_DIR = join(homedir(), '.spyglass');
const RAW_LOG_DIR = join(homedir(), '.spyglass', 'logs', 'hook-raw');
const RAW_LOG_BUCKET_RE = /^(\d{4})-(\d{2})-(\d{2})\.jsonl$/;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * hook raw 원장 버킷(`logs/hook-raw/YYYY-MM-DD.jsonl`) 중 보존 기간(기본 7일)을
 * 넘긴 파일을 삭제한다. `collect.sh` 가 로컬 날짜로 버킷명을 만들므로 여기서도 로컬
 * 자정으로 해석한다. 버킷이 다루는 날의 끝(다음날 0시)까지 cutoff 이전이어야 삭제 —
 * 경계에서 절대 일찍 지우지 않는다. 파일명 정규식에 맞는 것만 건드려 다른 로그는 안전.
 */
function pruneRawLogBuckets(now: number = Date.now()): number {
  if (!existsSync(RAW_LOG_DIR)) return 0;
  const cutoff = getRawLogRetentionCutoffTs(now);
  let removed = 0;
  for (const name of readdirSync(RAW_LOG_DIR)) {
    const m = RAW_LOG_BUCKET_RE.exec(name);
    if (!m) continue;
    const bucketStart = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
    if (bucketStart + ONE_DAY_MS <= cutoff) {
      try {
        unlinkSync(join(RAW_LOG_DIR, name));
        removed++;
      } catch {
        // 동시 회전/권한 등으로 실패해도 다음 날 재시도 — 흡수.
      }
    }
  }
  return removed;
}

/**
 * 오늘 아직 cleanup을 실행하지 않았으면 실행한다.
 * - 서버 시작 시 즉시 호출
 * - 이후 1시간 간격 인터벌에서도 호출 (날짜가 바뀐 시점을 놓치지 않기 위해)
 *
 * SPYGLASS_RETENTION_DAYS 환경변수로 보존 기간 설정 (기본: 30일, SSoT: storage/runtime/retention.ts)
 *
 * 순서:
 *   1) RDB 정리 (`deleteOldData`) + VACUUM — 정상적이고 빠르게 끝나는 동기 경로.
 *   2) 그래프 정리 (`deleteOldGraphData`) — 비동기, 실패는 흡수 (graph 미가용 시에도 RDB 정리는 정상).
 */
async function runDailyMaintenanceIfNeeded(database: SpyglassDatabase): Promise<void> {
  try {
    const today = todayDateString();
    const lastRun = getMetadata(database.instance, METADATA_KEY_LAST_CLEANUP);
    if (lastRun === today) return;

    const retentionDays = getRetentionDays();
    const cutoff = getRetentionCutoffTs();
    const deleted = deleteOldData(database.instance, cutoff);
    database.instance.run('PRAGMA VACUUM');

    // 그래프 DB 도 같은 cutoff 로 정리 — 실패해도 RDB 정리는 이미 끝났으므로 흡수.
    //   mode='off' / circuit OPEN / Ladybug 미설치는 deleteOldGraphData 가 자체 no-op 처리.
    await deleteOldGraphData(cutoff).catch((err) => {
      console.warn('[Maintenance] graph retention skipped:', err);
    });

    // hook raw 원장 버킷 정리 — RDB/graph 와 별개 cutoff(기본 7일). 실패는 흡수.
    let prunedRawLogs = 0;
    try {
      prunedRawLogs = pruneRawLogBuckets();
    } catch (err) {
      console.warn('[Maintenance] raw-log prune skipped:', err);
    }

    setMetadata(database.instance, METADATA_KEY_LAST_CLEANUP, today);
    console.log(
      `[Maintenance] Cleanup done (${today}): removed ${deleted} sessions older than ${retentionDays}d (RDB + graph), ` +
        `pruned ${prunedRawLogs} raw-log buckets older than ${getRawLogRetentionDays()}d`
    );
  } catch (err) {
    console.warn('[Maintenance] Cleanup failed:', err);
  }
}

/**
 * `~/.spyglass` 파일시스템 여유가 warn/critical 이면 경고. 디스크 풀로 인한 write I/O
 * hang(프로세스 uninterruptible → 좀비 → 포트/락 미회수)을 운영자가 사전에 인지하도록
 * 한다. critical 시 raw/diag 기록은 disk-space SSoT 가드가 자동 중단(diag-log·collect.sh).
 */
function logDiskStatusIfLow(): void {
  const { status, freeBytes } = getDiskStatus(SPYGLASS_DIR);
  if (status === 'ok' || status === 'unknown') return;
  const mb = freeBytes !== null ? Math.round(freeBytes / (1024 * 1024)) : '?';
  if (status === 'critical') {
    console.warn(
      `[Maintenance] DISK CRITICAL: ${mb}MB free at ${SPYGLASS_DIR} — raw/diag logging suppressed. ` +
        `Free up space to avoid write I/O stalls (can hang the server).`
    );
  } else {
    console.warn(`[Maintenance] disk low: ${mb}MB free at ${SPYGLASS_DIR}.`);
  }
}

let maintenanceTimer: ReturnType<typeof setInterval> | null = null;

export function startMaintenanceSchedule(database: SpyglassDatabase): void {
  // 부팅 직후 즉시 실행 — async 결과는 await 하지 않음 (부팅 lifecycle 봉쇄 금지).
  logDiskStatusIfLow();
  void runDailyMaintenanceIfNeeded(database);
  maintenanceTimer = setInterval(
    () => {
      logDiskStatusIfLow();
      void runDailyMaintenanceIfNeeded(database);
    },
    MAINTENANCE_INTERVAL_MS
  );
}

export function stopMaintenanceSchedule(): void {
  if (maintenanceTimer) {
    clearInterval(maintenanceTimer);
    maintenanceTimer = null;
  }
}
