/**
 * raw-`requests` 집계 readers Hot/Archive 병합 (단계2 (1-잔여)) — 이주 전/후 exact
 *
 * @description
 *   stats 버킷이 아닌 raw requests를 직접 집계하던 readers(P95·avg duration·strip·bySession·
 *   burn rate·anomaly)는 사전집계가 없어 archive 원행을 loadArchivedRequestRows로 로드해 JS에서
 *   Hot 집계와 합산한다. 최우선 회귀 가드: 이주(archiveOldData) 전/후 모든 reader 결과가 동일.
 *
 * @see packages/storage/src/queries/request/read.ts (loadArchivedRequestRows)
 * @see packages/storage/src/queries/request/{aggregate-latency,aggregate-strip,aggregate-general}.ts
 * @see packages/storage/src/queries/metrics/timeseries.ts
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';
import { createRequest } from '../queries/request/write';
import { archiveOldData } from '../archive/migrate-to-archive';
import { FileArchiveStore, getArchiveDir } from '../archive';
import { getAvgPromptDurationMs, getP95DurationMs } from '../queries/request/aggregate-latency';
import { getStripStats } from '../queries/request/aggregate-strip';
import { getRequestStatsBySession } from '../queries/request/aggregate-general';
import { getBurnRateBuckets, getAnomalyTimeSeriesInputs } from '../queries/metrics/timeseries';

const DAY = 86400_000; // ms

let tmpDir: string;
let db: Database;
let store: FileArchiveStore;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'spyglass-rawm-'));
  db = new Database(join(tmpDir, 'test.db'));
  runMigrations(db);
  store = new FileArchiveStore(getArchiveDir(db));
});
afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

interface SeedOpts {
  session?: string; type?: string; event?: string; tool?: string; detail?: string;
  ti?: number; to?: number; tot?: number; dur?: number; conf?: string; turn?: string;
}
function seedReq(id: string, tsDay: number, o: SeedOpts = {}): void {
  createRequest(db, {
    id, session_id: o.session ?? 's1', timestamp: tsDay * DAY,
    type: (o.type ?? 'tool_call') as never, tool_name: o.tool ?? 'Read',
    event_type: o.event ?? 'tool', tool_detail: o.detail, turn_id: o.turn,
    tokens_input: o.ti ?? 0, tokens_output: o.to ?? 0, tokens_total: o.tot ?? 0,
    duration_ms: o.dur ?? 0, tokens_confidence: o.conf ?? 'high',
  });
}

/** old(day5,6)=이주 대상 + recent(day50)=Hot 유지 혼합 시드. */
function seedMix(): void {
  // day5 (archive 예정)
  seedReq('a5', 5, { dur: 100, detail: 'ok' });
  seedReq('b5', 5, { dur: 500, detail: 'Error: boom' });        // 오류
  seedReq('p5', 5, { type: 'prompt', event: '', tool: 'x', tot: 1000 });
  // day6 (archive 예정)
  seedReq('c6', 6, { dur: 300 });
  // day50 (Hot 유지)
  seedReq('d50', 50, { dur: 200, detail: 'ok' });
  seedReq('e50', 50, { dur: 700000 });                          // avg <600000 컷 대상, p95엔 포함
  seedReq('p50', 50, { type: 'prompt', event: '', tool: 'x', tot: 2000 });
  seedReq('pre50', 50, { event: 'pre_tool', tool: 'Read' });    // ACTIVE 필터 제외
}

describe('raw-requests 집계 — 이주 전/후 exact', () => {
  beforeEach(seedMix);

  test('getAvgPromptDurationMs', () => {
    const before = getAvgPromptDurationMs(db);
    archiveOldData(db, { safeArchiveTs: 25 * DAY, store });
    expect(getAvgPromptDurationMs(db)).toEqual(before);
  });

  test('getP95DurationMs', () => {
    const before = getP95DurationMs(db);
    archiveOldData(db, { safeArchiveTs: 25 * DAY, store });
    expect(getP95DurationMs(db)).toEqual(before);
  });

  test('getStripStats (p95 + error_rate)', () => {
    const before = getStripStats(db);
    archiveOldData(db, { safeArchiveTs: 25 * DAY, store });
    expect(getStripStats(db)).toEqual(before);
  });

  test('getRequestStatsBySession', () => {
    const before = getRequestStatsBySession(db, 's1');
    archiveOldData(db, { safeArchiveTs: 25 * DAY, store });
    expect(getRequestStatsBySession(db, 's1')).toEqual(before);
  });

  test('getBurnRateBuckets', () => {
    const before = getBurnRateBuckets(db);
    archiveOldData(db, { safeArchiveTs: 25 * DAY, store });
    expect(getBurnRateBuckets(db)).toEqual(before);
  });

  test('getAnomalyTimeSeriesInputs', () => {
    const before = getAnomalyTimeSeriesInputs(db);
    archiveOldData(db, { safeArchiveTs: 25 * DAY, store });
    expect(getAnomalyTimeSeriesInputs(db)).toEqual(before);
  });

  test('범위 조회(archive 구간 한정)도 병합 정확', () => {
    archiveOldData(db, { safeArchiveTs: 25 * DAY, store });
    // day4~day7 → archive의 a5,b5,c6 (tool_call/tool/dur>0): [100,500,300]
    const p95 = getP95DurationMs(db, 4 * DAY, 7 * DAY);
    expect(p95).toBe(500); // ceil(3*0.95)-1=2 → 정렬 [100,300,500][2]
  });
});

describe('archive 비어 있음(이주 비활성) → Hot-only 무변경', () => {
  test('archive 무접촉 시 Hot 값 그대로', () => {
    seedReq('h', 50, { dur: 100, detail: 'ok' });
    expect(getP95DurationMs(db)).toBe(100);
    expect(getStripStats(db).error_rate).toBe(0);
  });
});
