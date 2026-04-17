/**
 * Main App Component
 *
 * @description spyglass TUI 메인 앱
 */

/** @jsxImportSource react */
import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { Layout, Header, Sidebar, Main, Footer } from './components/Layout';
import { TabBar, TabContent, TabId } from './components/TabBar';
import { useKeyboard } from './hooks/useKeyboard';
import { useStats } from './hooks/useStats';
import { useSessionList } from './hooks/useSessionList';
import { LiveTab } from './components/LiveTab';
import { HistoryTab } from './components/HistoryTab';
import { AnalysisTab } from './components/AnalysisTab';

const API_URL = 'http://localhost:9999';

/**
 * 메인 앱
 */
export function App(): JSX.Element {
  const [activeTab, setActiveTab] = useState<TabId>('live');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const { data, isLoading, error } = useStats({
    apiUrl: `${API_URL}/api/dashboard`,
    autoRefresh: true,
    interval: 5000,
  });
  const { sessions } = useSessionList({
    apiUrl: `${API_URL}/api/sessions`,
    interval: 5000,
  });

  useKeyboard({
    activeTab,
    onTabChange: setActiveTab,
    onQuit: () => process.exit(0),
    selectedIndex,
    maxIndex: 10,
    onSelectionChange: setSelectedIndex,
  });

  const tabContents: Record<TabId, React.ReactNode> = {
    live: <LiveTab data={data} isLoading={isLoading} error={error} />,
    history: (
      <HistoryTab
        sessions={sessions.map(s => ({ ...s, ended_at: s.ended_at ?? undefined }))}
        onSessionSelect={() => {}}
        isActive={activeTab === 'history'}
      />
    ),
    analysis: <AnalysisTab />,
    settings: (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan">Settings Tab - Configuration</Text>
        <Text color="gray">Server: {API_URL}</Text>
      </Box>
    ),
  };

  return (
    <Layout
      header={<Header title="spyglass" status="connected" sessionCount={sessions.length} />}
      sidebar={<Sidebar sessions={sessions} />}
      main={
        <Main>
          <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
          <TabContent activeTab={activeTab} children={tabContents} />
        </Main>
      }
      footer={<Footer activeTab={activeTab} />}
    />
  );
}
