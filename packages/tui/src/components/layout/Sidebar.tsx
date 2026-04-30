/**
 * Sidebar — single-project session list + tools mini chart.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/skills/ui-designer/references/tui/layouts.md §3
 */

import { Box, Text } from 'ink';
import { tokens } from '../../design-tokens';
import { Card } from '../display/Card';
import { BarChart } from '../charts/BarChart';
import { formatTokens } from '../../lib/format';
import type { Session } from '../../types';

export type SidebarProps = {
  sessions: Session[];
  projectName: string | null;
  selectedIndex?: number;
  toolStats?: Array<{ tool_name: string; calls: number }>;
  width?: number;
  focused?: boolean;
  showAll?: boolean;
};

export function Sidebar({
  sessions,
  projectName,
  selectedIndex = -1,
  toolStats = [],
  width = tokens.layout.sidebarWidth.default,
  focused = false,
  showAll = false,
}: SidebarProps): JSX.Element {
  const headerLabel = showAll ? 'Sessions' : projectName ?? 'Sessions';
  const innerWidth = Math.max(8, width - 4);

  return (
    <Box width={width} flexDirection="column">
      <Card title={headerLabel} focused={focused}>
        {sessions.length === 0 ? (
          <Text dimColor>No active sessions</Text>
        ) : (
          <Box flexDirection="column">
            {!showAll && projectName ? (
              <Text dimColor>{sessions.length} active</Text>
            ) : null}
            {sessions.slice(0, 8).map((s, i) => {
              const selected = i === selectedIndex;
              const marker = selected ? '▶' : ' ';
              const dotColor = selected ? tokens.color.accent.fg : tokens.color.primary.fg;
              return (
                <Box key={s.id} flexDirection="row">
                  <Text color={tokens.color.accent.fg}>{marker} </Text>
                  <Text color={dotColor}>● </Text>
                  <Text
                    color={selected ? tokens.color.accent.fg : tokens.color.fg.fg}
                    bold={selected}
                  >
                    {truncate(`S-${s.id.slice(0, 6)}`, innerWidth - 6)}
                  </Text>
                  <Text dimColor> {formatTokens(s.total_tokens ?? 0)}</Text>
                </Box>
              );
            })}
            {sessions.length > 8 ? (
              <Text dimColor>{`+${sessions.length - 8} more`}</Text>
            ) : null}
          </Box>
        )}
      </Card>
      <Box marginTop={1} />
      <Card title="Tools · today">
        {toolStats.length === 0 ? (
          <Text dimColor>—</Text>
        ) : (
          <BarChart
            series={toolStats.slice(0, 5).map((t) => ({ label: t.tool_name, value: t.calls }))}
            width={Math.max(8, width - 16)}
            labelWidth={8}
          />
        )}
      </Card>
    </Box>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(1, max - 1)) + '…';
}
