/**
 * archive-index — archive_index 테이블 CRUD 단일 진실 소스 (roadmap Phase 6)
 *
 * @description
 *   Warm Archive로 이주된 행의 '위치 인덱스'. 본문은 날짜단위 압축파일에 있고, 여기엔 메타
 *   (src_table, row_id, session_id, timestamp, type, archive_file)만 둔다. Query Layer가
 *   timestamp/session 범위로 이 인덱스를 조회해 '필요한 archive 파일만' 로드한다(Loki 방식).
 *
 *   ADR storage-evolution-adr-archive.md A5. 이 모듈은 조회/삽입/삭제 SQL을 한 곳에 모아
 *   분기 분산을 막는다(payload-codec·retention과 같은 SSoT 철학).
 *
 * @dependencies bun:sqlite
 * @flow
 *   write(이주, 단계2): migrate-to-archive → insertArchiveIndexRows
 *   read (병합): partition-router → archiveHasRowsInRange / getArchiveIndexRows
 *   gc  (retention 경계): retention → deleteArchiveIndexByFile
 */

import type { Database } from 'bun:sqlite';

/** archive_index 한 행 (067 스키마 1:1). */
export interface ArchiveIndexRow {
  src_table: string;
  row_id: string;
  session_id: string | null;
  timestamp: number;
  type: string | null;
  archive_file: string;
}

const SQL_INSERT = `
  INSERT OR IGNORE INTO archive_index (src_table, row_id, session_id, timestamp, type, archive_file)
  VALUES (?, ?, ?, ?, ?, ?)
`;

/**
 * archive_index 행 삽입 (멱등 — PK(src_table,row_id) 충돌 시 IGNORE).
 * 이주 트랜잭션 안에서 Hot DELETE와 함께 호출된다(원자성, ADR A8).
 */
export function insertArchiveIndexRows(db: Database, rows: ArchiveIndexRow[]): void {
  for (const r of rows) {
    db.run(SQL_INSERT, [r.src_table, r.row_id, r.session_id, r.timestamp, r.type, r.archive_file]);
  }
}

/**
 * [fromTs, toTs) 범위(경계 미포함 상한)에 해당 테이블의 archive 행이 존재하는지.
 * Query Layer가 "Hot만으로 충분한가(병합 불필요)"를 O(log n) 인덱스로 판단하는 게이트.
 * archive_index가 비어 있으면(골격 기본) 항상 false → 호출자는 Hot-only.
 *
 * @param fromTs 하한(ms, 포함). null이면 무한 과거.
 * @param toTs   상한(ms, 미포함). null이면 무한 미래. 보통 Query Layer가 boundaryMs를 전달.
 */
export function archiveHasRowsInRange(
  db: Database,
  srcTable: string,
  fromTs?: number | null,
  toTs?: number | null,
): boolean {
  let sql = `SELECT 1 FROM archive_index WHERE src_table = ?`;
  const params: unknown[] = [srcTable];
  if (fromTs != null) { sql += ` AND timestamp >= ?`; params.push(fromTs); }
  if (toTs != null) { sql += ` AND timestamp < ?`; params.push(toTs); }
  sql += ` LIMIT 1`;
  return db.query(sql).get(...(params as [])) != null;
}

/** getArchiveIndexRows 필터. 정렬은 order로(목록 DESC / 대화 ASC). */
export interface ArchiveIndexQuery {
  fromTs?: number | null;
  toTs?: number | null;
  sessionId?: string | null;
  type?: string | null;
  order?: 'ASC' | 'DESC';
  limit?: number;
}

/**
 * 범위 조건에 맞는 archive_index 행을 정렬해 반환(병합 대상 파일·행 특정, 단계2).
 * 골격에선 테이블이 비어 항상 [].
 */
export function getArchiveIndexRows(
  db: Database,
  srcTable: string,
  q: ArchiveIndexQuery = {},
): ArchiveIndexRow[] {
  let sql = `SELECT src_table, row_id, session_id, timestamp, type, archive_file FROM archive_index WHERE src_table = ?`;
  const params: unknown[] = [srcTable];
  if (q.fromTs != null) { sql += ` AND timestamp >= ?`; params.push(q.fromTs); }
  if (q.toTs != null) { sql += ` AND timestamp < ?`; params.push(q.toTs); }
  if (q.sessionId != null) { sql += ` AND session_id = ?`; params.push(q.sessionId); }
  if (q.type != null) { sql += ` AND type = ?`; params.push(q.type); }
  sql += ` ORDER BY timestamp ${q.order === 'ASC' ? 'ASC' : 'DESC'}`;
  if (q.limit != null) { sql += ` LIMIT ?`; params.push(q.limit); }
  return db.query(sql).all(...(params as [])) as ArchiveIndexRow[];
}

/**
 * archive_file 단위로 인덱스 행 삭제 후 행 수 반환(retention 경계 도달 시 파일 GC와 함께, 단계2).
 */
export function deleteArchiveIndexByFile(db: Database, archiveFile: string): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { changes } = (db as any).run(`DELETE FROM archive_index WHERE archive_file = ?`, archiveFile);
  return changes as number;
}
