/**
 * Sessions — fullscreen session list (single project focus).
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/skills/ui-designer/references/tui/screen-inventory.md §T2
 */

import { Box, Text } from 'ink';
import { Card } from '../components/display/Card';
import { Gauge } from '../components/charts/Gauge';
import { tokens } from '../design-tokens';
import { formatTokens } from '../lib/format';
import type { Session } from '../types';

export type SessionsProps = {
  sessions: Session[];
  projectName: string | null;
  selectedIndex: number;
  showAll?: boolean;
};

export function Sessions({ sessions, projectName, selectedIndex, showAll = false }: SessionsProps): JSX.Element {
  return (
    <Card
      title={
        <Text color={tokens.color.primary.fg} bold>
          Sessions{projectName ? ` · ${projectName}` : ''} · {sessions.length} active
        </Text>
      }
      focused
    >
      {sessions.length === 0 ? (
        <Box flexDirection="column" paddingY={1}>
          <Text color={tokens.color.muted.fg}>( )( )  No active sessions{projectName ? ` for ${projectName}` : ''}</Text>
          <Text dimColor>
            {showAll
              ? 'Once Claude runs, sessions appear here.'
              : 'Start Claude in this directory, or set SPYGLASS_ALL_PROJECTS=1 to see every project.'}
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {sessions.map((s, i) => {
            const selected = i === selectedIndex;
            const marker = selected ? '▶ ' : '  ';
            const idColor = selected ? tokens.color.accent.fg : tokens.color.fg.fg;
            const dotColor = selected ? tokens.color.accent.fg : tokens.color.primary.fg;
            return (
              <Box key={s.id} flexDirection="row">
                <Text color={tokens.color.accent.fg}>{marker}</Text>
                <Text color={dotColor}>● </Text>
                <Text color={idColor} bold={selected}>{`S-${s.id.slice(0, 8)}  `}</Text>
                {showAll && s.project_name ? (
                  <Text dimColor>{`[${truncate(s.project_name, 18)}] `}</Text>
                ) : null}
                <Text dimColor>tok </Text>
                <Text color={tokens.color.success.fg}>{formatTokens(s.total_tokens ?? 0)}  </Text>
                <Gauge value={(s.total_tokens ?? 0) / 200_000} max={1} width={10} />
                <Text dimColor>  Turn </Text>
                <Text color={tokens.color.fg.fg}>{s.current_turn ?? '—'}</Text>
              </Box>
            );
          })}
          <Box marginTop={1}>
            <Text dimColor>{'  [↑↓/j k] move   [Enter] open detail'}</Text>
          </Box>
        </Box>
      )}
    </Card>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
