/**
 * migrate-to-archive — Hot→Warm Archive 이주 코어 (roadmap Phase 5, ADR A5·A7·A8)
 *
 * @description
 *   safeArchiveTs 미만(&& graph flush 통과 — 호출자가 flush-gate로 산출) 행을 날짜단위 압축파일로
 *   옮기고, Hot에서 삭제하며, 위치를 archive_index에 기록한다. `backfillProxyPayloadToCas`의
 *   원자성 패턴(배치·keyset·검증)을 미러한다.
 *
 *   원자성(ADR A8): 배치별로 (1) 파일 write(트랜잭션 밖 — 실패 시 throw로 Hot 보존) →
 *   (2) 같은 DB 트랜잭션에서 archive_index INSERT + Hot DELETE. 부분 실패 = 파일 중복 라인만(
 *   archive_index PK가 재INSERT 차단, load 진실은 index) → 안전측(손실 0).
 *
 *   1차 대상: claude_events (독립 이벤트, 자식 관계 없음). requests/sessions는 관계·off-row body
 *   정합 검토 후 SPECS에 추가(proxy_requests는 CAS ref_count 때문에 제외 — ADR A7).
 *
 * @dependencies bun:sqlite, ./archive-index, ./archive-store, Bun.deepEquals
 * @flow server/runtime/maintenance → computeSafeArchiveTs → archiveOldData(db, {safeArchiveTs, store})
 */

import type { Database, SQLQueryBindings } from 'bun:sqlite';
import { insertArchiveIndexRows, type ArchiveIndexRow } from './archive-index';
import type { ArchiveStore } from './archive-store';

/** 이주 대상 테이블 명세. row_id/ts/session/type 컬럼 매핑. */
interface ArchiveTableSpec {
  table: string;
  rowIdCol: string;
  tsCol: string;
  sessionCol: string | null;
  typeCol: string | null;
}

// 1차: claude_events만. SPECS에 추가하면 다른 테이블로 확장(requests/sessions는 관계 정합 검토 후).
const SPECS: readonly ArchiveTableSpec[] = [
  { table: 'claude_events', rowIdCol: 'event_id', tsCol: 'timestamp', sessionCol: 'session_id', typeCol: 'event_type' },
];

export interface ArchiveResult {
  archived: number;
  skippedRoundtripMismatch: number;
  byTable: Record<string, number>;
}

export interface ArchiveOptions {
  /** 이주 상한(ms, 미포함). flush-gate.computeSafeArchiveTs 결과(UTC일 경계). */
  safeArchiveTs: number;
  /** 본문 저장소(FileArchiveStore). */
  store: ArchiveStore;
  /** 배치 크기(트랜잭션 단위). 기본 500. */
  batchSize?: number;
}

/** ms → 'YYYY-MM-DD' (UTC). archive 파일 날짜 버킷. */
function utcDateStr(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * 오래된 행을 Archive로 이주한다. safeArchiveTs 미만만 대상(파티션 + flush 정합은 호출자 책임).
 *
 * @returns 이주 결과 카운트
 */
export function archiveOldData(db: Database, opts: ArchiveOptions): ArchiveResult {
  const batchSize = opts.batchSize ?? 500;
  const result: ArchiveResult = { archived: 0, skippedRoundtripMismatch: 0, byTable: {} };
  for (const spec of SPECS) {
    archiveTable(db, spec, opts.safeArchiveTs, opts.store, batchSize, result);
  }
  return result;
}

/** 파일 단위 이주 묶음 — 같은 날짜 파일의 라인/인덱스/삭제 대상 id. */
interface FileGroup {
  lines: string[];
  index: ArchiveIndexRow[];
  ids: SQLQueryBindings[];
}

function archiveTable(
  db: Database,
  spec: ArchiveTableSpec,
  safeArchiveTs: number,
  store: ArchiveStore,
  batchSize: number,
  result: ArchiveResult,
): void {
  // keyset 커서((ts,rowId)) — offset 회피(이주로 대상이 사라져 offset이 어긋남).
  const sql = `
    SELECT * FROM ${spec.table}
    WHERE ${spec.tsCol} < ?
      AND (${spec.tsCol} > ? OR (${spec.tsCol} = ? AND ${spec.rowIdCol} > ?))
    ORDER BY ${spec.tsCol} ASC, ${spec.rowIdCol} ASC
    LIMIT ?
  `;
  const stmt = db.query(sql);
  let lastTs = -1;
  let lastId = '';

  for (;;) {
    const rows = stmt.all(safeArchiveTs, lastTs, lastTs, lastId, batchSize) as Record<string, unknown>[];
    if (rows.length === 0) break;

    const byFile = new Map<string, FileGroup>();
    for (const row of rows) {
      lastTs = row[spec.tsCol] as number;
      lastId = String(row[spec.rowIdCol]);

      const line = JSON.stringify(row);
      // round-trip 안전 축: 직렬화→역직렬화가 원본과 semantic 동일해야(BLOB 등 비직렬화 값 방어).
      if (!Bun.deepEquals(JSON.parse(line), row)) {
        result.skippedRoundtripMismatch++;
        continue;
      }
      const file = `${utcDateStr(row[spec.tsCol] as number)}.${spec.table}.jsonl.zst`;
      let g = byFile.get(file);
      if (!g) { g = { lines: [], index: [], ids: [] }; byFile.set(file, g); }
      g.lines.push(line);
      g.index.push({
        src_table: spec.table,
        row_id: String(row[spec.rowIdCol]),
        session_id: spec.sessionCol ? ((row[spec.sessionCol] as string | null) ?? null) : null,
        timestamp: row[spec.tsCol] as number,
        type: spec.typeCol ? ((row[spec.typeCol] as string | null) ?? null) : null,
        archive_file: file,
      });
      g.ids.push(row[spec.rowIdCol] as SQLQueryBindings);
    }

    if (byFile.size === 0) continue; // 전부 round-trip skip된 배치(커서는 이미 전진)

    // 1) 파일 write (DB 트랜잭션 밖) — 실패 시 throw로 Hot 보존.
    for (const [file, g] of byFile) store.appendDay(file, g.lines);

    // 2) archive_index INSERT + Hot DELETE (원자 트랜잭션).
    db.transaction(() => {
      for (const [, g] of byFile) {
        insertArchiveIndexRows(db, g.index);
        const placeholders = g.ids.map(() => '?').join(',');
        db.run(`DELETE FROM ${spec.table} WHERE ${spec.rowIdCol} IN (${placeholders})`, g.ids);
      }
    })();

    for (const [, g] of byFile) {
      result.archived += g.ids.length;
      result.byTable[spec.table] = (result.byTable[spec.table] ?? 0) + g.ids.length;
    }
  }
}
