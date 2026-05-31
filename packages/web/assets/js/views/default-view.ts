// views/default-view.js — 호환 shim (srp-redesign Phase 11)
// 427줄 default-view.js를 _shared/view-toggle.js + default/{...}.js 8파일로 분해.
// main.js·detail-view.js의 import 경로 보존.

export { initDefaultView } from './default/bootstrap.js';
export { setChartMode, applyRangeLabels } from './default/chart-policy.js';
export { prependRequest, reapplyFeedAnomalies } from './default/feed-live.js';
export {
  toggleChartCollapse, restoreChartCollapsedState,
  migrateLocalStorage, restorePanelHiddenState, toggleLeftPanel,
} from './default/layout-persist.js';
export { renderRightPanel } from './_shared/view-toggle.js';
