/**
 * Main App Component
 *
 * @description spyglass TUI 메인 앱
 */

/** @jsxImportSource react */
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { Layout, Header, Sidebar, Main, Footer } from './components/Layout';
import { TabBar, TabContent, TabId } from './components/TabBar';
import { useKeyboard } from './hooks/useKeyboard';
import { LiveTab } from './components/LiveTab';
import { HistoryTab } from './components/HistoryTab';
import { AnalysisTab } from './components/AnalysisTab';

/**
 * 메인 앱
 */
export function App(): JSX.Element {
  // 상태
  const [activeTab, setActiveTab] = useState<TabId>('live');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // 키보드 핸들러
  useKeyboard({
    activeTab,
    onTabChange: setActiveTab,
    onQuit: () => process.exit(0),
    selectedIndex,
    maxIndex: 10,
    onSelectionChange: setSelectedIndex,
  });

  // 세션 데이터 (임시 - 나중에 API 연동)
  const [sessions, setSessions] = useState<Array<{
    id: string;
    project_name: string;
    started_at: number;
    total_tokens: number;
  }>>([]);

  // 탭 컨텐츠
  const tabContents: Record<TabId, React.ReactNode> = {
    live: <LiveTab />,
    history: (
      <HistoryTab
        sessions={sessions}
        onSessionSelect={(session) => {
          console.log('Selected:', session);
        }}
      />
    ),
    analysis: <AnalysisTab />,
    settings: (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan">Settings Tab - Configuration</Text>
        <Text color="gray">Server: http://localhost:9999</Text>
      </Box>
    ),
  };

  return (
    <Layout
      header={<Header title="spyglass" status="connected" sessionCount={0} />}
      sidebar={<Sidebar sessions={[]} />}
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
