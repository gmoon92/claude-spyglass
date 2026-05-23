#!/usr/bin/env bun
/**
 * Read-path benchmark — storage-redesign-v3 cutover 결정 데이터 수집용.
 *
 * 측정 대상:
 *   - Legacy   : getAllRequests / getTurnsBySession + normalizeRequests + enrichWithAnomalies
 *   - V3 (현재) : getRequestViewBySession / getTurnViewBySession (read-optimized projection)
 *
 * 출력:
 *   각 시나리오의 p50 / p95 / p99 / max / mean (ms) — 운영 cutover 의사결정 기준.
 *
 * 사용:
 *   bun run packages/storage/src/scripts/bench-read.ts             // 전체 시나리오, 200회씩
 *   bun run packages/storage/src/scripts/bench-read.ts --iter=500
 *   bun run packages/storage/src/scripts/bench-read.ts --db=/path/to/spyglass.db --session=<id>
 *   bun run packages/storage/src/scripts/bench-read.ts --legacy-only      // v3 미materialize 환경
 *
 * 주의:
 *   - 실측 base 는 운영 DB 사본 권장 (스냅샷). benchmark 가 운영 DB 를 잠그지는 않으나 (WAL),
 *     대량 read 가 다른 작업에 영향 줄 수 있어 사본이 안전.
 *   - 첫 1회는 cold-cache, 측정 전 warm-up 5회 실행.
 *
 * @see .claude/docs/plans/storage-redesign-v3/redesign-plan.md Phase 7
 */

import { SpyglassDatabase, closeDatabase } from '../connection';
import { getAllRequests, getTurnsBySession } from '../queries/request';
import { getAllSessions } from '../queries/session';
import { getRequestViewBySession, getRecentRequestView, getTurnViewBySession } from '../queries/v3';

interface BenchOptions {
  iter: number;
  dbPath?: string;
  sessionId?: string;
  legacyOnly: boolean;
  v3Only: boolean;
}

function parseArgs(argv: string[]): BenchOptions {
  const opts: BenchOptions = { iter: 200, legacyOnly: false, v3Only: false };
  for (const arg of argv) {
    if (arg.startsWith('--iter=')) opts.iter = parseInt(arg.slice(7), 10) || 200;
    else if (arg.startsWith('--db=')) opts.dbPath = arg.slice(5);
    else if (arg.startsWith('--session=')) opts.sessionId = arg.slice(10);
    else if (arg === '--legacy-only') opts.legacyOnly = true;
    else if (arg === '--v3-only') opts.v3Only = true;
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        'bench-read — read path latency 측정\n\n' +
        'Usage:\n' +
        '  bench-read [--iter=N] [--db=PATH] [--session=ID]\n' +
        '             [--legacy-only] [--v3-only]\n\n' +
        '기본: 200회 반복, 운영 DB, 임의 첫 세션.\n'
      );
      process.exit(0);
    }
  }
  return opts;
}

interface Stat {
  scenario: string;
  iter: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
  mean_ms: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

function measure(scenario: string, iter: number, fn: () => void): Stat {
  // warm-up
  for (let i = 0; i < 5; i++) fn();

  const samples: number[] = [];
  for (let i = 0; i < iter; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
  return {
    scenario,
    iter,
    p50_ms: round2(percentile(samples, 0.5)),
    p95_ms: round2(percentile(samples, 0.95)),
    p99_ms: round2(percentile(samples, 0.99)),
    max_ms: round2(samples[samples.length - 1]),
    mean_ms: round2(mean),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatTable(stats: Stat[]): string {
  if (stats.length === 0) return '(no data)';
  const headers = ['scenario', 'iter', 'p50_ms', 'p95_ms', 'p99_ms', 'max_ms', 'mean_ms'];
  const rows = stats.map((s) => [
    s.scenario,
    String(s.iter),
    s.p50_ms.toFixed(2),
    s.p95_ms.toFixed(2),
    s.p99_ms.toFixed(2),
    s.max_ms.toFixed(2),
    s.mean_ms.toFixed(2),
  ]);
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const sep = '  ';
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join(sep);
  return [
    line(headers),
    line(widths.map((w) => '-'.repeat(w))),
    ...rows.map(line),
  ].join('\n');
}

function pickSessionId(db: SpyglassDatabase, override?: string): string | null {
  if (override) return override;
  const sessions = getAllSessions(db.instance, 1);
  if (sessions.length === 0) return null;
  return sessions[0].id;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const db = opts.dbPath ? new SpyglassDatabase({ dbPath: opts.dbPath }) : new SpyglassDatabase();

  const sessionId = pickSessionId(db, opts.sessionId);
  if (!sessionId) {
    console.error('[bench-read] no sessions found — populate DB first.');
    process.exit(1);
  }

  const stats: Stat[] = [];

  if (!opts.v3Only) {
    // Legacy 경로 — 핵심 read API 가 실제로 호출하는 함수들
    stats.push(measure('legacy: getAllRequests(LIMIT 200)', opts.iter, () => {
      getAllRequests(db.instance, 200);
    }));
    stats.push(measure(`legacy: getTurnsBySession(${sessionId.slice(0, 8)})`, opts.iter, () => {
      getTurnsBySession(db.instance, sessionId);
    }));
  }

  if (!opts.legacyOnly) {
    // V3 경로 — read-optimized projection
    stats.push(measure('v3: getRecentRequestView(200)', opts.iter, () => {
      getRecentRequestView(db.instance, 200);
    }));
    stats.push(measure(`v3: getRequestViewBySession(${sessionId.slice(0, 8)})`, opts.iter, () => {
      getRequestViewBySession(db.instance, sessionId, 200);
    }));
    stats.push(measure(`v3: getTurnViewBySession(${sessionId.slice(0, 8)})`, opts.iter, () => {
      getTurnViewBySession(db.instance, sessionId);
    }));
  }

  console.log('\n=== Read benchmark ===');
  console.log(`db        : ${opts.dbPath ?? '(default)'}`);
  console.log(`session   : ${sessionId}`);
  console.log(`iter      : ${opts.iter}`);
  console.log('');
  console.log(formatTable(stats));
  console.log('');

  closeDatabase();
}

if (import.meta.main) {
  main();
}
