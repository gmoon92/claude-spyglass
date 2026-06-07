/**
 * features/settings/DiagPanel.tsx — 진단 sub-tab 컨테이너 (P2-06)
 *
 * 원본: settings-view.js renderDiagSection(:176-368). useAsyncResource(fetchDiag)로 데이터 페칭 +
 *   loading/error 셸 + DiagPanelView 위임. jump 버튼은 onJump 로 상위(SettingsView 라우터)에 통지
 *   (§5.4 — _activeTab 스토어 갱신). inline 복사는 onCopy(상위 Toast 호스트 트리거).
 *
 * @module features/settings/DiagPanel
 */
import { useCallback } from 'react';
import { DiagPanelView } from './DiagPanelView';
import { SettingsSkeleton } from './SettingsSkeleton';
import { fetchDiag } from './hooks-api';
import { useAsyncResource } from './use-settings-diag';

export interface DiagPanelProps {
  t: (key: string, vars?: Record<string, unknown>) => string;
  onJump?: (tab: string) => void;
  onCopy?: (text: string) => void;
}

export function DiagPanel({ t, onJump, onCopy }: DiagPanelProps) {
  const fetcher = useCallback((signal: AbortSignal) => fetchDiag(signal), []);
  const { status, data, error } = useAsyncResource(fetcher);

  if (status === 'loading' || !data) {
    return <SettingsSkeleton cards={4} label={t('ui.settings-view.loading')} />;
  }
  if (status === 'error') {
    return <div className="settings-error">⚠ {error}</div>;
  }
  return <DiagPanelView data={data} t={t} onJump={onJump} onCopy={onCopy} />;
}
