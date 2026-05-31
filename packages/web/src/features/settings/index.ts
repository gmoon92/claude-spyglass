/**
 * features/settings/index.ts — settings feature 진입점 (P2-06 + P2-07)
 *
 * settings 6 sub-tab 의 컨테이너 + 뷰 + 페칭 훅 + 타입/로직 barrel.
 *   - P2-06: diag / hooks / server — DiagPanel / HooksPanel / ServerPanel (+ View)
 *   - P2-07: graph / sqlite / proxy — GraphPanel / SqlitePanel / ProxyPanel (+ View)
 *   - 페칭: useAsyncResource + hooks-api(diag/hook/logs) + graph-api(graph/sqlite/proxy/install SSE)
 *   - 순수 로직: logic.ts(상태/헬스 결정), types.ts(/api/settings/* web-local contract)
 *
 * 공용 leaf(components/settings)와 use-settings-diag 를 6 탭 전부 재사용한다(SSoT, 아키텍처 §1.1).
 *
 * @module features/settings
 */
export { SettingsHeader, type SettingsHeaderProps } from './SettingsHeader';

export { DiagPanel, type DiagPanelProps } from './DiagPanel';
export { HooksPanel, type HooksPanelProps } from './HooksPanel';
export { ServerPanel, type ServerPanelProps } from './ServerPanel';
export { GraphPanel, type GraphPanelProps } from './GraphPanel';
export { SqlitePanel, type SqlitePanelProps } from './SqlitePanel';
export { ProxyPanel, type ProxyPanelProps } from './ProxyPanel';

export { DiagPanelView, type DiagPanelViewProps } from './DiagPanelView';
export { HooksPanelView, type HooksPanelViewProps } from './HooksPanelView';
export { ServerPanelView, type ServerPanelViewProps } from './ServerPanelView';
export { GraphPanelView, type GraphPanelViewProps } from './GraphPanelView';
export { SqlitePanelView, type SqlitePanelViewProps } from './SqlitePanelView';
export { ProxyPanelView, type ProxyPanelViewProps } from './ProxyPanelView';

export { useAsyncResource, type AsyncState, type AsyncStatus } from './use-settings-diag';
export { fetchDiag, fetchLogs, hookApply, hookPreview, hookRestore } from './hooks-api';
export {
  fetchGraphDbStatus,
  setGraphMode,
  ladybugInstallStream,
  consumeInstallStream,
  parseSseBuffer,
  fetchSqliteInfo,
  fetchProxySnippet,
  fetchProxyStatus,
  proxyInstall,
  proxyRestore,
} from './graph-api';

export * from './types';
export * from './logic';
