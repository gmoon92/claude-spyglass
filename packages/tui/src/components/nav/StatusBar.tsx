/**
 * StatusBar — single bottom row with contextual key hints + SSE status.
 */

import { Box, Text } from 'ink';
import { tokens } from '../../design-tokens';

export type Hint = { key: string; label: string };

export type StatusBarProps = {
  hints: Hint[];
  sseStatus: string;
  eventsPerSec?: number;
  frozen?: boolean;
};

export function StatusBar({ hints, sseStatus, eventsPerSec = 0, frozen = false }: StatusBarProps): JSX.Element {
  return (
    <Box flexDirection="row" justifyContent="space-between">
      <Box flexDirection="row">
        {hints.map((h, i) => (
          <Box key={i} marginRight={2}>
            <Text color={tokens.color.primary.fg}>[{h.key}]</Text>
            <Text color={tokens.color.muted.fg}> {h.label}</Text>
          </Box>
        ))}
      </Box>
      <Box flexDirection="row">
        {frozen && <Text color={tokens.color.warning.fg} bold>[FROZEN] </Text>}
        <Text color={tokens.color.muted.fg}>sse: </Text>
        <Text
          color={
            sseStatus === 'open'
              ? tokens.color.success.fg
              : sseStatus === 'reconnecting' || sseStatus === 'connecting'
              ? tokens.color.warning.fg
              : tokens.color.danger.fg
          }
        >
          {sseStatus}
        </Text>
        <Text color={tokens.color.muted.fg}> · {eventsPerSec} ev/s</Text>
      </Box>
    </Box>
  );
}
