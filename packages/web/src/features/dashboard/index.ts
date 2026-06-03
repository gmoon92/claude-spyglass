/**
 * features/dashboard/index.ts — 대시보드/통계 뷰 barrel (P3-09)
 *
 * 원본 .js → TSX 이식 매핑(M1 무소속 사각지대 해소, review-completeness M1):
 *  - obs-panel.js          → ObsPanel 카드 5종(BurnRate/CacheHealth/LivePulse/ToolCategories/Anomaly)
 *                            + obs-card-data.ts(순수 뷰모델). 카드 골든마스터 = P3-09 핵심 산출.
 *  - cache-panel.js        → CachePanel + cache-stats.ts(computeSessionCacheStats 동치)
 *  - sparkline.js          → Sparkline(Bars/Line) + sparkline-data.ts(기하 동치)
 *  - context-chart.js      → ContextChart(canvas) + context-chart-data.ts(Chart.tsx 미재용 — 설계노트)
 *  - context-window.js     → context-window.ts(formatContextWindowLabel 동치)
 *  - tool-stats.js         → ToolStatsMatrix + tool-stats-sort.ts + tool-stats-view.ts
 *  - system-prompt-library.js → SystemPromptLibrary + syslib-sort.ts
 *  - metrics-api.js        → metrics-fetchers.ts(fetchModelUsage/fetchToolCategories)
 *  - version-check.js      → version-check-logic.ts(순수 helpers — DOM 모달은 후속)
 *  - infra.js              → infra-state.ts(scroll-lock 카운터 순수부)
 *  - request-types.js      → request-types.ts(subTypeOf/isAnchorTool 동치)
 *  - tool-colors.js        → tool-colors.ts(getToolColor 동치)
 *  - {obs,cache,cache-panel,stat}-tooltip.js → tooltip.ts(콘텐츠 키 + 위치 산술)
 *
 * 병존: 원본 assets/js/*.js 는 유지(vanilla 소비처). 본 트리는 React 계층 전용.
 *
 * @module features/dashboard
 */

// ── Observability 카드 ──
export {
  BurnRateCard,
  CacheHealthCard,
  LivePulseCard,
  ToolCategoriesCard,
  AnomalyBadge,
} from './ObsPanel';
export type { TFunc } from './ObsPanel';
export * from './obs-card-data';

// ── Cache 패널 ──
export { CachePanel } from './CachePanel';
export {
  computeSessionCacheStats,
  computeHitRateView,
  computeRatioView,
} from './cache-stats';
export type { CacheStats, CacheRequestLike } from './cache-stats';

// ── Sparkline ──
export { SparklineBars, SparklineLine } from './Sparkline';
export { computeSparkBars, computeSparkLine } from './sparkline-data';

// ── Context chart ──
export { ContextChart, drawContextChartToCanvas } from './ContextChart';
export * from './context-chart-data';
export { formatContextWindowLabel, DEFAULT_CONTEXT_WINDOW } from './context-window';

// ── Tool stats matrix ──
export { ToolStatsMatrix } from './ToolStatsMatrix';
export {
  applySort as applyToolStatsSort,
  nextSort as nextToolStatsSort,
  fmtDur,
} from './tool-stats-sort';
export { computeMatrixView } from './tool-stats-view';

// ── System Prompt Library ──
export { SystemPromptLibrary } from './SystemPromptLibrary';
export { SystemPromptDetailModal } from './SystemPromptDetailModal';
export type { SystemPromptDetail, SystemPromptDetailModalProps } from './SystemPromptDetailModal';
export {
  applySort as applySysLibSort,
  nextSort as nextSysLibSort,
  sizeClassFor,
  formatBytes,
  formatTime,
} from './syslib-sort';

// ── Metrics fetchers ──
export { fetchModelUsage, fetchToolCategories, buildMetricQuery } from './metrics-fetchers';

// ── version-check / infra / request-types / tool-colors ──
export { normalizeTag, isSameVersion, resolveBadgeState, tSafe } from './version-check-logic';
export type { BadgeState } from './version-check-logic';
// version-check 모달/배지/폴링 (P4-09 chrome 이식)
export { UpdateBadge, type UpdateBadgeProps } from './UpdateBadge';
export { SidebarVersionFooter, type SidebarVersionFooterProps } from './SidebarVersionFooter';
export { UpdateModal, type UpdateModalProps } from './UpdateModal';
export {
  createVersionCheckController,
  type VersionPayload,
  type VersionViewState,
  type VersionCheckController,
} from './version-check-controller';
export { useVersionCheck, type UseVersionCheckResult, type UseVersionCheckOptions } from './use-version-check';
export {
  incrementScrollLock,
  resetScrollLock,
  isScrollLockBannerVisible,
  initialScrollLock,
} from './infra-state';
export { subTypeOf, isAnchorTool, SUB_TYPES } from './request-types';
export { getToolColor, readToolColorsFromCss, TOOL_COLORS } from './tool-colors';

// ── tooltips ──
export {
  positionNearCursor,
  positionAbovePoint,
  tooltipContentKeys,
  OBS_TOOLTIP_KEYS,
  CACHE_PANEL_TOOLTIP_KEYS,
  STAT_TOOLTIP_KEYS,
} from './tooltip';
