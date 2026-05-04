/**
 * 일별 유지보수 스케줄 — 보존 기간 초과 데이터 삭제 + VACUUM.
 *
 * 변경 이유: 보존 정책·VACUUM 정책·실행 주기 변경 시 한 곳만 수정.
 */

import { SpyglassDatabase, deleteOldData, getMetadata, setMetadata } from '@spyglass/storage';

const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000; // 1시간마다 조건 체크
const METADATA_KEY_LAST_CLEANUP = 'last_cleanup_date'; // 저장 형식: YYYY-MM-DD

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 오늘 아직 cleanup을 실행하지 않았으면 실행한다.
 * - 서버 시작 시 즉시 호출
 * - 이후 1시간 간격 인터벌에서도 호출 (날짜가 바뀐 시점을 놓치지 않기 위해)
 *
 * SPYGLASS_RETENTION_DAYS 환경변수로 보존 기간 설정 (기본: 1일)
 */
function runDailyMaintenanceIfNeeded(database: SpyglassDatabase): void {
  try {
    const today = todayDateString();
    const lastRun = getMetadata(database.instance, METADATA_KEY_LAST_CLEANUP);
    if (lastRun === today) return;

    const retentionDays = parseInt(process.env.SPYGLASS_RETENTION_DAYS ?? '1', 10);
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const deleted = deleteOldData(database.instance, cutoff);
    database.instance.run('PRAGMA VACUUM');

    setMetadata(database.instance, METADATA_KEY_LAST_CLEANUP, today);
    console.log(`[Maintenance] Cleanup done (${today}): removed ${deleted} sessions older than ${retentionDays}d`);
  } catch (err) {
    console.warn('[Maintenance] Cleanup failed:', err);
  }
}

let maintenanceTimer: ReturnType<typeof setInterval> | null = null;

export function startMaintenanceSchedule(database: SpyglassDatabase): void {
  runDailyMaintenanceIfNeeded(database);
  maintenanceTimer = setInterval(
    () => runDailyMaintenanceIfNeeded(database),
    MAINTENANCE_INTERVAL_MS
  );
}

export function stopMaintenanceSchedule(): void {
  if (maintenanceTimer) {
    clearInterval(maintenanceTimer);
    maintenanceTimer = null;
  }
}
