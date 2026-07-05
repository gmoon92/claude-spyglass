/**
 * Archive 골격 — getArchiveDays 게이트 + archive_index CRUD + partition-router Hot-only (단계1)
 *
 * @description
 *   단계1 골격의 핵심 계약을 고정한다: (1) 이주는 SPYGLASS_ARCHIVE_DAYS 설정 시에만 활성(기본 비활성),
 *   (2) archive_index CRUD 정상, (3) partition-router가 archive 비었을 때 Hot 결과를 그대로 반환
 *   (동작 무변경). 실제 병합은 단계2.
 *
 * @see packages/storage/src/runtime/retention.ts (getArchiveDays)
 * @see packages/storage/src/archive/{archive-index,partition-router}.ts
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';
import { getArchiveDays, getArchiveCutoffTs } from '../runtime/retention';
import {
  insertArchiveIndexRows,
  archiveHasRowsInRange,
  getArchiveIndexRows,
  deleteArchiveIndexByFile,
} from '../archive/archive-index';
import { queryPartitioned } from '../archive/partition-router';

let db: Database;
beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
});
afterEach(() => {
  db.close();
  delete process.env.SPYGLASS_ARCHIVE_DAYS;
  delete process.env.SPYGLASS_RETENTION_DAYS;
});

describe('getArchiveDays — 이주 활성 게이트 (기본 OFF)', () => {
  test('미설정 → null (이주 비활성)', () => {
    expect(getArchiveDays()).toBeNull();
    expect(getArchiveCutoffTs()).toBeNull();
  });
  test('유효값(retention 미만) → 값 + cutoff 계산', () => {
    process.env.SPYGLASS_ARCHIVE_DAYS = '7'; // retention 기본 30
    expect(getArchiveDays()).toBe(7);
    expect(getArchiveCutoffTs(1_000_000_000_000)).toBe(1_000_000_000_000 - 7 * 86400_000);
  });
  test('retention 이상 → null (Warm 구간 성립 안 함)', () => {
    process.env.SPYGLASS_ARCHIVE_DAYS = '30'; // == retention → 무효
    expect(getArchiveDays()).toBeNull();
    process.env.SPYGLASS_ARCHIVE_DAYS = '40';
    expect(getArchiveDays()).toBeNull();
  });
  test('0/음수/non-numeric → null', () => {
    for (const v of ['0', '-5', 'abc', '']) {
      process.env.SPYGLASS_ARCHIVE_DAYS = v;
      expect(getArchiveDays()).toBeNull();
    }
  });
});

describe('archive_index CRUD', () => {
  const rows = [
    { src_table: 'requests', row_id: 'r1', session_id: 's1', timestamp: 1000, type: 'tool_call', archive_file: '2026-06-01.requests.jsonl.zst' },
    { src_table: 'requests', row_id: 'r2', session_id: 's1', timestamp: 2000, type: 'prompt', archive_file: '2026-06-01.requests.jsonl.zst' },
  ];

  test('insert → hasRows/getRows 조회', () => {
    insertArchiveIndexRows(db, rows);
    expect(archiveHasRowsInRange(db, 'requests', 0, 5000)).toBe(true);
    expect(archiveHasRowsInRange(db, 'requests', 3000, 5000)).toBe(false); // 범위 밖
    expect(archiveHasRowsInRange(db, 'sessions')).toBe(false);             // 다른 테이블
    const got = getArchiveIndexRows(db, 'requests', { order: 'ASC' });
    expect(got.map((r) => r.row_id)).toEqual(['r1', 'r2']);
    expect(getArchiveIndexRows(db, 'requests', { type: 'prompt' }).map((r) => r.row_id)).toEqual(['r2']);
  });

  test('insert 멱등 (PK 충돌 IGNORE)', () => {
    insertArchiveIndexRows(db, rows);
    insertArchiveIndexRows(db, rows); // 2회차
    expect(getArchiveIndexRows(db, 'requests').length).toBe(2);
  });

  test('deleteArchiveIndexByFile — 파일 단위 GC', () => {
    insertArchiveIndexRows(db, rows);
    expect(deleteArchiveIndexByFile(db, '2026-06-01.requests.jsonl.zst')).toBe(2);
    expect(archiveHasRowsInRange(db, 'requests')).toBe(false);
  });
});

describe('queryPartitioned — 골격(Hot-only, 동작 무변경)', () => {
  const hotRows = [{ id: 'a', ts: 300 }, { id: 'b', ts: 200 }, { id: 'c', ts: 100 }];

  test('loadArchive 미제공 → hotQuery 결과 그대로', () => {
    const out = queryPartitioned<{ id: string; ts: number }>(db, {
      srcTable: 'requests',
      hotQuery: () => hotRows,
    });
    expect(out).toEqual(hotRows);
  });

  test('archive_index 비어 있으면 loadArchive 있어도 Hot-only', () => {
    let loadCalled = false;
    const out = queryPartitioned<{ id: string; ts: number }>(db, {
      srcTable: 'requests',
      fromTs: 0,
      boundaryTs: 500,
      hotQuery: () => hotRows,
      loadArchive: () => { loadCalled = true; return []; },
      tsOf: (r) => r.ts,
    });
    expect(out).toEqual(hotRows);
    expect(loadCalled).toBe(false); // archiveHasRowsInRange false → 파일 무접촉
  });

  test('limit early-exit — Hot이 limit 채우면 archive 무접촉', () => {
    insertArchiveIndexRows(db, [{ src_table: 'requests', row_id: 'old', session_id: null, timestamp: 50, type: null, archive_file: 'f.zst' }]);
    let loadCalled = false;
    const out = queryPartitioned<{ id: string; ts: number }>(db, {
      srcTable: 'requests',
      fromTs: 0,
      boundaryTs: 500,
      limit: 3,
      order: 'DESC',
      hotQuery: () => hotRows, // 이미 3개(=limit)
      loadArchive: () => { loadCalled = true; return []; },
      tsOf: (r) => r.ts,
    });
    expect(out.length).toBe(3);
    expect(loadCalled).toBe(false); // DESC + Hot이 limit 채움 → archive 스킵
  });
});
