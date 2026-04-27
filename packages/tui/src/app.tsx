/**
 * Main App Component
 *
 * @description spyglass TUI 메인 앱
 */

/** @jsxImportSource react */
import React, { useState, useCallback } from 'react';
import { Layout, Header, Sidebar, Main, Footer } from './components/Layout';
import { TabBar, TabContent, TabId } from './components/TabBar';
import { AlertBanner } from './components/AlertBanner';
import { useKeyboard } from './hooks/useKeyboard';
import { useStats } from './hooks/useStats';
import { useSessionList } from './hooks/useSessionList';
import { useAlerts } from './hooks/useAlerts';
import { LiveTab } from './components/LiveTab';
import { HistoryTab } from './components/HistoryTab';
import { AnalysisTab } from './components/AnalysisTab';
import { SettingsTab } from './components/SettingsTab';

const API_URL = 'http://localhost:9999';

/**
 * 메인 앱
 */
export function App(): JSX.Element {
  const [activeTab, setActiveTab] = useState<TabId>('live');
  const [selectedIndex, setSelectedIndex] = useState(0);
  // ADR-013: Sidebar selectedId 전달 + 탭 간 세션 점프
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const { data, isLoading, error } = useStats({
    apiUrl: `${API_URL}/api/dashboard`,
    autoRefresh: true,
    interval: 5000,
  });
  const { sessions } = useSessionList({
    apiUrl: `${API_URL}/api/sessions`,
    interval: 5000,
  });

  // ADR-010 A-2: AlertBanner 노출 — useAlerts hook 사용
  const { currentLevel, currentAlert } = useAlerts();

  useKeyboard({
    activeTab,
    onTabChange: setActiveTab,
    onQuit: () => process.exit(0),
    selectedIndex,
    maxIndex: Math.max(0, sessions.length - 1),  // ADR-013: sessions 길이 기준 동적
    onSelectionChange: setSelectedIndex,
  });

  // ADR-013: Top Requests / History에서 세션 선택 → history 탭으로 점프
  const handleSessionSelect = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId);
    setActiveTab('history');
  }, []);

  const tabContents: Record<TabId, React.ReactNode> = {
    live: <LiveTab data={data} isLoading={isLoading} error={error} />,
    history: (
      <HistoryTab
        sessions={sessions.map(s => ({ ...s, ended_at: s.ended_at ?? undefined }))}
        onSessionSelect={(s) => handleSessionSelect(s.id)}
        isActive={activeTab === 'history'}
      />
    ),
    analysis: (
      <AnalysisTab
        isActive={activeTab === 'analysis'}
        onSessionSelect={handleSessionSelect}
      />
    ),
    settings: <SettingsTab isActive={activeTab === 'settings'} />,
  };

  return (
    <Layout
      header={<Header title="spyglass" status="connected" sessionCount={sessions.length} />}
      sidebar={<Sidebar sessions={sessions} selectedId={selectedSessionId ?? undefined} />}
      main={
        <Main>
          {/* ADR-010 A-2: 알림 노출 — normal 등급에서는 미표시 */}
          {currentLevel !== 'normal' && currentAlert && (
            <AlertBanner level={currentLevel} alert={currentAlert} />
          )}
          <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
          <TabContent activeTab={activeTab} children={tabContents} />
        </Main>
      }
      footer={<Footer activeTab={activeTab} />}
    />
  );
}
