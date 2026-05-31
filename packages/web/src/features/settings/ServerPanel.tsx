/**
 * features/settings/ServerPanel.tsx — 서버/로그 sub-tab 컨테이너 (P2-06)
 *
 * 원본: settings-view.js renderServerSection(:1460-1523). diag + logs 병렬 페칭(:1465-1468) →
 *   ServerPanelView 위임. 읽기 전용 + 포트 변경 명령 복사(onCopy → 상위 Toast 호스트).
 *
 * @module features/settings/ServerPanel
 */
import { useCallback } from 'react';
import { ServerPanelView } from './ServerPanelView';
import { fetchDiag, fetchLogs } from './hooks-api';
import { useAsyncResource } from './use-settings-diag';
import type { DiagData, LogsData } from './types';

export interface ServerPanelProps {
  t: (key: string, vars?: Record<string, unknown>) => string;
  onCopy?: (text: string) => void;
}

export function ServerPanel({ t, onCopy }: ServerPanelProps) {
  // diag + logs 병렬(원본 :1465). 단일 AbortSignal 로 둘 다 취소.
  const fetcher = useCallback(
    (signal: AbortSignal): Promise<{ diag: DiagData; logs: LogsData }> =>
      Promise.all([fetchDiag(signal), fetchLogs(signal)]).then(([diag, logs]) => ({ diag, logs })),
    [],
  );
  const { status, data, error } = useAsyncResource(fetcher);

  if (status === 'loading' || !data) {
    return <div className="settings-loading">{t('ui.settings-view.loading')}</div>;
  }
  if (status === 'error') {
    return <div className="settings-error">⚠ {error}</div>;
  }
  return <ServerPanelView server={data.diag.server} logs={data.logs} t={t} onCopy={onCopy} />;
}
