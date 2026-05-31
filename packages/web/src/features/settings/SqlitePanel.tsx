/**
 * features/settings/SqlitePanel.tsx — SQLite sub-tab 컨테이너 (P2-07)
 *
 * 원본: settings-view.js renderSqliteSection(:1062-1154). sqlite/info 단일 페칭(원본 :1072,
 *   방안 B — diag 미호출) → SqlitePanelView 위임. 읽기 전용 + CLI 명령 복사(onCopy → 상위 Toast).
 *
 * @module features/settings/SqlitePanel
 */
import { useCallback } from 'react';
import { SqlitePanelView } from './SqlitePanelView';
import { fetchSqliteInfo } from './graph-api';
import { useAsyncResource } from './use-settings-diag';

export interface SqlitePanelProps {
  t: (key: string, vars?: Record<string, unknown>) => string;
  onCopy?: (text: string) => void;
}

export function SqlitePanel({ t, onCopy }: SqlitePanelProps) {
  const fetcher = useCallback((signal: AbortSignal) => fetchSqliteInfo(signal), []);
  const { status, data, error } = useAsyncResource(fetcher);

  if (status === 'loading' || !data) {
    return <div className="settings-loading">{t('ui.settings-view.loading')}</div>;
  }
  if (status === 'error') {
    return <div className="settings-error">⚠ {error}</div>;
  }
  return <SqlitePanelView info={data} t={t} onCopy={onCopy} />;
}
