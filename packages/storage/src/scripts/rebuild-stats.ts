#!/usr/bin/env bun
/**
 * stats_hourly 재집계 스크립트.
 *
 * 사용처:
 *   - 산식 변경 또는 데이터 불일치 의심 시 수동 실행
 *   - 외부 데이터 정정 후 일관성 회복
 *   - retention 외 대량 DELETE 후 보정
 *
 * 호출:
 *   bun run rebuild-stats               전체 stats_hourly 절단 + requests 전체 재집계
 *   bun run rebuild-stats --since=<sec> 지정 unix sec 이후 hour 버킷만 재집계
 *
 * 멱등성:
 *   - DELETE + INSERT를 단일 트랜잭션으로 묶어 동시 hook insert와의 race를 차단.
 *   - 같은 명령을 두 번 실행해도 결과 동일.
 */
import { SpyglassDatabase, closeDatabase } from '../connection';
import { rebuildStatsHourly } from '../queries/stats/build-aggregate';

function parseSince(argv: string[]): number | undefined {
  for (const arg of argv) {
    const match = /^--since=(\d+)$/.exec(arg);
    if (match) return Number.parseInt(match[1], 10);
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(
      'rebuild-stats — stats_hourly 재집계\n\nUsage:\n  rebuild-stats              전체 재집계\n  rebuild-stats --since=<sec> hour_ts >= sec 범위만 재집계\n'
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
    const result = rebuildStatsHourly(db.instance, { sinceTs, truncate: true });
    rowsInserted = result.rowsInserted;
  })();
  const elapsedMs = Date.now() - start;
  // eslint-disable-next-line no-console
  console.log(
    `[rebuild-stats] sinceTs=${sinceTs ?? '<all>'} rowsInserted=${rowsInserted} elapsedMs=${elapsedMs}`
  );
  closeDatabase();
}

main();
