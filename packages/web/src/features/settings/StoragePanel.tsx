/**
 * features/settings/StoragePanel.tsx — 통합 Storage sub-tab 컨테이너
 *
 * 분리됐던 SQLite·Graph DB 두 탭을 단일 "Storage" 패널로 통합한다. diag(graph/retention) +
 *   sqlite/info + graph-db/status 를 *병렬* 페칭(useAsyncResource) → StoragePanelView 위임.
 *   Ladybug 미설치 시 자동 설치(SSE) 핸들러 + result slot 로컬 상태만 유지(모드 전환 제거됨).
 *
 * @module features/settings/StoragePanel
 */
import { useCallback, useState } from 'react';
import { StickyAlert } from '../../components/settings/StickyAlert';
import { StoragePanelView } from './StoragePanelView';
import { fetchDiag } from './hooks-api';
import { fetchGraphDbStatus, fetchSqliteInfo, ladybugInstallStream } from './graph-api';
import { isInstallSuccess } from './logic';
import { useAsyncResource } from './use-settings-diag';
import type { DiagData, InstallEvent, InstallResult, LadybugStatus, SqliteInfo } from './types';

export interface StoragePanelProps {
  t: (key: string, vars?: Record<string, unknown>) => string;
  onCopy?: (text: string) => void;
}

/** Ladybug 설치 SSE result slot 상태(#ladybugInstallResult). */
type InstallState =
  | { kind: 'idle' }
  | { kind: 'streaming'; cmd: string | null; lines: { text: string; stderr: boolean }[] }
  | { kind: 'done'; cmd: string | null; lines: { text: string; stderr: boolean }[]; result: InstallResult }
  | { kind: 'error'; message: string };

interface StorageResource {
  diag: DiagData;
  sqlite: SqliteInfo;
  ladybug: LadybugStatus | null;
}

export function StoragePanel({ t, onCopy }: StoragePanelProps) {
  // diag(graph/retention) + sqlite/info + graph-db/status 병렬. 단일 AbortSignal 로 모두 취소.
  const fetcher = useCallback(
    (signal: AbortSignal): Promise<StorageResource> =>
      Promise.all([
        fetchDiag(signal),
        fetchSqliteInfo(signal),
        // graph-db/status 실패는 카드 생략(ladybugJson.success ? data : null) — diag/sqlite 실패만 치명.
        fetchGraphDbStatus(signal).catch(() => null),
      ]).then(([diag, sqlite, ladybug]) => ({ diag, sqlite, ladybug })),
    [],
  );
  const { status, data, error, refetch } = useAsyncResource(fetcher);

  const [install, setInstall] = useState<InstallState>({ kind: 'idle' });
  const [showRestart, setShowRestart] = useState(false);

  const onInstall = useCallback(
    async (strategy: string) => {
      const lines: { text: string; stderr: boolean }[] = [];
      let cmd: string | null = null;
      setInstall({ kind: 'streaming', cmd, lines: [] });
      const onEvent = (evt: InstallEvent) => {
        if (evt.type === 'start') {
          cmd = `$ ${(evt.cmd || []).join(' ')}${evt.cwd ? `  (cwd: ${evt.cwd})` : ''}`;
        } else if (evt.type === 'stdout' || evt.type === 'stderr') {
          lines.push({ text: evt.line || '', stderr: evt.type === 'stderr' });
        }
        setInstall({ kind: 'streaming', cmd, lines: [...lines] });
      };
      try {
        const result = await ladybugInstallStream(strategy, onEvent);
        if (result) {
          setInstall({ kind: 'done', cmd, lines: [...lines], result });
          if (isInstallSuccess(result.status)) {
            if (result.restartRequired) setShowRestart(true);
            refetch(); // 성공 시 재페치.
          }
        } else {
          setInstall({ kind: 'idle' });
        }
      } catch (err) {
        setInstall({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    },
    [refetch],
  );

  if (status === 'loading' || !data) {
    return <div className="settings-loading">{t('ui.settings-view.loading')}</div>;
  }
  if (status === 'error') {
    return <div className="settings-error">⚠ {error}</div>;
  }

  // Ladybug 설치 result slot 렌더(원본 GraphPanel onLadybugInstall 구조).
  const installResult = (() => {
    if (install.kind === 'idle') return null;
    if (install.kind === 'error') return <div className="settings-error">⚠ {install.message}</div>;
    const stream = (
      <>
        {install.cmd && <div className="install-cmd">{install.cmd}</div>}
        <pre className="install-stream">
          {install.lines.map((l, i) => (
            <span key={i} className={l.stderr ? 'stream-stderr' : undefined}>{l.text}{'\n'}</span>
          ))}
        </pre>
      </>
    );
    if (install.kind === 'streaming') {
      return (
        <>
          {stream}
          <div className="install-running">{t('ui.settings-view.storage.graph.installing')}</div>
        </>
      );
    }
    const r = install.result;
    const ok = isInstallSuccess(r.status);
    return (
      <>
        {stream}
        <div className="install-summary">
          {ok ? (
            <div className="settings-success">
              {t('ui.settings-view.storage.graph.install-success')}{r.version ? ` v${r.version}` : ''}
            </div>
          ) : (
            <div className="settings-error">{t('ui.settings-view.storage.graph.install-failed')}: {r.error || ''}</div>
          )}
          {r.restartRequired && (
            <div className="settings-warn-banner">⚠ {t('ui.settings-view.storage.graph.restart-required')}</div>
          )}
          {Array.isArray(r.hints) && r.hints.length > 0 && (
            <ul className="install-hint-list">
              {r.hints.map((h, i) => <li key={i}>{h}</li>)}
            </ul>
          )}
        </div>
      </>
    );
  })();

  return (
    <>
      {showRestart && (
        <StickyAlert
          message={t('ui.settings-view.hooks.restart-required-banner')}
          kind="restart"
          onDismissed={() => setShowRestart(false)}
        />
      )}
      <StoragePanelView
        sqlite={data.sqlite}
        graph={data.diag.graph}
        ladybug={data.ladybug}
        retentionDays={data.diag.retention?.days ?? 0}
        t={t}
        onCopy={onCopy}
        onInstall={onInstall}
        installResult={installResult}
      />
    </>
  );
}
