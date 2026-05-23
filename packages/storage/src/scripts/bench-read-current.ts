#!/usr/bin/env bun
/**
 * 현재 read path latency baseline 측정.
 *
 * 측정:
 *   - getAllRequests(LIMIT N) : 메인 로그 피드
 *   - normalizeRequests(rows) : sub_type / trust_level / model fallback (read 시 계산)
 *   - enrichWithAnomalies(rows) : Agent 행마다 depth-3 WITH RECURSIVE
 *   - getTurnsBySession(largest) : 6쿼리 + 인메모리 join
 *
 * 사용:
 *   bun run packages/storage/src/scripts/bench-read-current.ts --db=/tmp/spyglass-bench.db --iter=50
 */

import { SpyglassDatabase, closeDatabase } from '../connection';
import { getAllRequests, getTurnsBySession } from '../queries/request';
import { getAllSessions } from '../queries/session';
import { normalizeRequests } from '../../../server/src/domain/request-normalizer';
import { enrichWithAnomalies } from '../../../server/src/domain/anomaly-enricher';

interface Opts {
  iter: number;
  dbPath?: string;
  sessionId?: string;
  limit: number;
}

function parseArgs(argv: string[]): Opts {
  const o: Opts = { iter: 50, limit: 200 };
  for (const a of argv) {
    if (a.startsWith('--iter=')) o.iter = parseInt(a.slice(7), 10) || 50;
    else if (a.startsWith('--db=')) o.dbPath = a.slice(5);
    else if (a.startsWith('--session=')) o.sessionId = a.slice(10);
    else if (a.startsWith('--limit=')) o.limit = parseInt(a.slice(8), 10) || 200;
  }
  return o;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[i];
}

function measure(name: string, iter: number, fn: () => void): void {
  for (let i = 0; i < 3; i++) fn(); // warm-up
  const samples: number[] = [];
  for (let i = 0; i < iter; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
  console.log(
    `${name.padEnd(45)}  p50=${percentile(samples, 0.5).toFixed(2).padStart(7)}ms  ` +
      `p95=${percentile(samples, 0.95).toFixed(2).padStart(7)}ms  ` +
      `p99=${percentile(samples, 0.99).toFixed(2).padStart(7)}ms  ` +
      `max=${samples[samples.length - 1].toFixed(2).padStart(7)}ms  ` +
      `mean=${mean.toFixed(2).padStart(7)}ms`,
  );
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const db = opts.dbPath ? new SpyglassDatabase({ dbPath: opts.dbPath }) : new SpyglassDatabase();

  // 가장 큰 세션 자동 선택
  let sessionId = opts.sessionId;
  if (!sessionId) {
    const sessions = getAllSessions(db.instance, 10);
    // requests 카운트 기준 가장 큰 세션
    let max = 0;
    for (const s of sessions) {
      const c = db.instance
        .query('SELECT COUNT(*) AS n FROM requests WHERE session_id = ?')
        .get(s.id) as { n: number };
      if (c.n > max) {
        max = c.n;
        sessionId = s.id;
      }
    }
  }

  console.log(`\n=== Read baseline (iter=${opts.iter}, limit=${opts.limit}) ===`);
  console.log(`db      : ${opts.dbPath ?? '(default)'}`);
  console.log(`session : ${sessionId}`);
  console.log('');

  // 1. raw query — getAllRequests
  measure(`getAllRequests(${opts.limit})`, opts.iter, () => {
    getAllRequests(db.instance, opts.limit);
  });

  // 2. raw + normalize
  measure(`getAllRequests + normalize`, opts.iter, () => {
    const rows = getAllRequests(db.instance, opts.limit);
    normalizeRequests(rows);
  });

  // 3. raw + normalize + anomaly (실제 /api/requests 가 호출하는 전체 체인)
  measure(`getAllRequests + normalize + anomaly`, opts.iter, () => {
    const rows = getAllRequests(db.instance, opts.limit);
    const normalized = normalizeRequests(rows);
    enrichWithAnomalies(db.instance, normalized);
  });

  // 4. getTurnsBySession — 6쿼리 + 인메모리 join
  if (sessionId) {
    measure(`getTurnsBySession(${sessionId.slice(0, 8)})`, opts.iter, () => {
      getTurnsBySession(db.instance, sessionId!);
    });
  }

  console.log('');
  closeDatabase();
}

if (import.meta.main) {
  await main();
}
