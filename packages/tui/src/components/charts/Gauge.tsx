/**
 * Gauge — linear horizontal gauge using ▰▱.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/skills/ui-designer/references/tui/charts.md §7
 */

import { Box, Text } from 'ink';
import { tokens } from '../../design-tokens';

export type GaugeProps = {
  value: number;
  max: number;
  width?: number;
  thresholds?: { warn?: number; danger?: number };
};

export function Gauge({ value, max, width = 10, thresholds }: GaugeProps): JSX.Element {
  const clampMax = Math.max(1, max);
  const ratio = Math.max(0, Math.min(1, value / clampMax));
  const filled = Math.round(ratio * width);
  const empty = width - filled;

  const warn = thresholds?.warn ?? 0.7;
  const danger = thresholds?.danger ?? 0.9;
  const color =
    ratio >= danger
      ? tokens.color.danger.fg
      : ratio >= warn
      ? tokens.color.warning.fg
      : tokens.color.success.fg;

  return (
    <Box flexDirection="row">
      <Text color={color}>{'▰'.repeat(filled)}</Text>
      <Text color={tokens.color.muted.fg}>{'▱'.repeat(empty)}</Text>
    </Box>
  );
}
