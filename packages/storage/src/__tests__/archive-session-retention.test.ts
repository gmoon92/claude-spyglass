/**
 * 세션 retention 정합 (단계2, ADR A7 사이드) — archive 자식이 세션 메타를 보호
 *
 * @description
 *   회귀 가드: 세션의 자식(requests/claude_events)이 Warm Archive로 이주되면 Hot에는 없지만
 *   archive_index에 생존한다. retention 세션 삭제가 archive_index를 무시하면 세션 메타가 오삭제되어
 *   archive 자식이 고아가 되고 getRequestsBySession(병합)과 불일치한다. sessions 자체는 이주하지
 *   않고(저소용량 → Hot 유지) archive 자식이 모두 GC된 다음에야 세션이 삭제돼야 한다.
 *
 * @see packages/storage/src/queries/session/retention.ts (deleteOldData step4)
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';
import { createSession } from '../queries/session/write';
import { createRequest } from '../queries/request/write';
import { deleteOldData } from '../queries/session/retention';
import { archiveOldData } from '../archive/migrate-to-archive';
import { FileArchiveStore, getArchiveDir } from '../archive';

const DAY = 86400_000; // ms

let tmpDir: string;
let db: Database;
let store: FileArchiveStore;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'spyglass-sr-'));
  db = new Database(join(tmpDir, 'test.db'));
  runMigrations(db);
  store = new FileArchiveStore(getArchiveDir(db));
});
afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function sessionExists(id: string): boolean {
  return (db.query(`SELECT COUNT(*) AS c FROM sessions WHERE id = ?`).get(id) as { c: number }).c > 0;
}
function archiveIndexCount(): number {
  return (db.query(`SELECT COUNT(*) AS c FROM archive_index`).get() as { c: number }).c;
}
function seedReq(id: string, session: string, tsDay: number): void {
  createRequest(db, {
    id, session_id: session, timestamp: tsDay * DAY, type: 'tool_call', tool_name: 'Read',
    event_type: 'tool', tokens_input: 0, tokens_output: 0, tokens_total: 0,
  });
}

describe('archive 자식이 세션 메타를 보호', () => {
  test('오래된 세션이라도 archive에 자식이 살아있으면 삭제 안 됨', () => {
    createSession(db, { id: 's1', project_name: 'p', started_at: 5 * DAY });
    seedReq('r1', 's1', 20);                  // 자식은 아직 retention 안쪽(day20)
    archiveOldData(db, { safeArchiveTs: 25 * DAY, store }); // r1 → archive_index(session s1)
    expect(archiveIndexCount()).toBe(1);

    deleteOldData(db, 10 * DAY); // 세션 started(day5)<cutoff, Hot 자식 0, 그러나 archive 자식 존재

    expect(sessionExists('s1')).toBe(true);   // archive 자식이 보호
    expect(archiveIndexCount()).toBe(1);      // r1(day20)은 GC 대상 아님(>= cutoff)
  });

  test('archive 자식이 모두 GC된 다음 사이클에서 세션 삭제(1주기 지연)', () => {
    createSession(db, { id: 's1', project_name: 'p', started_at: 5 * DAY });
    seedReq('r1', 's1', 6);
    archiveOldData(db, { safeArchiveTs: 10 * DAY, store }); // r1(day6) → archive

    // 1st: step4(세션 삭제 판정)는 archive 자식 존재로 보존, step7이 r1 GC
    deleteOldData(db, 20 * DAY);
    expect(sessionExists('s1')).toBe(true);
    expect(archiveIndexCount()).toBe(0);      // r1 GC됨

    // 2nd: 이제 자식이 아무 데도 없어 세션 삭제
    deleteOldData(db, 20 * DAY);
    expect(sessionExists('s1')).toBe(false);
  });

  test('회귀 기준: 자식 없는 오래된 세션은 그대로 삭제', () => {
    createSession(db, { id: 's2', project_name: 'p', started_at: 5 * DAY });
    deleteOldData(db, 10 * DAY);
    expect(sessionExists('s2')).toBe(false);
  });

  test('회귀 기준: Hot 자식이 있으면 삭제 안 됨(이주 비활성)', () => {
    createSession(db, { id: 's3', project_name: 'p', started_at: 5 * DAY });
    seedReq('r3', 's3', 20); // Hot에 생존
    deleteOldData(db, 10 * DAY);
    expect(sessionExists('s3')).toBe(true);
  });
});
