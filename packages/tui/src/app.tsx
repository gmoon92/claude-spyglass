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
import { HelpOverlay } from './components/overlays/HelpOverlay';
import { PanelBoundary } from './components/feedback/PanelBoundary';
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
  const [helpOpen, setHelpOpen] = useState(false);
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
    onTimeRangeCycle: () => {
      // Only meaningful on screens that actually use timeRange.
      if (view !== 'tools' && view !== 'anomalies') return;
      setTimeRange((r) => nextTimeRange(r));
    },
    onHelp: () => setHelpOpen((o) => !o),
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
          {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
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
        <PanelBoundary name="PulseWave">
          <PulseWave
            buckets={pulseBuckets}
            state={pulseState}
            width={cols - 4}
            height={6}
          />
        </PanelBoundary>

        {/* KPI Strip: 3 BigKpi + Sessions sidebar. */}
        <PanelBoundary name="Strip">
          <Strip
            pulseBuckets={pulseBuckets}
            requestBuckets={requestBuckets}
            lastEventAt={lastEventAt}
            stats={strip}
            activeSessions={sessions}
            width={cols}
            status={status as 'open' | 'connecting' | 'reconnecting' | 'closed'}
          />
        </PanelBoundary>

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
          main={
            <PanelBoundary name="Main">
              {renderMain({
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
            </PanelBoundary>
          }
        />

        <StatusBar
          hints={hintsFor(view, timeRange)}
          sseStatus={status}
          eventsPerSec={eventsPerSec}
          frozen={frozen}
          lastEventAt={lastEventAt}
        />
        {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
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
      return <LiveFeed width={width} rows={rows} sseStatus={sseStatus} frozen={frozen} apiUrl={API_URL} />;
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
      if (activeSessionId) return <SessionDetail sessionId={activeSessionId} apiUrl={API_URL} />;
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
      return <LiveFeed width={width} rows={rows} sseStatus={sseStatus} frozen={frozen} apiUrl={API_URL} />;
  }
}

function hintsFor(view: ScreenId, timeRange?: string) {
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
      { key: 't', label: timeRange ? `range:${timeRange}` : 'range' },
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
