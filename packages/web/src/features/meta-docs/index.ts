/**
 * features/meta-docs/index.ts — meta-docs 카탈로그/검색/필터 배럴 (P4-02)
 *
 * P4-02 소유: catalog 테이블 + 검색 + 필터바 + 정렬/표시/검색 순수 로직.
 * P4-03 소유: flow(ego-graph) + tool-stats 패널 + flow 순수 lib(camera/graph/edge/layout).
 *   activeRow 는 catalog→flow 단방향 props 계약. 셸(MetaDocsPage)·main.js 라우터화는 P4-06.
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

// ── P4-03: flow(ego-graph) + tool-stats ─────────────────────────────────────
export { MetaDocsFlow, activeRowToFlowArgs, type MetaDocsFlowProps, type FlowActiveRow, type FlowArgs } from './MetaDocsFlow';
export { MetaDocsToolStats, type MetaDocsToolStatsProps } from './MetaDocsToolStats';
export {
  MetaDocsSummaryCards,
  MetaDocsBehaviorBars,
  type MetaDocsSummaryCardsProps,
  type MetaDocsBehaviorBarsProps,
} from './MetaDocsSummaryCards';
export { fetchProjectToolStats, type FetchProjectToolStatsParams } from './tool-stats-fetcher';
// 프로젝트(source_root) 카탈로그 필터 — 좌측 프로젝트 선택 시 해당 경로 문서로 좁힘(순수 SSoT).
export { filterMetaDocsByProject, isGlobalMetaDoc, metaDocProjectKey } from './project-filter';
// flow 순수 lib (arch §4.2 추출 — 컴포넌트 effect 가 호출).
export { computeFitView, animateToView, applyImmediate, easeInOutCubic, viewBoxStr, type ViewState } from './flow-camera';
export { collectFullPathNodes, collectHoverPathNodes, collectEdgesBetween, buildAdjacency, bfsCollect, type FlowEdge } from './flow-graph';
export { computeEdgeD, chooseAnchors, anchorPoint, offsetOutward, EDGE_END_OFFSET, type FlowBox, type Side } from './flow-edge';
export { computePositions, contentBBox, LAYOUT, type PositionedNode, type FlowColumn, type RawFlowNode } from './flow-layout';
