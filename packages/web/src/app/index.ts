/**
 * app/index.ts — App 셸/라우팅 barrel (P4-06)
 *
 * main.js(1036) 폐기 대체: React Router v6 App 조립 + appMode↔URL 브리지 + 최상위 SSE 바인딩.
 *   실 entry 마운트(main.tsx)·index.html 진입 전환은 P4-07. 본 트리는 작성/테스트 병존.
 *
 * @module app
 */
export { App, AppRoutes, AppModeSync, AppRoutesWithMemoryRouter } from './App';
export { AppShell } from './AppShell';
export { AppRail, APP_RAIL_MODES, type AppRailProps } from './AppRail';
export { ErrorBanner, type ErrorBannerProps } from './ErrorBanner';
export { Footer, type FooterProps } from './Footer';
export { DashboardWarning, SHALLOW_FIX_COMMAND, type DashboardWarningProps } from './DashboardWarning';
export { BrowseLayout } from './BrowseLayout';
export { MetaDocsLayout } from './MetaDocsLayout';
export { SettingsLayout } from './SettingsLayout';
export {
  ROUTE_PATHS, APP_MODE_PATHS, appModeToPath, pathToAppMode,
} from './app-mode-route';
export { buildAppSSECallbacks, type AppSSELifecycle } from './app-sse';
