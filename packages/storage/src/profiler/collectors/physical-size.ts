/**
 * Collector — 물리 디스크 크기 (dbstat 기반)
 *
 * @description
 *   테이블/인덱스가 실제 차지하는 페이지 바이트를 dbstat 가상테이블로 실측한다.
 *   논리 합(SUM(length))과 물리 합의 차이는 대부분 freelist(삭제 후 미회수 페이지)에서 온다 —
 *   retention 삭제가 잦은 Spyglass에선 이 값이 "CAS보다 VACUUM이 먼저"를 가를 핵심 지표다.
 *
 * @dependencies bun:sqlite (dbstat), node:fs (파일 크기)
 * @flow profiler/index.ts → collectPhysical(db, dbPath)
 */

import type { Database } from 'bun:sqlite';
import fs from 'node:fs';
import type { PhysicalEntry, PhysicalSummary } from '../types';

/** sqlite_master로 name→종류(table/index)를 매핑. */
function buildKindMap(db: Database): Map<string, 'table' | 'index' | 'other'> {
  const rows = db
    .query("SELECT name, type FROM sqlite_master WHERE type IN ('table','index')")
    .all() as { name: string; type: string }[];
  const m = new Map<string, 'table' | 'index' | 'other'>();
  for (const r of rows) m.set(r.name, r.type === 'table' ? 'table' : 'index');
  return m;
}

function fileSize(path: string): number {
  try {
    return fs.statSync(path).size;
  } catch {
    return 0;
  }
}

export function collectPhysical(db: Database, dbPath: string): PhysicalSummary {
  const kindMap = buildKindMap(db);

  // dbstat: name별 페이지 바이트 합. 인덱스도 별도 name으로 잡힌다.
  const statRows = db
    .query('SELECT name, SUM(pgsize) AS bytes, COUNT(*) AS pages FROM dbstat GROUP BY name')
    .all() as { name: string; bytes: number; pages: number }[];

  const entries: PhysicalEntry[] = statRows
    .map((r) => ({
      name: r.name,
      kind: kindMap.get(r.name) ?? 'other',
      bytes: r.bytes ?? 0,
      pages: r.pages ?? 0,
    }))
    .sort((a, b) => b.bytes - a.bytes);

  const pageSize = (db.query('PRAGMA page_size').get() as { page_size: number }).page_size;
  const pageCount = (db.query('PRAGMA page_count').get() as { page_count: number }).page_count;
  const freelistCount = (db.query('PRAGMA freelist_count').get() as { freelist_count: number })
    .freelist_count;

  return {
    fileBytes: fileSize(dbPath),
    walBytes: fileSize(`${dbPath}-wal`),
    pageSize,
    pageCount,
    freelistCount,
    freelistBytes: freelistCount * pageSize,
    entries,
  };
}
