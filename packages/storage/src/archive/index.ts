/**
 * archive — Warm Archive/ELK 계층 공용 진입점 (roadmap Phase 5-7)
 *
 * @description archive_index CRUD(archive-index) + Hot/Archive 병합 라우터(partition-router)를
 *   한 곳에서 재노출한다. storage 배럴(src/index.ts)이 이 모듈을 통해 Archive API를 공개한다.
 */

export {
  insertArchiveIndexRows,
  archiveHasRowsInRange,
  getArchiveIndexRows,
  deleteArchiveIndexByFile,
  type ArchiveIndexRow,
  type ArchiveIndexQuery,
} from './archive-index';

export {
  queryPartitioned,
  type PartitionedQuery,
} from './partition-router';

export {
  FileArchiveStore,
  type ArchiveStore,
} from './archive-store';

export {
  getOldestUnflushedTs,
  floorToUtcDay,
  computeSafeArchiveTs,
} from './flush-gate';
