/**
 * Sessions — fullscreen project tree.
 */

import { Box, Text } from 'ink';
import { Card } from '../components/display/Card';
import { Gauge } from '../components/charts/Gauge';
import { tokens } from '../design-tokens';
import { formatTokens } from '../lib/format';
import type { Session } from '../types';

export type SessionsProps = {
  activeSessions: Session[];
};

export function Sessions({ activeSessions }: SessionsProps): JSX.Element {
  const groups = new Map<string, Session[]>();
  for (const s of activeSessions) {
    const key = s.project_name ?? 'unknown';
    const arr = groups.get(key) ?? [];
    arr.push(s);
    groups.set(key, arr);
  }

  return (
    <Card
      title={
        <Text color={tokens.color.primary.fg} bold>
          Sessions · {activeSessions.length} active
        </Text>
      }
      focused
    >
      {activeSessions.length === 0 ? (
        <Box flexDirection="column" paddingY={1}>
          <Text color={tokens.color.muted.fg}>( )( )  No sessions yet</Text>
          <Text dimColor>Once Claude runs, sessions appear here.</Text>
        </Box>
      ) : (
        [...groups.entries()].map(([proj, sessions]) => (
          <Box key={proj} flexDirection="column">
            <Text color={tokens.color.accent.fg} bold>
              ▾ {proj}
            </Text>
            <Text dimColor>  {sessions.length} active</Text>
            {sessions.map((s) => (
              <Box key={s.id} flexDirection="row" marginLeft={2}>
                <Text color={tokens.color.primary.fg}>● </Text>
                <Text>{`S-${s.id.slice(0, 8)}  `}</Text>
                <Text dimColor>tok </Text>
                <Text color={tokens.color.success.fg}>{formatTokens(s.total_tokens ?? 0)}  </Text>
                <Gauge value={(s.total_tokens ?? 0) / 200_000} max={1} width={10} />
                <Text dimColor>  Turn </Text>
                <Text color={tokens.color.fg.fg}>{s.current_turn ?? '—'}</Text>
              </Box>
            ))}
            <Box marginBottom={1} />
          </Box>
        ))
      )}
    </Card>
  );
}
