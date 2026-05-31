// app/i18n-labeler.ts — window.I18n 을 컴포넌트 라벨러 계약으로 감싸는 어댑터 (P4-06)
//
// 컴포넌트는 무전역(FilterBar/Sidebar 선례: window.I18n 직접 참조 금지, labeler/t 주입). App 셸이
//   유일하게 window.I18n(전역 IIFE, architecture.md F5) 을 읽어 컴포넌트 계약 형태로 변환한다.
//   i18n 전역의 ESM 흡수(F5)는 후속 페이즈 — 본 어댑터가 그때까지의 단일 경계다.
//
// 레이어: app leaf(순수 변환). 전역 접근은 안전 폴백(window/I18n 부재 시 key passthrough).

import type { SidebarLabeler } from '../features/browse/Sidebar';

/** window.I18n.t 안전 접근 — 전역/네임스페이스 부재 시 key 를 그대로 반환(SSR/스텁 안전). */
export function tt(key: string, vars?: Record<string, unknown>): string {
  const g = globalThis as unknown as { window?: { I18n?: { t?: (k: string, v?: Record<string, unknown>) => string } } };
  const fn = g.window?.I18n?.t;
  return typeof fn === 'function' ? fn(key, vars) : key;
}

/** Sidebar 라벨러 — window.I18n 키를 SidebarLabeler 계약으로 매핑(left-panel.js 라벨 SSoT). */
export function makeI18nLabeler(): SidebarLabeler {
  return {
    noData: () => tt('ui.left-panel.no-data'),
    liveCount: (count) => tt('ui.left-panel.live-count', { n: count }),
    selectProject: () => tt('ui.left-panel.select-project'),
    sessionCount: (project, count) => tt('ui.left-panel.session-count', { project, n: count }),
    globalRowLabel: () => tt('ui.left-panel.global-row-label'),
    globalRowTitle: () => tt('ui.left-panel.global-row-title'),
  };
}
