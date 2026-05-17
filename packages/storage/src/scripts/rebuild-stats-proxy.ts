#!/usr/bin/env bun
/**
 * stats_proxy_hourly 재집계 스크립트 (proxy-hourly ADR-005).
 *
 * 사용처:
 *   - proxy_requests 정정 후 보정
 *   - 산식 변경 후 일관성 회복
 *
 * 호출:
 *   bun run rebuild-stats-proxy               전체 재집계
 *   bun run rebuild-stats-proxy --since=<sec> 지정 unix sec 이후만
 */
import { SpyglassDatabase, closeDatabase } from '../connection';
import { rebuildStatsProxyHourly } from '../queries/stats/build-proxy-aggregate';

function parseSince(argv: string[]): number | undefined {
  for (const arg of argv) {
    const match = /^--since=(\d+)$/.exec(arg);
    if (match) return Number.parseInt(match[1], 10);
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(
      'rebuild-stats-proxy — stats_proxy_hourly 재집계\n\nUsage:\n  rebuild-stats-proxy              전체 재집계\n  rebuild-stats-proxy --since=<sec> hour_ts >= sec 범위만 재집계\n'
    );
    process.exit(0);
  }
  return undefined;
}

function main(): void {
  const sinceTs = parseSince(process.argv.slice(2));
  const db = new SpyglassDatabase();
  const start = Date.now();
  let rowsInserted = 0;
  db.instance.transaction(() => {
    const result = rebuildStatsProxyHourly(db.instance, { sinceTs, truncate: true });
    rowsInserted = result.rowsInserted;
  })();
  const elapsedMs = Date.now() - start;
  // eslint-disable-next-line no-console
  console.log(
    `[rebuild-stats-proxy] sinceTs=${sinceTs ?? '<all>'} rowsInserted=${rowsInserted} elapsedMs=${elapsedMs}`
  );
  closeDatabase();
}

main();
