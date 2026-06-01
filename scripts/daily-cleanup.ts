#!/usr/bin/env bun
/**
 * 일별 정리 스크립트 — `bun run start` / `bun run dev` 흐름에서 서버 시작 전 자동 실행.
 *
 * 핵심 로직: `packages/server/src/runtime/maintenance.ts#runCleanupNow` (SSoT)
 *   - RDB 삭제 + VACUUM + 그래프 정리 + raw-log 버킷 정리
 *   - 날짜 추적: `~/.spyglass/maintenance-state.json` (서버 런타임과 공유)
 *
 * 사용:
 *   bun run scripts/daily-cleanup.ts            # 하루 1회 (날짜 체크)
 *   bun run scripts/daily-cleanup.ts -- --force  # 강제 실행 (날짜 무시)
 */

import {
  SpyglassDatabase,
} from '../packages/storage/src/connection';
import {
  runCleanupNow,
  getLastCleanupDate,
  setLastCleanupDate,
} from '../packages/server/src/runtime/maintenance';

const force = process.argv.includes('--force');
const today = new Date().toISOString().slice(0, 10);

if (!force && getLastCleanupDate() === today) {
  console.log(`[Cleanup] Already done today (${today}), skip. Use --force to override.`);
  process.exit(0);
}

console.log(`[Cleanup] Starting${force ? ' (forced)' : ''} — ${today}`);

const db = new SpyglassDatabase();
try {
  const result = await runCleanupNow(db);
  setLastCleanupDate(today);
  console.log(
    `[Cleanup] Done: removed ${result.deletedSessions} sessions older than ${result.retentionDays}d, ` +
      `pruned ${result.prunedRawLogs} raw-log buckets older than ${result.rawLogRetentionDays}d`
  );
} catch (err) {
  console.error('[Cleanup] Failed:', err);
  process.exit(1);
} finally {
  db.close();
}
