/**
 * BarChart — sorted horizontal bars with eighth-resolution.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/skills/ui-designer/references/tui/charts.md §3
 */

import { Box, Text } from 'ink';
import { tokens } from '../../design-tokens';
import { bar } from '../../lib/format';

export type BarSeries = {
  label: string;
  value: number;
  color?: string;
  prefix?: string;
};

export type BarChartProps = {
  series: BarSeries[];
  width?: number;
  labelWidth?: number;
  max?: number;
};

export function BarChart({ series, width = 32, labelWidth = 12, max }: BarChartProps): JSX.Element {
  const peak = max ?? Math.max(...series.map((s) => s.value), 1);
  return (
    <Box flexDirection="column">
      {series.map((s, i) => {
        const ratio = s.value / peak;
        const label = (s.label ?? '').padEnd(labelWidth, ' ').slice(0, labelWidth);
        return (
          <Box key={i} flexDirection="row">
            {s.prefix && <Text color={s.color ?? tokens.color.primary.fg}>{s.prefix} </Text>}
            <Text color={tokens.color.fg.fg}>{label}</Text>
            <Text color={s.color ?? tokens.color.primary.fg}>{bar(ratio, width)}</Text>
            <Text color={tokens.color.muted.fg}> {Math.round(s.value)}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
