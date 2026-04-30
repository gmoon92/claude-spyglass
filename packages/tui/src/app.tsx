/**
 * App — root component.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/docs/plans/tui-redesign-impl/plan.md
 */

import { useMemo, useState } from 'react';
import { Box } from 'ink';
import { CapabilitiesProvider } from './hooks/useCapabilities';
import { useKeyboard } from './hooks/useKeyboard';
import { useSSE } from './hooks/useSSE';
import { useStripStats } from './hooks/useStripStats';
import { feedStore } from './stores/feed-store';
import { Strip } from './components/layout/Strip';
import { Sidebar } from './components/layout/Sidebar';
import { ResponsiveShell, useTermCols, useTermRows } from './components/layout/ResponsiveShell';
import { TabBar } from './components/nav/TabBar';
import { StatusBar } from './components/nav/StatusBar';
import { PulseWave, derivePulseState } from './components/signature/PulseWave';
import { LiveFeed } from './screens/LiveFeed';
import { Sessions } from './screens/Sessions';
import { SessionDetail } from './screens/SessionDetail';
import { Tools } from './screens/Tools';
import { Anomalies } from './screens/Anomalies';
import { Ambient } from './screens/Ambient';
import { tokens } from './design-tokens';
import { getCurrentProject } from './lib/current-project';
import { nextTimeRange } from './lib/time-range';
import type { TimeRange } from './lib/time-range';
import type { ScreenId, Session } from './types';

const API_URL = process.env.SPYGLASS_API_URL ?? 'http://127.0.0.1:9999';

export function App(): JSX.Element {
  const [view, setView] = useState<ScreenId>('live');
  const [zoom, setZoom] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('1h');
  const cols = useTermCols();
  const rows = useTermRows();

  const project = useMemo(() => getCurrentProject(), []);

  const { status, eventsPerSec, lastEventAt, pulseBuckets, requestBuckets } = useSSE(API_URL);
  const { strip, activeSessions, toolStats } = useStripStats(API_URL);

  // Filter sessions to current project (unless SPYGLASS_ALL_PROJECTS=1).
  const sessions: Session[] = useMemo(() => {
    if (project.showAll || !project.name) return activeSessions;
    return activeSessions.filter((s) => s.project_name === project.name);
  }, [activeSessions, project.showAll, project.name]);

  // Clamp selection within bounds when list size changes.
  const safeSelected = sessions.length === 0 ? 0 : Math.min(selectedIndex, sessions.length - 1);

  useKeyboard({
    onView: (s) => {
      // Leave detail when navigating tabs.
      if (view === 'session-detail') setActiveSessionId(null);
      setView(s);
    },
    onQuit: () => process.exit(0),
    onZoom: () => setZoom((z) => !z),
    onAmbient: () => setView((v) => (v === 'ambient' ? 'live' : 'ambient')),
    onMove: (delta) => {
      if (view !== 'sessions' || sessions.length === 0) return;
      setSelectedIndex((i) => {
        const next = Math.max(0, Math.min(sessions.length - 1, i + delta));
        return next;
      });
    },
    onEnter: () => {
      if (view === 'sessions' && sessions[safeSelected]) {
        setActiveSessionId(sessions[safeSelected].id);
        setView('session-detail');
      }
    },
    onBack: () => {
      if (view === 'session-detail') {
        setActiveSessionId(null);
        setView('sessions');
      }
    },
    onTimeRangeCycle: () => setTimeRange((r) => nextTimeRange(r)),
  });

  const showSidebar = !zoom && view !== 'ambient' && cols >= tokens.layout.breakpoint.md;
  const frozen = feedStore.isFrozen();

  const pulseState = derivePulseState(pulseBuckets, lastEventAt);

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
            lastEventAt={lastEventAt}
          />
        </Box>
      </CapabilitiesProvider>
    );
  }

  return (
    <CapabilitiesProvider>
      <Box flexDirection="column" height={rows}>
        {/* Header: TabBar only — title/status moved to separate boxes. */}
        <Box marginY={0}>
          <TabBar active={view === 'session-detail' ? 'sessions' : view} />
        </Box>

        {/* Pulse Wave — promoted to its own full-width box (6 rows). */}
        <PulseWave
          buckets={pulseBuckets}
          state={pulseState}
          width={cols - 4}
          height={6}
        />

        {/* KPI Strip: 3 BigKpi + Sessions sidebar. */}
        <Strip
          pulseBuckets={pulseBuckets}
          requestBuckets={requestBuckets}
          lastEventAt={lastEventAt}
          stats={strip}
          activeSessions={sessions}
          width={cols}
          status={status as 'open' | 'connecting' | 'reconnecting' | 'closed'}
        />

        <ResponsiveShell
          showSidebar={showSidebar}
          sidebar={
            <Sidebar
              sessions={sessions}
              projectName={project.showAll ? null : project.name}
              selectedIndex={view === 'sessions' || view === 'session-detail' ? safeSelected : -1}
              showAll={project.showAll}
              toolStats={toolStats.map((t) => ({ tool_name: t.tool_name, calls: t.calls }))}
            />
          }
          main={renderMain({
            view,
            sessions,
            selectedIndex: safeSelected,
            activeSessionId,
            project,
            width: cols - (showSidebar ? tokens.layout.sidebarWidth.default + 2 : 0),
            rows: rows - 14,
            sseStatus: status,
            frozen,
            timeRange,
          })}
        />

        <StatusBar
          hints={hintsFor(view)}
          sseStatus={status}
          eventsPerSec={eventsPerSec}
          frozen={frozen}
          lastEventAt={lastEventAt}
        />
      </Box>
    </CapabilitiesProvider>
  );
}

