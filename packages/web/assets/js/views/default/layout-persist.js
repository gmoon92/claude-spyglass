// views/default/layout-persist.js — 레이아웃 영속 상태 (E축)
//
// 변경 이유: 차트 섹션 접힘·좌측 패널 접힘 상태를 localStorage 에 저장/복원.
// migrateLocalStorage 는 키 네임스페이스 prefix 도입(`spyglass:`) 마이그레이션.
// main.js 호출 순서 — `migrateLocalStorage` 먼저, 그 후 `restorePanelHiddenState` /
// `restoreChartCollapsedState` — 가 의미 있다 (마이그레이션 후 읽기).

import { CHART_COLLAPSED_KEY, PANEL_HIDDEN_KEY } from './constants.js';

// ── 차트 섹션 접힘 ────────────────────────────────────────────────────────────
export function toggleChartCollapse() {
  const chartSection = document.getElementById('chartSection');
  const btn = document.getElementById('btnToggleChart');
  chartSection.classList.toggle('chart-collapsed');
  const collapsed = chartSection.classList.contains('chart-collapsed');
  localStorage.setItem(CHART_COLLAPSED_KEY, JSON.stringify(collapsed));
  if (btn) btn.setAttribute('aria-label', collapsed ? '펼치기' : '접기');
}

export function restoreChartCollapsedState() {
  const collapsed = JSON.parse(localStorage.getItem(CHART_COLLAPSED_KEY) || 'false');
  if (collapsed) {
    const chartSection = document.getElementById('chartSection');
    const btn = document.getElementById('btnToggleChart');
    chartSection.classList.add('chart-collapsed');
    if (btn) btn.setAttribute('aria-label', '펼치기');
  }
}

// ── 좌측 패널 접힘 ────────────────────────────────────────────────────────────
function migrateKey(oldKey, newKey) {
  const v = localStorage.getItem(oldKey);
  if (v != null && localStorage.getItem(newKey) == null) {
    localStorage.setItem(newKey, v);
    localStorage.removeItem(oldKey);
  }
}

export function migrateLocalStorage() {
  migrateKey('left-panel-hidden', PANEL_HIDDEN_KEY);
  migrateKey('left-panel-state', 'spyglass:left-panel-state');
}

function savePanelHiddenState(isHidden) {
  localStorage.setItem(PANEL_HIDDEN_KEY, JSON.stringify(isHidden));
}

export function restorePanelHiddenState() {
  const isHidden = JSON.parse(localStorage.getItem(PANEL_HIDDEN_KEY) || 'false');
  if (isHidden) {
    document.querySelector('.main-layout')?.classList.add('left-panel-hidden');
  }
}

export function toggleLeftPanel() {
  const mainLayout = document.querySelector('.main-layout');
  mainLayout.classList.toggle('left-panel-hidden');
  const isHidden = mainLayout.classList.contains('left-panel-hidden');
  savePanelHiddenState(isHidden);
}
