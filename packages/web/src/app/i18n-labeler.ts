// app/i18n-labeler.ts — Sidebar 라벨러 빌더 (react-i18next t 주입)
//
// 컴포넌트는 무전역(labeler/t 주입). 호출처(App 셸: MetaDocsLayout/BrowseLayout)가 useTranslation 의
//   t 를 주입해 SidebarLabeler 계약으로 변환한다.
// (구 window.I18n 어댑터 tt 는 전 React 컴포넌트의 useTranslation 전환 완료로 제거됨 — #5.
//   vanilla(assets/js) 뷰는 여전히 window.I18n 을 쓰나 본 모듈과 무관하다.)
//
// 레이어: app leaf(순수 변환). 무전역 — 전역 접근 없음.

import type { SidebarLabeler } from '../features/browse/Sidebar';

/** i18n 라벨 함수 계약 — react-i18next t 를 (key, vars)=>string 으로 받는다. */
export type TFunc = (key: string, vars?: Record<string, unknown>) => string;

/**
 * Sidebar 라벨러 — i18n 키를 SidebarLabeler 계약으로 매핑(left-panel.js 라벨 SSoT). t 는 호출처 주입.
 *   보간 var 명은 locale 템플릿과 일치해야 한다: ui.left-panel.live-count="라이브 {count}개",
 *   session-count="{project} · {count}개"(과거 'n' 오용으로 {count} 미치환되던 버그를 'count' 로 정정).
 */
export function makeI18nLabeler(t: TFunc): SidebarLabeler {
  return {
    noData: () => t('ui.left-panel.no-data'),
    liveCount: (count) => t('ui.left-panel.live-count', { count }),
    selectProject: () => t('ui.left-panel.select-project'),
    sessionCount: (project, count) => t('ui.left-panel.session-count', { project, count }),
    globalRowLabel: () => t('ui.left-panel.global-row-label'),
    globalRowTitle: () => t('ui.left-panel.global-row-title'),
  };
}
