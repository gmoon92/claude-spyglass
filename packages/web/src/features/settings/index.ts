/**
 * features/settings/index.ts — settings feature 진입점
 *
 * settings 4 sub-tab 의 컨테이너 + 뷰 + 페칭 훅 + 타입/로직 barrel.
 *   - diag        : DiagPanel (+ View)
 *   - integration : IntegrationPanel — Hook(이벤트 수집) + Proxy(API 메트릭 수집) 통합.
 *                   HooksPanelView/ProxyPanelView 를 한 컨테이너에서 재사용.
 *   - storage     : StoragePanel (+ View) — SQLite(대화·이벤트 기록) + Graph(관계 흐름 그래프) 통합.
 *   - server      : ServerPanel (+ View)
 *   - 페칭: useAsyncResource + hooks-api(diag/hook/logs) + graph-api(graph/sqlite/proxy/install SSE)
 *   - 순수 로직: logic.ts(상태/헬스 결정), types.ts(/api/settings/* web-local contract)
 *
 * 공용 leaf(components/settings)와 use-settings-diag 를 전 탭 재사용한다(SSoT, 아키텍처 §1.1).
 *
 * @module features/settings
 */
export { SettingsHeader, type SettingsHeaderProps } from './SettingsHeader';

export { DiagPanel, type DiagPanelProps } from './DiagPanel';
export { ServerPanel, type ServerPanelProps } from './ServerPanel';
export { StoragePanel, type StoragePanelProps } from './StoragePanel';
export { IntegrationPanel, type IntegrationPanelProps } from './IntegrationPanel';

export { DiagPanelView, type DiagPanelViewProps } from './DiagPanelView';
export { HooksPanelView, type HooksPanelViewProps } from './HooksPanelView';
export { ServerPanelView, type ServerPanelViewProps } from './ServerPanelView';
export { StoragePanelView, type StoragePanelViewProps } from './StoragePanelView';
export { ProxyPanelView, type ProxyPanelViewProps } from './ProxyPanelView';

export { useAsyncResource, type AsyncState, type AsyncStatus } from './use-settings-diag';
export { fetchDiag, fetchLogs, hookApply, hookPreview, hookRestore } from './hooks-api';
export {
  fetchGraphDbStatus,
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