type RenderMainArgs = {
  view: ScreenId;
  sessions: Session[];
  selectedIndex: number;
  activeSessionId: string | null;
  project: { name: string | null; showAll: boolean };
  width: number;
  rows: number;
  sseStatus: string;
  frozen: boolean;
  timeRange: TimeRange;
};

function renderMain(args: RenderMainArgs) {
  const { view, sessions, selectedIndex, activeSessionId, project, width, rows, sseStatus, frozen, timeRange } = args;
  switch (view) {
    case 'live':
      return <LiveFeed width={width} rows={rows} sseStatus={sseStatus} frozen={frozen} />;
    case 'sessions':
      return (
        <Sessions
          sessions={sessions}
          projectName={project.showAll ? null : project.name}
          selectedIndex={selectedIndex}
          showAll={project.showAll}
        />
      );
    case 'session-detail':
      if (activeSessionId) return <SessionDetail sessionId={activeSessionId} />;
      return (
        <Sessions
          sessions={sessions}
          projectName={project.showAll ? null : project.name}
          selectedIndex={selectedIndex}
          showAll={project.showAll}
        />
      );
    case 'tools':
      return <Tools apiUrl={API_URL} timeRange={timeRange} />;
    case 'anomalies':
      return <Anomalies apiUrl={API_URL} timeRange={timeRange} />;
    default:
      return <LiveFeed width={width} rows={rows} sseStatus={sseStatus} frozen={frozen} />;
  }
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
      { key: '↑↓', label: 'select' },
      { key: '⏎', label: 'expand' },
      { key: 'f', label: 'follow' },
      { key: 'g/G', label: 'top/bot' },
      { key: 'm', label: 'ambient' },
      { key: 'q', label: 'quit' },
    ];
  }
  if (view === 'sessions') {
    return [
      ...common,
      { key: '↑↓', label: 'move' },
      { key: '⏎', label: 'open' },
      { key: 'q', label: 'quit' },
    ];
  }
  if (view === 'session-detail') {
    return [
      ...common,
      { key: 'esc', label: 'back' },
      { key: 'q', label: 'quit' },
    ];
  }
  if (view === 'tools' || view === 'anomalies') {
    return [
      ...common,
      { key: 't', label: 'range' },
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
