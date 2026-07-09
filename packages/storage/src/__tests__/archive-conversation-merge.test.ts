/**
 * getConversationRows — Hot/Archive 병합 (단계2, 최난 조회)
 *
 * @description
 *   대화 재구성은 payload 본문 + sessions JOIN + (session_id, timestamp) 복합 정렬 + limit truncation이
 *   얽혀 회귀 위험이 가장 크다. 이주 전/후 결과가 동일함을 고정한다.
 *
 * @see packages/storage/src/queries/request/conversation.ts
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';
import { createSession } from '../queries/session/write';
import { createRequest } from '../queries/request/write';
import { getConversationRows } from '../queries/request/conversation';
import { archiveOldData } from '../archive/migrate-to-archive';
import { FileArchiveStore, getArchiveDir } from '../archive';

const DAY = 86400_000;
let tmpDir: string;
let db: Database;
let store: FileArchiveStore;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'spyglass-conv-'));
  db = new Database(join(tmpDir, 'test.db'));
  runMigrations(db);
  store = new FileArchiveStore(getArchiveDir(db));
});
afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function seedSession(id: string, project: string): void {
  createSession(db, { id, project_name: project, started_at: DAY * 5 });
}
function seedPrompt(id: string, session: string, ts: number, body: string): void {
  createRequest(db, {
    id, session_id: session, timestamp: ts, type: 'prompt', event_type: '',
    payload: body, tokens_input: 0, tokens_output: 0, tokens_total: 0,
  });
}

describe('getConversationRows — 이주 전/후 동일', () => {
  test('payload 본문 + 세션 JOIN + 복합 정렬 병합', () => {
    seedSession('sA', 'proj1');
    seedSession('sB', 'proj1');
    seedPrompt('p1', 'sA', DAY * 10, '{"q":"오래된 A"}');
    seedPrompt('p2', 'sB', DAY * 11, '{"q":"오래된 B"}');
    seedPrompt('p3', 'sA', DAY * 50, '{"q":"최신 A"}');

    const before = getConversationRows(db, DAY * 1, DAY * 100, undefined, 100);
    // 정렬: session_id ASC(sA<sB), timestamp ASC → sA/p1, sA/p3, sB/p2
    expect(before.map((r) => r.timestamp)).toEqual([DAY * 10, DAY * 50, DAY * 11]);
    expect(before[0].payload).toBe('{"q":"오래된 A"}'); // payload 평문 복원
    expect(before[0].project_name).toBe('proj1');       // sessions JOIN

    archiveOldData(db, { safeArchiveTs: DAY * 20, store }); // p1, p2 이주
    const after = getConversationRows(db, DAY * 1, DAY * 100, undefined, 100);
    expect(after).toEqual(before); // 병합 결과 완전 동일 (payload/JOIN/정렬)
  });

  test('project 필터가 archive 행에도 적용', () => {
    seedSession('sA', 'proj1');
    seedSession('sB', 'proj2');
    seedPrompt('p1', 'sA', DAY * 10, '{"q":"1"}');
    seedPrompt('p2', 'sB', DAY * 10, '{"q":"2"}');
    archiveOldData(db, { safeArchiveTs: DAY * 20, store });
    const rows = getConversationRows(db, DAY * 1, DAY * 100, 'proj1', 100);
    expect(rows.map((r) => r.session_id)).toEqual(['sA']); // proj2 제외
  });

  test('archive 빈 상태 → Hot-only 무변경', () => {
    seedSession('sA', 'proj1');
    seedPrompt('p1', 'sA', DAY * 10, '{"q":"x"}');
    const rows = getConversationRows(db, DAY * 1, DAY * 100, undefined, 100);
    expect(rows.length).toBe(1);
    expect(rows[0].payload).toBe('{"q":"x"}');
  });
});
