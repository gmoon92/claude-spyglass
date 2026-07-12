/**
 * 사전집계 버킷 Hot/Archive 병합 (단계2) — stats 이주 + UNION 조회 exact
 *
 * @description
 *   최우선 회귀 가드(ADR A6): stats_hourly/stats_proxy_hourly 버킷을 archive_stats_*로 이주한
 *   전/후, 모든 집계 조회 결과가 **완전히 동일(exact)**해야 한다. sum/count는 가법이라 UNION 후
 *   재집계 = 원본 집계. (P95는 비가법이라 별도 후순위 — 여기 미검증.)
 *
 *   이주 메커니즘은 행 아카이브(파일)와 달리 테이블 간 INSERT+DELETE이므로 파일/archive_index가
 *   관여하지 않는다. 그래도 archive-*-merge 회귀 스타일(이주 전/후 toEqual)을 그대로 따른다.
 *
 * @see packages/storage/src/archive/stats-bridge.ts
 * @see packages/storage/src/queries/{request/aggregate-general,request/aggregate-cache,proxy-stats,metrics/timeseries}.ts
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';
import { archiveOldStats } from '../archive/stats-bridge';
import { getRequestStats, getRequestStatsByType } from '../queries/request/aggregate-general';
import { getCacheStats } from '../queries/request/aggregate-cache';
import { getProxyHourlyStats, getProxyHourlyStatsByModel } from '../queries/proxy-stats';
import { getCacheTrendBuckets } from '../queries/metrics/timeseries';

const HOUR = 3600; // sec
const DAY = 86400; // sec — hour_ts는 unix epoch sec
const SAFE_TS_MS = 20 * DAY * 1000; // 이주 상한(ms, UTC일 경계). day10/11 < , day50 ≥

let tmpDir: string;
let db: Database;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'spyglass-sm-'));
  db = new Database(join(tmpDir, 'test.db'));
  runMigrations(db);
});
afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

/** stats_hourly 버킷 1행 삽입(가법 컬럼은 일부만 지정, 나머지 파생). */
function seedHourly(
  hourTs: number,
  opts: { type?: string; eventType?: string; model?: string; req?: number; tin?: number; tout?: number; cr?: number; cc?: number; dur?: number } = {},
): void {
  const type = opts.type ?? 'tool_call';
  const eventType = opts.eventType ?? 'tool';
  const req = opts.req ?? 1;
  const tin = opts.tin ?? 100;
  const tout = opts.tout ?? 50;
  const tot = tin + tout;
  const cc = opts.cc ?? 0;
  const cr = opts.cr ?? 0;
  const dur = opts.dur ?? 200;
  db.run(
    `INSERT INTO stats_hourly
       (hour_ts, model, type, event_type, request_count,
        tokens_input, tokens_output, tokens_total, cache_creation_tokens, cache_read_tokens,
        duration_ms_sum, duration_ms_count,
        tokens_input_high_sum, tokens_output_high_sum, tokens_total_high_sum, tokens_high_count)
     VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?, ?,?,?,?)`,
    [hourTs, opts.model ?? '', type, eventType, req, tin, tout, tot, cc, cr, dur, req, tin, tout, tot, req],
  );
}

/** stats_proxy_hourly 버킷 1행 삽입. */
function seedProxy(
  hourTs: number,
  opts: { model?: string; req?: number; err?: number; stream?: number; tin?: number; tout?: number; rt?: number; cost?: number } = {},
): void {
  const req = opts.req ?? 1;
  db.run(
    `INSERT INTO stats_proxy_hourly
       (hour_ts, model, request_count, error_count, stream_count,
        tokens_input, tokens_output, cache_creation_tokens, cache_read_tokens,
        response_time_ms_sum, response_time_ms_count, first_token_ms_sum, first_token_ms_count, cost_usd_sum)
     VALUES (?,?,?,?,?, ?,?,?,?, ?,?,?,?,?)`,
    [hourTs, opts.model ?? 'claude', req, opts.err ?? 0, opts.stream ?? 0,
     opts.tin ?? 100, opts.tout ?? 50, 0, 0, opts.rt ?? 300, req, 120, req, opts.cost ?? 0.01],
  );
}

