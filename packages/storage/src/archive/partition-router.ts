/**
 * partition-router — Hot/Archive 투명 병합 조회 라우터 (roadmap Phase 7)
 *
 * @description
 *   범위 조회(getAllRequests·getConversationRows·getAllSessions 등)가 이 라우터를 경유하면,
 *   호출자는 데이터가 Hot(SQLite)에 있는지 Archive(압축파일)에 있는지 몰라도 된다. UI 무변경이
 *   성공 기준(ADR A8).
 *
 *   ┌─ 하드 timestamp 파티션이라 병합이 단순하다 (ADR A4) ─────────────────────┐
 *   │ Hot=ts>=boundary, Archive=ts<boundary 로 배타·완전. 따라서 DESC 목록은     │
 *   │ [Hot]++[Archive] concat(교차 없음), 대화(session,ts ASC)는 pre-sorted      │
 *   │ linear merge. limit early-exit로 Hot이 채우면 archive 파일 무접촉.         │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 *   단계1(골격): loadArchive 미제공 또는 archive_index 비어 있으면(이주 OFF) hotQuery 결과를
 *   그대로 반환 → Hot-only와 완전 동일(동작 무변경). 실제 병합은 단계2에서 loadArchive와 함께.
 *
 * @dependencies bun:sqlite, ./archive-index
 * @flow queries/request/{read,conversation}.ts · queries/session/read.ts → queryPartitioned
 */

import type { Database } from 'bun:sqlite';
import { archiveHasRowsInRange, getArchiveIndexRows, type ArchiveIndexRow } from './archive-index';

/** 병합 조회 명세. hotQuery는 호출자의 기존 Hot 쿼리 클로저. */
export interface PartitionedQuery<T> {
  /** archive_index.src_table 값 ('requests' | 'sessions' | ...). */
  srcTable: string;
  /** 조회 범위 하한(ms, 포함). */
  fromTs?: number | null;
  /** 조회 상한 = Hot/Archive 경계(ms, 미포함). Archive는 이 미만만 보유. */
  boundaryTs?: number | null;
  /** 결과 상한. */
  limit?: number;
  /** 정렬. 목록=DESC, 대화=ASC. */
  order?: 'ASC' | 'DESC';
  /** Hot 결과 클로저(호출자의 기존 쿼리). */
  hotQuery: () => T[];
  /**
   * archive_index 행 → 실제 행 로드(압축파일 디코드, 단계2). 미제공이면 Hot-only(골격).
   */
  loadArchive?: (indexRows: ArchiveIndexRow[]) => T[];
  /** 병합 정렬용 timestamp 추출자(loadArchive 제공 시 필수). */
  tsOf?: (row: T) => number;
}

/**
 * Hot 우선 조회 후, 범위가 archive 경계 이전으로 걸치면 archive를 병합한다.
 *
 * 골격 경로(단계1): loadArchive 없음 또는 archive_index 비어 있음 → hotQuery() 그대로.
 * 병합 경로(단계2): archive_index로 필요한 행을 찾아 loadArchive로 로드 → 정렬·limit 재적용.
 *
 * @returns 병합·정렬·절단된 결과 (호출자는 기존과 동일한 shape를 받는다)
 */
export function queryPartitioned<T>(db: Database, q: PartitionedQuery<T>): T[] {
  const hot = q.hotQuery();

  // 골격/무접촉 경로: 병합기 미제공, 또는 경계 이전 범위에 archive 행이 없음 → Hot-only.
  if (!q.loadArchive) return hot;
  if (!archiveHasRowsInRange(db, q.srcTable, q.fromTs, q.boundaryTs)) return hot;

  // limit early-exit: Hot이 이미 limit을 채웠고 정렬이 DESC(최신 우선)면 archive는 더 오래된
  // 행뿐이라 기여할 수 없다 → 파일 무접촉.
  if (q.limit != null && q.order !== 'ASC' && hot.length >= q.limit) return hot;

  // 병합 경로(단계2): 필요한 archive 행 로드 → 정렬 → limit.
  const indexRows = getArchiveIndexRows(db, q.srcTable, {
    fromTs: q.fromTs,
    toTs: q.boundaryTs,
    order: q.order ?? 'DESC',
    limit: q.limit,
  });
  const archived = q.loadArchive(indexRows);
  if (archived.length === 0) return hot;

  const tsOf = q.tsOf ?? (() => 0);
  const merged = [...hot, ...archived].sort((a, b) =>
    q.order === 'ASC' ? tsOf(a) - tsOf(b) : tsOf(b) - tsOf(a),
  );
  return q.limit != null ? merged.slice(0, q.limit) : merged;
}
