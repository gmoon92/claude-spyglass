/**
 * load-archive-rows — archive_index 행 → 실제 행 로드 (Query Layer loadArchive 구현 보조)
 *
 * @description
 *   partition-router가 병합할 archive 행을 압축파일에서 꺼낸다. archive_index(위치)로 필요한
 *   파일·row_id를 특정한 뒤 FileArchiveStore.readDay로 JSONL을 로드해 매칭 행만 반환한다.
 *   본문은 archive 파일이 저장하지만 '진실'은 archive_index(row_id) — 파일 중복 라인이 있어도
 *   index에 있는 row_id만 채택(안전측).
 *
 * @dependencies node:path, bun:sqlite(db.filename), ./archive-store, ./archive-index
 * @flow queries/*.loadArchive → loadArchiveRows(store, indexRows, rowIdField)
 */

import { dirname } from 'node:path';
import type { Database } from 'bun:sqlite';
import { FileArchiveStore } from './archive-store';
import type { ArchiveIndexRow } from './archive-index';

/** DB 파일 경로에서 archive 디렉토리(`<db-dir>/archive`)를 도출. `:memory:` 등은 상대 'archive'. */
export function getArchiveDir(db: Database): string {
  const f = (db as unknown as { filename?: string }).filename || '';
  return f.includes('/') ? `${dirname(f)}/archive` : 'archive';
}

/**
 * archive_index 행들이 가리키는 원본 행을 파일에서 로드한다.
 * 파일별로 1회 readDay(zstd 해제) 후 row_id 매칭 — 필요한 파일만 연다(호출자가 index 범위로 이미 선별).
 *
 * @param store       FileArchiveStore(getArchiveDir로 생성)
 * @param indexRows   대상 archive_index 행(범위/정렬은 호출자가 getArchiveIndexRows로 결정)
 * @param rowIdField  archive 라인에서 row_id에 해당하는 필드명(requests='id', claude_events='event_id')
 * @returns 매칭된 원본 행(JSON 파싱). __ 접두 인라인 컬럼 제거·필터는 호출자 책임.
 */
export function loadArchiveRows(
  store: FileArchiveStore,
  indexRows: ArchiveIndexRow[],
  rowIdField: string,
): Record<string, unknown>[] {
  const idsByFile = new Map<string, Set<string>>();
  for (const r of indexRows) {
    let s = idsByFile.get(r.archive_file);
    if (!s) { s = new Set(); idsByFile.set(r.archive_file, s); }
    s.add(r.row_id);
  }

  const out: Record<string, unknown>[] = [];
  for (const [file, ids] of idsByFile) {
    for (const line of store.readDay(file)) {
      const row = JSON.parse(line) as Record<string, unknown>;
      if (ids.has(String(row[rowIdField]))) out.push(row);
    }
  }
  return out;
}
