/**
 * App — root component.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/docs/plans/tui-redesign-impl/plan.md
 */

import { useState } from 'react';
import { Box, Text } from 'ink';
import { CapabilitiesProvider } from './hooks/useCapabilities';
import { useKeyboard } from './hooks/useKeyboard';
import { useSSE } from './hooks/useSSE';
import { useStripStats } from './hooks/useStripStats';
import { feedStore } from './stores/feed-store';
import { Strip } from './components/layout/Strip';
import { Sidebar } from './components/layout/Sidebar';
import { MainPanel } from './components/layout/MainPanel';
import { ResponsiveShell, useTermCols, useTermRows } from './components/layout/ResponsiveShell';
import { TabBar } from './components/nav/TabBar';
import { StatusBar } from './components/nav/StatusBar';
import { LiveFeed } from './screens/LiveFeed';
import { Sessions } from './screens/Sessions';
import { Tools } from './screens/Tools';
import { Anomalies } from './screens/Anomalies';
import { Ambient } from './screens/Ambient';
import { tokens } from './design-tokens';
import type { ScreenId } from './types';

const API_URL = process.env.SPYGLASS_API_URL ?? 'http://127.0.0.1:9999';

export function App(): JSX.Element {
  const [view, setView] = useState<ScreenId>('live');
  const [zoom, setZoom] = useState(false);
  const cols = useTermCols();
  const rows = useTermRows();

  const { status, eventsPerSec, lastEventAt, pulseBuckets } = useSSE(API_URL);
  const { strip, activeSessions } = useStripStats(API_URL);

  useKeyboard({
    onView: (s) => {
      if (view === 'ambient') setView(s);
      else setView(s);
    },
    onQuit: () => process.exit(0),
    onZoom: () => setZoom((z) => !z),
    onAmbient: () => setView((v) => (v === 'ambient' ? 'live' : 'ambient')),
  });

  const showSidebar = !zoom && view !== 'ambient' && cols >= tokens.layout.breakpoint.md;
  const frozen = feedStore.isFrozen();

  if (view === 'ambient') {
    return (
      <CapabilitiesProvider>
        <Box flexDirection="column" height={rows}>
          <Ambient
            pulseBuckets={pulseBuckets}
            lastEventAt={lastEventAt}
            stats={strip}
            width={cols}
            rows={rows}
          />
          <StatusBar
            hints={[
              { key: 'm', label: 'exit ambient' },
              { key: 'q', label: 'quit' },
            ]}
            sseStatus={status}
            eventsPerSec={eventsPerSec}
            frozen={frozen}
          />
        </Box>
      </CapabilitiesProvider>
    );
  }

  return (
    <CapabilitiesProvider>
      <Box flexDirection="column" height={rows}>
        <Strip
          pulseBuckets={pulseBuckets}
          lastEventAt={lastEventAt}
          stats={strip}
          activeSessions={activeSessions}
          width={cols}
          status={status as 'open' | 'connecting' | 'reconnecting' | 'closed'}
        />

        <Box marginY={0}>
          <TabBar active={view} />
        </Box>

        <ResponsiveShell
          showSidebar={showSidebar}
          sidebar={<Sidebar activeSessions={activeSessions} />}
          main={renderMain(view, cols - (showSidebar ? tokens.layout.sidebarWidth.default + 2 : 0), rows - 12, status, frozen)}
        />

        <StatusBar
          hints={hintsFor(view)}
          sseStatus={status}
          eventsPerSec={eventsPerSec}
          frozen={frozen}
        />
      </Box>
    </CapabilitiesProvider>
  );
}

function renderMain(view: ScreenId, width: number, rows: number, sseStatus: string, frozen: boolean): React.ReactNode {
  switch (view) {
    case 'live':
      return <LiveFeed width={width} rows={rows} sseStatus={sseStatus} frozen={frozen} />;
    case 'sessions':
      return <SessionsScreen />;
    case 'tools':
      return <Tools apiUrl={API_URL} />;
    case 'anomalies':
      return <Anomalies apiUrl={API_URL} />;
    case 'session-detail':
    default:
      return <LiveFeed width={width} rows={rows} sseStatus={sseStatus} frozen={frozen} />;
  }
}

function SessionsScreen(): JSX.Element {
  const { activeSessions } = useStripStats(API_URL);
  return <Sessions activeSessions={activeSessions} />;
}

function hintsFor(view: ScreenId) {
  const common = [
    { key: '1', label: 'live' },
    { key: '2', label: 'sessions' },
    { key: '3', label: 'tools' },
    { key: '4', label: 'anomalies' },
  ];
  if (view === 'live') {
    return [
      ...common,
      { key: 'space', label: 'freeze' },
      { key: 'm', label: 'ambient' },
      { key: 'q', label: 'quit' },
    ];
  }
  return [
    ...common,
    { key: 'm', label: 'ambient' },
    { key: 'q', label: 'quit' },
  ];
}
