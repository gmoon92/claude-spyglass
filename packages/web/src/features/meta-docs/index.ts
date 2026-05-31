/**
 * features/meta-docs/index.ts — meta-docs 카탈로그/검색/필터 배럴 (P4-02)
 *
 * P4-02 소유: catalog 테이블 + 검색 + 필터바 + 정렬/표시/검색 순수 로직.
 * P4-03(후속)이 셸(MetaDocsPage)·flow·tool-stats 를 얹는다. activeRow 는 단방향 props 계약.
 *
 * @module features/meta-docs
 */
export { MetaDocsCatalog, type MetaDocsCatalogProps } from './MetaDocsCatalog';
export { MetaDocsSearch, type MetaDocsSearchProps } from './MetaDocsSearch';
export { MetaDocsFilterBar, type MetaDocsFilterBarProps, type TypeFilter, type MetaFilterGroup } from './MetaDocsFilterBar';
export { MetaDocTypeBadge } from './MetaDocTypeBadge';
export {
  applySort,
  nextSort,
  applyDisplayFilter,
  computeRowCounts,
  visibleBySearch,
  shortenPath,
  formatTokens,
  SORTABLE_KEYS,
  DEFAULT_DIR,
  DEFAULT_SORT,
  type MetaDocRow,
  type MetaDocSortKey,
  type SortDir,
  type DisplayFilter,
} from './meta-docs-sort';
