/**
 * archiveOldData — Hot→Archive 이주 코어 회귀 가드 (단계2)
 *
 * @description
 *   round-trip(archive→load==원본) / 파티션(safeArchiveTs 미만만 이주) / 원자성(파일 실패→Hot 보존,
 *   트랜잭션 중단→index 미INSERT) / 멱등을 고정한다. 1차 대상은 claude_events.
 *
 * @see packages/storage/src/archive/migrate-to-archive.ts
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';
import { FileArchiveStore, type ArchiveStore } from '../archive/archive-store';
import { getArchiveIndexRows } from '../archive/archive-index';
import { archiveOldData } from '../archive/migrate-to-archive';

const DAY = 86400_000;
let db: Database;
let dir: string;
let store: FileArchiveStore;
beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
  dir = mkdtempSync(join(tmpdir(), 'spyglass-mig-'));
  store = new FileArchiveStore(dir);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** claude_events 행 시드 (event_id, timestamp, session_id, payload). */
function seedEvent(eventId: string, ts: number, session = 's1'): void {
  db.run(
    `INSERT INTO claude_events (event_id, event_type, session_id, timestamp, payload) VALUES (?, 'PreToolUse', ?, ?, ?)`,
    [eventId, session, ts, JSON.stringify({ k: '값 ' + eventId })],
  );
}
function eventCount(): number {
  return (db.query('SELECT COUNT(*) AS n FROM claude_events').get() as { n: number }).n;
}

describe('archiveOldData — claude_events', () => {
  test('safeArchiveTs 미만만 이주 (파티션) + round-trip + Hot 삭제', () => {
    seedEvent('e1', DAY * 10);
    seedEvent('e2', DAY * 10 + 5000);
    seedEvent('e3', DAY * 50); // 최신 — 이주 대상 아님
    const r = archiveOldData(db, { safeArchiveTs: DAY * 20, store });

    expect(r.archived).toBe(2);
    expect(r.byTable.claude_events).toBe(2);
    expect(eventCount()).toBe(1); // e3만 Hot에 남음

    // archive_index 2행 + 파일 존재
    const idx = getArchiveIndexRows(db, 'claude_events', { order: 'ASC' });
    expect(idx.map((x) => x.row_id)).toEqual(['e1', 'e2']);
    const file = idx[0].archive_file;
    expect(file).toMatch(/^\d{4}-\d{2}-\d{2}\.claude_events\.jsonl\.zst$/);

    // round-trip: archive 라인 parse == 원본 행 필드
    const lines = store.readDay(file).map((l) => JSON.parse(l));
    const e1 = lines.find((l) => l.event_id === 'e1');
    expect(e1.timestamp).toBe(DAY * 10);
    expect(JSON.parse(e1.payload)).toEqual({ k: '값 e1' });
  });

  test('멱등 — 재실행 시 이미 이주된 행은 대상 아님(Hot에서 사라졌으므로)', () => {
    seedEvent('e1', DAY * 10);
    archiveOldData(db, { safeArchiveTs: DAY * 20, store });
    const r2 = archiveOldData(db, { safeArchiveTs: DAY * 20, store });
    expect(r2.archived).toBe(0);
  });

  test('원자성 — 파일 write 실패 시 Hot 보존 + archive_index 미기록', () => {
    seedEvent('e1', DAY * 10);
    seedEvent('e2', DAY * 11);
    const failing: ArchiveStore = {
      appendDay: () => { throw new Error('disk full'); },
      readDay: () => [],
      exists: () => false,
      remove: () => {},
    };
    expect(() => archiveOldData(db, { safeArchiveTs: DAY * 20, store: failing })).toThrow('disk full');
    // 파일 실패는 DB 트랜잭션 이전 → Hot 보존, index 미기록
    expect(eventCount()).toBe(2);
    expect(getArchiveIndexRows(db, 'claude_events').length).toBe(0);
  });

  test('이주 대상 없음(safeArchiveTs 과거) → no-op', () => {
    seedEvent('e1', DAY * 50);
    const r = archiveOldData(db, { safeArchiveTs: DAY * 10, store });
    expect(r.archived).toBe(0);
    expect(eventCount()).toBe(1);
  });

  test('여러 날짜 → 날짜별 파일 분리', () => {
    seedEvent('a', DAY * 10);
    seedEvent('b', DAY * 11);
    seedEvent('c', DAY * 11 + 100);
    archiveOldData(db, { safeArchiveTs: DAY * 20, store });
    const files = new Set(getArchiveIndexRows(db, 'claude_events').map((x) => x.archive_file));
    expect(files.size).toBe(2); // day10, day11
  });
});
