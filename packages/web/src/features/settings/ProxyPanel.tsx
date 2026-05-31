/**
 * features/settings/ProxyPanel.tsx — Proxy sub-tab 컨테이너 (P2-07)
 *
 * 원본: settings-view.js renderProxySection(:1168-1340) + onProxyInstall(:1348) + onProxyRestore(:1416).
 *   proxy/snippet + proxy/status 병렬 페칭(셸 선택에 의존) → ProxyPanelView 위임. 셸 선택은
 *   로컬상태(_proxyShell :1160 → useState) — 변경 시 재페치(원본 :1331 재렌더). install/restore
 *   핸들러 + result slot 로컬상태(§5.2). 부분 갱신은 result 보존 + refetch(원본 :1392 setTimeout 재렌더).
 *
 * @module features/settings/ProxyPanel
 */
import { useCallback, useState } from 'react';
import { ProxyPanelView } from './ProxyPanelView';
import { fetchProxySnippet, fetchProxyStatus, proxyInstall, proxyRestore } from './graph-api';
import { canUndo } from './logic';
import { useAsyncResource } from './use-settings-diag';
import type { ProxyInstallResult, ProxyRestoreResult, ProxyShell, ProxySnippet, ProxyStatus } from './types';

export interface ProxyPanelProps {
  t: (key: string, vars?: Record<string, unknown>) => string;
  onCopy?: (text: string) => void;
}

/** install/restore result slot 상태(원본 #proxyResult, §5.2). */
type ResultState =
  | { kind: 'idle' }
  | { kind: 'loading'; label: string }
  | { kind: 'installed'; result: ProxyInstallResult }
  | { kind: 'restored'; result: ProxyRestoreResult }
  | { kind: 'error'; message: string };

export function ProxyPanel({ t, onCopy }: ProxyPanelProps) {
  const [selectedShell, setSelectedShell] = useState<ProxyShell>('auto');
  const [result, setResult] = useState<ResultState>({ kind: 'idle' });

  // snippet + status 병렬(원본 :1176). selectedShell 변경 시 fetcher 재생성 → 자동 재페치(§5.2).
  const fetcher = useCallback(
    (signal: AbortSignal): Promise<{ snippet: ProxySnippet; status: ProxyStatus }> =>
      Promise.all([fetchProxySnippet(selectedShell, signal), fetchProxyStatus(selectedShell, signal)]).then(
        ([snippet, status]) => ({ snippet, status }),
      ),
    [selectedShell],
  );
  const { status: fetchStatus, data, error, refetch } = useAsyncResource(fetcher);

  const onInstall = useCallback(async () => {
    setResult({ kind: 'loading', label: t('ui.settings-view.proxy.installing') });
    try {
      const d = await proxyInstall(selectedShell);
      setResult({ kind: 'installed', result: d });
      refetch(); // 통합 배지/마커 row 갱신(원본 :1392 setTimeout 재렌더).
    } catch (err) {
      setResult({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [selectedShell, t, refetch]);

  const onRestore = useCallback(
    async (backupPath: string) => {
      try {
        const d = await proxyRestore(backupPath, selectedShell);
        setResult({ kind: 'restored', result: d });
        refetch(); // restore 직후 마커 제거 → 배지 갱신(원본 :1443).
      } catch (err) {
        setResult({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    },
    [selectedShell, refetch],
  );

  if (fetchStatus === 'loading' || !data) {
    return <div className="settings-loading">{t('ui.settings-view.loading')}</div>;
  }
  if (fetchStatus === 'error') {
    return <div className="settings-error">⚠ {error}</div>;
  }

  // result slot 렌더(원본 onProxyInstall :1377 / onProxyRestore :1435 구조).
  const resultNode = (() => {
    if (result.kind === 'idle') return null;
    if (result.kind === 'loading') return <div className="settings-loading">{result.label}</div>;
    if (result.kind === 'error') return <div className="settings-error">⚠ {result.message}</div>;
    if (result.kind === 'installed') {
      const d = result.result;
      const actionLabel = d.action === 'replaced' ? t('ui.settings-view.proxy.replaced') : t('ui.settings-view.proxy.appended');
      return (
        <div className="settings-diff">
          <div className="settings-diff-title">✓ {t('ui.settings-view.proxy.installed')} ({d.shell}, {actionLabel})</div>
          <div className="settings-diff-row settings-diff-info">
            <b>{t('ui.settings-view.proxy.installed-to')}</b> <code>{d.installedTo}</code>
          </div>
          {d.backupPath && (
            <div className="settings-diff-row settings-diff-info">
              <b>{t('ui.settings-view.hooks.backup-saved')}</b> <code>{d.backupPath}</code>
            </div>
          )}
          {d.cleanedGraphModeExports > 0 && (
            <div className="settings-diff-row settings-diff-info">
              <b>{t('ui.settings-view.proxy.cleaned-graph-exports')}</b> {d.cleanedGraphModeExports}
            </div>
          )}
          <div className="settings-diff-row settings-diff-info">
            <span className="settings-meta">{d.nextAction}</span>
          </div>
          {canUndo(d.backupPath) && (
            <div className="settings-actions">
              <button
                className="settings-action-btn settings-action-secondary"
                id="proxyUndoBtn"
                onClick={() => onRestore(d.backupPath!)}
              >
                {t('ui.settings-view.proxy.undo')}
              </button>
            </div>
          )}
        </div>
      );
    }
    // restored(원본 :1435).
    const d = result.result;
    return (
      <div className="settings-diff">
        <div className="settings-diff-title">{t('ui.settings-view.proxy.restored')}</div>
        <div className="settings-diff-row settings-diff-info">
          <b>{t('ui.settings-view.hooks.restored-from')}</b> <code>{d.targetPath}</code>
        </div>
        {d.preRestoreBackup && (
          <div className="settings-diff-row settings-diff-info">
            <b>{t('ui.settings-view.hooks.pre-restore-backup')}</b> <code>{d.preRestoreBackup}</code>
          </div>
        )}
      </div>
    );
  })();

  return (
    <ProxyPanelView
      status={data.status}
      snippet={data.snippet}
      selectedShell={selectedShell}
      t={t}
      onSelectShell={setSelectedShell}
      onInstall={onInstall}
      onCopy={onCopy}
      result={resultNode}
    />
  );
}
