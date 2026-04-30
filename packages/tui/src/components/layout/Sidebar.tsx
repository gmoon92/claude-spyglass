/**
 * Sidebar — session tree + tools mini list.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/skills/ui-designer/references/tui/layouts.md §3
 */

import { Box, Text } from 'ink';
import { tokens } from '../../design-tokens';
import { Card } from '../display/Card';
import { Divider } from '../display/Divider';
import { BarChart } from '../charts/BarChart';
import { formatTokens } from '../../lib/format';
import type { Session } from '../../types';

export type SidebarProps = {
  activeSessions: Session[];
  toolStats?: Array<{ tool_name: string; calls: number }>;
  width?: number;
  focused?: boolean;
};

export function Sidebar({ activeSessions, toolStats = [], width = tokens.layout.sidebarWidth.default, focused = false }: SidebarProps): JSX.Element {
  // Group sessions by project
  const groups = new Map<string, Session[]>();
  for (const s of activeSessions) {
    const key = s.project_name ?? 'unknown';
    const arr = groups.get(key) ?? [];
    arr.push(s);
    groups.set(key, arr);
  }

  return (
    <Box width={width} flexDirection="column">
      <Card title="Sessions" focused={focused}>
        {groups.size === 0 ? (
          <Text dimColor>No active sessions</Text>
        ) : (
          [...groups.entries()].map(([proj, sessions]) => (
            <Box key={proj} flexDirection="column">
              <Text color={tokens.color.primary.fg}>▾ {truncate(proj, width - 6)}</Text>
              <Text dimColor>  {sessions.length} active</Text>
              {sessions.slice(0, 4).map((s) => (
                <Box key={s.id} flexDirection="row">
                  <Text color={tokens.color.primary.fg}>  ● </Text>
                  <Text color={tokens.color.fg.fg}>{shortId(s.id)} </Text>
                  <Text dimColor>{formatTokens(s.total_tokens ?? 0)}</Text>
                </Box>
              ))}
            </Box>
          ))
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

function shortId(id: string): string {
  return `S-${id.slice(0, 6)}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
