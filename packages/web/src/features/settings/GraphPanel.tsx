/**
 * features/settings/GraphPanel.tsx — Graph DB sub-tab 컨테이너 (P2-07)
 *
 * 원본: settings-view.js renderGraphSection(:695-849) + onGraphMode(:1013) + onLadybugInstall(:904).
 *   diag + graph-db/status 병렬 페칭(useAsyncResource) → GraphPanelView 위임. 모드 변경/Ladybug
 *   설치(SSE) 핸들러 + result slot 로컬상태(§5.2) + Toast/StickyAlert 연결(§4.4).
 *
 * 로컬 상태(아키텍처 §4.1): installResult/modeStream(부분 갱신 §5.2), toast/showRestart(§4.4).
 *   모드 변경 성공 → toast(env override 분기) + 재시작 StickyAlert + refetch(원본 :1043 재렌더).
 *   Ladybug 설치 성공 → refetch(원본 :1001 renderGraphSection).
 *
 * @module features/settings/GraphPanel
 */
import { useCallback, useState } from 'react';
import { StickyAlert } from '../../components/settings/StickyAlert';
import { Toast } from '../../components/settings/Toast';
import { GraphPanelView } from './GraphPanelView';
import { fetchDiag } from './hooks-api';
import { fetchGraphDbStatus, ladybugInstallStream, setGraphMode } from './graph-api';
import { isInstallSuccess } from './logic';
import { useAsyncResource } from './use-settings-diag';
import type { DiagData, GraphMode, InstallEvent, InstallResult, LadybugStatus } from './types';

export interface GraphPanelProps {
  t: (key: string, vars?: Record<string, unknown>) => string;
  onCopy?: (text: string) => void;
}

/** Ladybug 설치 SSE result slot 상태(원본 #ladybugInstallResult, §5.2). */
type InstallState =
  | { kind: 'idle' }
  | { kind: 'streaming'; cmd: string | null; lines: { text: string; stderr: boolean }[] }
  | { kind: 'done'; cmd: string | null; lines: { text: string; stderr: boolean }[]; result: InstallResult }
  | { kind: 'error'; message: string };

export function GraphPanel({ t, onCopy }: GraphPanelProps) {
  // diag + graph-db/status 병렬(원본 :702). 단일 AbortSignal 로 둘 다 취소.
  const fetcher = useCallback(
    (signal: AbortSignal): Promise<{ diag: DiagData; ladybug: LadybugStatus | null }> =>
      Promise.all([
        fetchDiag(signal),
        // graph-db/status 실패는 카드 생략(원본 :710 ladybugJson.success ? data : null) — diag 실패만 치명.
        fetchGraphDbStatus(signal).catch(() => null),
      ]).then(([diag, ladybug]) => ({ diag, ladybug })),
    [],
  );
  const { status, data, error, refetch } = useAsyncResource(fetcher);

  const [install, setInstall] = useState<InstallState>({ kind: 'idle' });
  const [toast, setToast] = useState<string | null>(null);
  const [showRestart, setShowRestart] = useState(false);

  const onSelectMode = useCallback(
    async (mode: GraphMode) => {
      try {
        const d = await setGraphMode(mode);
        // env override 면 별도 안내 toast(원본 :1031-1035).
        setToast(d.source === 'env' ? t('ui.settings-view.graph.toast-env-override') : t('ui.settings-view.graph.toast-saved'));
        setShowRestart(true); // 재시작 안내(원본 :1038).
        refetch(); // 통합 배지 갱신(원본 :1043 재렌더).
      } catch (err) {
        setToast(`⚠ ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [t, refetch],
  );

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
          if (isInstallSuccess(result.status)) refetch(); // 성공 시 재페치(원본 :1001).
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

  // Ladybug 설치 result slot 렌더(원본 onLadybugInstall :907-1000 구조).
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
          <div className="install-running">{t('ui.settings-view.graph.ladybug.installing')}</div>
        </>
      );
    }
    // done — headline + restart 배너 + hints(원본 :988-1000).
    const r = install.result;
    const ok = isInstallSuccess(r.status);
    return (
      <>
        {stream}
        <div className="install-summary">
          {ok ? (
            <div className="settings-success">
              {t('ui.settings-view.graph.ladybug.install-success')}{r.version ? ` v${r.version}` : ''}
            </div>
          ) : (
            <div className="settings-error">{t('ui.settings-view.graph.ladybug.install-failed')}: {r.error || ''}</div>
          )}
          {r.restartRequired && (
            <div className="settings-warn-banner">⚠ {t('ui.settings-view.graph.ladybug.restart-required')}</div>
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
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      <GraphPanelView
        graph={data.diag.graph}
        ladybug={data.ladybug}
        t={t}
        onSelectMode={onSelectMode}
        onInstall={onInstall}
        installResult={installResult}
      />
    </>
  );
}
