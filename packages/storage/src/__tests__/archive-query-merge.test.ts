/**
 * Archive 조회 병합 — getAllRequests가 Hot+Archive를 투명 병합 (단계2, ADR A8)
 *
 * @description
 *   최우선 회귀 가드: 이주 전/후 getAllRequests 결과가 정렬·limit·pre_tool 필터까지 동일해야 한다.
 *   이주(archiveOldData)와 조회(getAllRequests 내부 getArchiveDir)가 같은 archive 경로를 쓰도록
 *   파일 기반 DB를 쓴다.
 *
 * @see packages/storage/src/queries/request/read.ts (getAllRequests)
 * @see packages/storage/src/archive/partition-router.ts
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';
import { createRequest } from '../queries/request/write';
import { getAllRequests } from '../queries/request/read';
import { archiveOldData } from '../archive/migrate-to-archive';
import { FileArchiveStore, getArchiveDir } from '../archive';

const DAY = 86400_000;
let tmpDir: string;
let db: Database;
let store: FileArchiveStore;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'spyglass-qm-'));
  db = new Database(join(tmpDir, 'test.db'));
  runMigrations(db);
  store = new FileArchiveStore(getArchiveDir(db)); // 이주/조회 동일 경로
});
afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function seed(id: string, ts: number, opts: { eventType?: string; toolName?: string } = {}): void {
  createRequest(db, {
    id, session_id: 's1', timestamp: ts, type: 'tool_call',
    tool_name: opts.toolName ?? 'Read', event_type: opts.eventType ?? 'tool',
    tokens_input: 0, tokens_output: 0, tokens_total: 0,
  });
}

describe('getAllRequests — 이주 전/후 동일 (회귀 가드)', () => {
  test('전체 조회: 병합 결과가 이주 전과 정렬·필터까지 동일', () => {
    seed('r1', DAY * 10);
    seed('r2', DAY * 11);
    seed('pre', DAY * 12, { eventType: 'pre_tool' }); // 필터 제외 대상
    seed('r3', DAY * 50);
    seed('r4', DAY * 51);

    const before = getAllRequests(db, 100);
    expect(before.map((r) => r.id)).toEqual(['r4', 'r3', 'r2', 'r1']); // DESC, pre 제외

    // DAY*20 미만(r1,r2,pre) 이주
    const res = archiveOldData(db, { safeArchiveTs: DAY * 20, store });
    expect(res.byTable.requests).toBe(3);

    const after = getAllRequests(db, 100);
    expect(after.map((r) => r.id)).toEqual(['r4', 'r3', 'r2', 'r1']); // 동일 — archive 병합
    expect(after).toEqual(before);
  });

  test('범위 조회(archive 영역)도 병합 정확', () => {
    seed('a', DAY * 10);
    seed('b', DAY * 12);
    seed('c', DAY * 50);
    archiveOldData(db, { safeArchiveTs: DAY * 20, store });
    // fromTs~toTs가 archive 영역(a,b)만
    const rows = getAllRequests(db, 100, DAY * 9, DAY * 13);
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
  });

  test('limit early-exit: Hot이 limit 채우면 archive 미접촉하되 결과 정확', () => {
    seed('old1', DAY * 10);
    seed('h1', DAY * 50);
    seed('h2', DAY * 51);
    seed('h3', DAY * 52);
    archiveOldData(db, { safeArchiveTs: DAY * 20, store }); // old1 이주
    const top = getAllRequests(db, 3); // 최신 3 = h3,h2,h1 (archive 무접촉)
    expect(top.map((r) => r.id)).toEqual(['h3', 'h2', 'h1']);
  });

  test('archive 빈 상태(이주 안 함) → Hot-only 무변경', () => {
    seed('x', DAY * 10);
    seed('y', DAY * 11);
    const rows = getAllRequests(db, 100);
    expect(rows.map((r) => r.id)).toEqual(['y', 'x']);
  });
});
