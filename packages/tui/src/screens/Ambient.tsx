/**
 * Ambient — fullscreen Pulse Wave companion. v1 minimal.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/skills/ui-designer/references/tui/signature-pulse.md §5
 */

import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { tokens } from '../design-tokens';
import { PulseWave, derivePulseState } from '../components/signature/PulseWave';
import { formatClock, formatTokens } from '../lib/format';
import type { StripStats } from '../types';

export type AmbientProps = {
  pulseBuckets: readonly number[];
  lastEventAt: number | null;
  stats: StripStats | null;
  width: number;
  rows: number;
};

const COLOR_CYCLE = [
  tokens.color.primary.fg,
  tokens.color.info.fg,
  tokens.color.accent.fg,
];

export function Ambient({ pulseBuckets, lastEventAt, stats, width, rows }: AmbientProps): JSX.Element {
  const [now, setNow] = useState(Date.now());
  const [colorIdx, setColorIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    const cycle = setInterval(() => setColorIdx((i) => (i + 1) % COLOR_CYCLE.length), 600_000);
    return () => {
      clearInterval(id);
      clearInterval(cycle);
    };
  }, []);

  const state = derivePulseState(pulseBuckets, lastEventAt);
  const bodyColor = COLOR_CYCLE[colorIdx]!;

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
      <Box marginBottom={2}>
        <Text color={bodyColor} bold>
          claude · spyglass
        </Text>
      </Box>
      <Box marginBottom={2}>
        <Text color={tokens.color.muted.fg}>
          {formatClock(now)} · sessions {stats?.active_sessions ?? 0} · {formatTokens(stats?.total_tokens ?? 0)} tok
        </Text>
      </Box>
      <Box width={Math.min(width - 4, 80)} marginBottom={2}>
        <PulseWave buckets={pulseBuckets} state={state} width={Math.min(width - 4, 80)} />
      </Box>
      <Box marginTop={2}>
        <Text color={tokens.color.muted.fg}>m exit ambient · q quit</Text>
      </Box>
    </Box>
  );
}
