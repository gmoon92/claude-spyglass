/**
 * events 조회 Hot/Archive 병합 (단계2) — getEventsBySession/byType/recent
 *
 * @see packages/storage/src/queries/event.ts
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';
import { createEvent, getEventsBySession, getEventsByType, getRecentEvents } from '../queries/event';
import { archiveOldData } from '../archive/migrate-to-archive';
import { FileArchiveStore, getArchiveDir } from '../archive';

const DAY = 86400_000;
let tmpDir: string;
let db: Database;
let store: FileArchiveStore;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'spyglass-ev-'));
  db = new Database(join(tmpDir, 'test.db'));
  runMigrations(db);
  store = new FileArchiveStore(getArchiveDir(db));
});
afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function seed(eventId: string, ts: number, opts: { session?: string; type?: string } = {}): void {
  createEvent(db, {
    event_id: eventId, event_type: opts.type ?? 'PreToolUse', session_id: opts.session ?? 's1',
    timestamp: ts, payload: JSON.stringify({ e: eventId }),
  });
}

describe('events 조회 병합 — 이주 전/후 동일', () => {
  test('getEventsBySession: archive 이벤트 포함', () => {
    seed('e1', DAY * 10, { session: 's1' });
    seed('e2', DAY * 11, { session: 's1' });
    seed('e3', DAY * 50, { session: 's1' });
    const before = getEventsBySession(db, 's1', 100);
    expect(before.map((e) => e.event_id)).toEqual(['e3', 'e2', 'e1']); // DESC

    archiveOldData(db, { safeArchiveTs: DAY * 20, store }); // e1,e2 이주
    const after = getEventsBySession(db, 's1', 100);
    expect(after.map((e) => e.event_id)).toEqual(['e3', 'e2', 'e1']); // 병합 동일
    expect(JSON.parse(after[2].payload)).toEqual({ e: 'e1' }); // payload 복원
  });

  test('getEventsByType: type 필터 archive 적용', () => {
    seed('a', DAY * 10, { type: 'Stop' });
    seed('b', DAY * 10, { type: 'PreToolUse' });
    archiveOldData(db, { safeArchiveTs: DAY * 20, store });
    expect(getEventsByType(db, 'Stop', 100).map((e) => e.event_id)).toEqual(['a']);
  });

  test('getRecentEvents: 전체 DESC 병합', () => {
    seed('old', DAY * 10);
    seed('new', DAY * 50);
    archiveOldData(db, { safeArchiveTs: DAY * 20, store }); // old 이주
    expect(getRecentEvents(db, 100).map((e) => e.event_id)).toEqual(['new', 'old']);
  });

  test('archive 빈 상태 → Hot-only 무변경', () => {
    seed('x', DAY * 10);
    expect(getRecentEvents(db, 100).map((e) => e.event_id)).toEqual(['x']);
  });
});