function countHot(table: string): number {
  return (db.query(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
}

describe('stats_hourly 병합 — 이주 전/후 집계 exact', () => {
  beforeEach(() => {
    // old(day10,11) — 이주 대상. 다양한 type/event로 필터 재현 검증.
    seedHourly(10 * DAY, { type: 'tool_call', tin: 100, cr: 40, cc: 10 });
    seedHourly(10 * DAY + HOUR, { type: 'prompt', eventType: '', tin: 300, cr: 120, cc: 30 });
    seedHourly(11 * DAY, { type: 'response', eventType: '', tin: 80, cr: 0, cc: 0 });
    seedHourly(11 * DAY, { type: 'tool_call', model: 'sonnet', tin: 60, cr: 5, cc: 0 });
    // recent(day50) — Hot 유지.
    seedHourly(50 * DAY, { type: 'tool_call', tin: 90, cr: 33, cc: 7 });
    seedHourly(50 * DAY, { type: 'prompt', eventType: '', tin: 500, cr: 200, cc: 50 });
  });

  test('getRequestStats: 전체 집계 동일', () => {
    const before = getRequestStats(db);
    archiveOldStats(db, { safeArchiveTs: SAFE_TS_MS });
    expect(getRequestStats(db)).toEqual(before);
  });

  test('getRequestStatsByType: GROUP BY type 동일', () => {
    const before = getRequestStatsByType(db);
    archiveOldStats(db, { safeArchiveTs: SAFE_TS_MS });
    expect(getRequestStatsByType(db)).toEqual(before);
  });

  test('getCacheStats: 캐시 히트율/절감 동일', () => {
    const before = getCacheStats(db);
    archiveOldStats(db, { safeArchiveTs: SAFE_TS_MS });
    expect(getCacheStats(db)).toEqual(before);
  });

  test('getCacheTrendBuckets: 시계열 버킷 동일', () => {
    const before = getCacheTrendBuckets(db);
    archiveOldStats(db, { safeArchiveTs: SAFE_TS_MS });
    expect(getCacheTrendBuckets(db)).toEqual(before);
  });

  test('버킷 물리 이동: old는 archive로, recent는 Hot 유지', () => {
    archiveOldStats(db, { safeArchiveTs: SAFE_TS_MS });
    expect(countHot('stats_hourly')).toBe(2); // day50 tool_call + prompt
    expect(countHot('archive_stats_hourly')).toBe(4); // day10(2) + day11(2)
  });

  test('시간창 필터가 archive 구간에 정확 적용', () => {
    archiveOldStats(db, { safeArchiveTs: SAFE_TS_MS });
    // day10~11(archive)만 포함하는 창
    const from = 9 * DAY * 1000;
    const to = 12 * DAY * 1000;
    const windowed = getRequestStats(db, from, to);
    // recent(day50) 제외 → total_requests = old 4버킷 request_count(각 1) = 4
    expect(windowed.total_requests).toBe(4);
  });
});

describe('stats_proxy_hourly 병합 — 이주 전/후 집계 exact', () => {
  beforeEach(() => {
    seedProxy(10 * DAY, { model: 'claude', req: 3, err: 1, stream: 2, cost: 0.05 });
    seedProxy(11 * DAY, { model: 'sonnet', req: 5, err: 0, stream: 5, cost: 0.12 });
    seedProxy(50 * DAY, { model: 'claude', req: 7, err: 2, stream: 1, cost: 0.30 });
  });

  test('getProxyHourlyStats: 전체 동일', () => {
    const before = getProxyHourlyStats(db);
    archiveOldStats(db, { safeArchiveTs: SAFE_TS_MS });
    expect(getProxyHourlyStats(db)).toEqual(before);
  });

  test('getProxyHourlyStatsByModel: 모델별 동일', () => {
    const before = getProxyHourlyStatsByModel(db);
    archiveOldStats(db, { safeArchiveTs: SAFE_TS_MS });
    expect(getProxyHourlyStatsByModel(db)).toEqual(before);
  });

  test('버킷 물리 이동', () => {
    archiveOldStats(db, { safeArchiveTs: SAFE_TS_MS });
    expect(countHot('stats_proxy_hourly')).toBe(1); // day50
    expect(countHot('archive_stats_proxy_hourly')).toBe(2); // day10,11
  });
});

describe('가법 재이주 — 늦게 도착한 동일 PK 버킷은 archive에 더해짐(ON CONFLICT)', () => {
  test('archive 기존 + Hot 늦은 도착 = 합산', () => {
    // 이미 아카이브된 버킷(day10)
    db.run(
      `INSERT INTO archive_stats_hourly
         (hour_ts, model, type, event_type, request_count, tokens_input, tokens_output, tokens_total,
          cache_creation_tokens, cache_read_tokens, duration_ms_sum, duration_ms_count,
          tokens_input_high_sum, tokens_output_high_sum, tokens_total_high_sum, tokens_high_count)
       VALUES (?, '', 'tool_call', 'tool', 5, 500, 250, 750, 0, 0, 1000, 5, 500, 250, 750, 5)`,
      [10 * DAY],
    );
    // 동일 PK로 늦게 도착한 Hot 버킷
    seedHourly(10 * DAY, { type: 'tool_call', req: 3, tin: 300, tout: 150, dur: 600 });

    archiveOldStats(db, { safeArchiveTs: SAFE_TS_MS });

    const merged = db.query(
      `SELECT request_count, tokens_input, duration_ms_sum, duration_ms_count
       FROM archive_stats_hourly WHERE hour_ts = ? AND type = 'tool_call' AND event_type = 'tool' AND model = ''`,
    ).get(10 * DAY) as { request_count: number; tokens_input: number; duration_ms_sum: number; duration_ms_count: number };
    expect(merged.request_count).toBe(8); // 5 + 3
    expect(merged.tokens_input).toBe(800); // 500 + 300
    expect(merged.duration_ms_sum).toBe(1600); // 1000 + 600
    expect(merged.duration_ms_count).toBe(8); // 5 + 3
    expect(countHot('stats_hourly')).toBe(0); // Hot 비워짐
  });
});

describe('archive 빈 상태 → Hot-only 무변경', () => {
  test('이주하지 않으면 집계는 stats_hourly만 반영', () => {
    seedHourly(50 * DAY, { type: 'tool_call', tin: 90 });
    const stats = getRequestStats(db);
    expect(stats.total_requests).toBe(1);
    expect(stats.total_tokens_input).toBe(90);
  });
});
