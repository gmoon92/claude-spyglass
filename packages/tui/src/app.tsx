/**
 * Main App Component
 *
 * @description spyglass TUI 메인 앱
 */

import React, { useState } from 'react';
import { Box } from 'ink';
import { Layout, Header, Sidebar, Main, Footer } from './components/Layout';
import { TabBar, TabContent, TabId } from './components/TabBar';
import { useKeyboard } from './hooks/useKeyboard';

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

  // 탭 컨텐츠
  const tabContents: Record<TabId, React.ReactNode> = {
    live: (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text color="cyan">Live Tab - Real-time Monitoring</Text>
        </Box>
        <Text color="gray">Press F1~F4 to switch tabs, q to quit</Text>
      </Box>
    ),
    history: (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan">History Tab - Past Sessions</Text>
      </Box>
    ),
    analysis: (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan">Analysis Tab - Token Usage Stats</Text>
      </Box>
    ),
    settings: (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan">Settings Tab - Configuration</Text>
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

// React import 추가
import { Text } from 'ink';
