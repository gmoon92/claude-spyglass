/**
 * Warm Archive retention GC (단계2, ADR A1) — 이주된 데이터도 retention 경계 도달 시 삭제
 *
 * @description
 *   회귀 가드: 이주(archiveOldData)로 archive에 들어간 파일/index/집계 버킷이 retention cutoff에
 *   도달하면 삭제돼야 한다(무한 축적 방지). '완전 만료 파일' 단위 GC라, cutoff를 걸치지 않은
 *   최신 archive는 보존된다. archive 비어 있으면(이주 비활성 기본) 전부 no-op.
 *
 * @see packages/storage/src/archive/archive-retention.ts
 * @see packages/storage/src/queries/session/retention.ts (deleteOldData 배선)
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';
import { createRequest } from '../queries/request/write';
import { createEvent } from '../queries/event';
import { deleteOldData } from '../queries/session/retention';
import { archiveOldData } from '../archive/migrate-to-archive';
import { deleteExpiredArchive } from '../archive/archive-retention';
import { FileArchiveStore, getArchiveDir } from '../archive';

const DAY = 86400_000; // ms

let tmpDir: string;
let db: Database;
let store: FileArchiveStore;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'spyglass-gc-'));
  db = new Database(join(tmpDir, 'test.db'));
  runMigrations(db);
  store = new FileArchiveStore(getArchiveDir(db)); // 이주/GC 동일 경로
});
afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function seedReq(id: string, tsDay: number): void {
  createRequest(db, {
    id, session_id: 's1', timestamp: tsDay * DAY, type: 'tool_call', tool_name: 'Read',
    event_type: 'tool', tokens_input: 0, tokens_output: 0, tokens_total: 0,
  });
}
function seedEvent(id: string, tsDay: number): void {
  createEvent(db, {
    event_id: id, event_type: 'PreToolUse', session_id: 's1', timestamp: tsDay * DAY,
    payload: JSON.stringify({ e: id }),
  });
}
/** archive_stats_hourly 버킷 직접 삽입(GC hour_ts 컷 검증용). */
function seedArchiveStat(tsDay: number): void {
  db.run(`INSERT INTO archive_stats_hourly (hour_ts, type) VALUES (?, 'tool_call')`, [tsDay * DAY / 1000]);
  db.run(`INSERT INTO archive_stats_proxy_hourly (hour_ts) VALUES (?)`, [tsDay * DAY / 1000]);
}
function indexCount(): number {
  return (db.query(`SELECT COUNT(*) AS c FROM archive_index`).get() as { c: number }).c;
}
function statCount(table: string): number {
  return (db.query(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
}

describe('deleteExpiredArchive — 완전 만료 파일/버킷만 삭제', () => {
  beforeEach(() => {
    // day5,6(만료 예정) + day20(보존) requests/events 이주
    seedReq('r5', 5); seedReq('r6', 6); seedReq('r20', 20);
    seedEvent('e5', 5); seedEvent('e20', 20);
    archiveOldData(db, { safeArchiveTs: 25 * DAY, store }); // 전부 archive로
    seedArchiveStat(5); seedArchiveStat(20); // 집계 버킷 day5(만료)·day20(보존)
  });

  test('cutoff(day10) 미만 파일+index+집계 버킷 삭제, 최신 보존', () => {
    expect(indexCount()).toBe(5); // r5,r6,r20,e5,e20

    const res = deleteExpiredArchive(db, 10 * DAY, store);

    // day5.requests, day6.requests, day5.claude_events = 3파일 / index 3행
    expect(res.filesDeleted).toBe(3);
    expect(res.indexRows).toBe(3);
    expect(res.statsHourly).toBe(1); // day5 버킷
    expect(res.statsProxy).toBe(1);

    // 잔존: day20 requests/events(2행) + day20 집계 버킷
    expect(indexCount()).toBe(2);
    expect(statCount('archive_stats_hourly')).toBe(1);
    expect(statCount('archive_stats_proxy_hourly')).toBe(1);

    // 파일 물리 삭제 확인
    expect(store.exists('1970-01-06.requests.jsonl.zst')).toBe(false); // day5
    expect(store.exists('1970-01-07.requests.jsonl.zst')).toBe(false); // day6
    expect(store.exists('1970-01-06.claude_events.jsonl.zst')).toBe(false); // day5 events
    expect(store.exists('1970-01-21.requests.jsonl.zst')).toBe(true); // day20 보존
  });

  test('cutoff가 모든 데이터 이전(day1)이면 no-op', () => {
    const res = deleteExpiredArchive(db, 1 * DAY, store);
    expect(res).toEqual({ indexRows: 0, filesDeleted: 0, statsHourly: 0, statsProxy: 0 });
    expect(indexCount()).toBe(5);
  });
});

describe('archive 비어 있음(이주 비활성) → no-op', () => {
  test('전부 0', () => {
    const res = deleteExpiredArchive(db, 100 * DAY, store);
    expect(res).toEqual({ indexRows: 0, filesDeleted: 0, statsHourly: 0, statsProxy: 0 });
  });
});

describe('deleteOldData 통합 — retention 사이클이 archive GC까지 수행', () => {
  test('이주된 오래된 데이터가 retention cutoff에서 archive에서도 사라짐', () => {
    seedReq('r5', 5); seedReq('r20', 20);
    archiveOldData(db, { safeArchiveTs: 25 * DAY, store });
    expect(indexCount()).toBe(2);

    deleteOldData(db, 10 * DAY); // retention cutoff = day10

    expect(indexCount()).toBe(1); // day5 GC, day20 보존
    expect(store.exists('1970-01-06.requests.jsonl.zst')).toBe(false);
    expect(store.exists('1970-01-21.requests.jsonl.zst')).toBe(true);
  });
});
