/**
 * BigKpi — 3-row KPI box with bold value, delta badge, and mini sparkline.
 *
 * Layout (inside a bordered box):
 *   ▔▔▔▔▔
 *    47.2     ← bold value, colored by tone
 *   ▲ +12%   ← delta indicator  [sparkline]
 *   ▁▁▁▁▁
 *
 * @see spec.md §2.2
 */

import { Box, Text } from 'ink';
import { tokens } from '../../design-tokens';
import { Sparkline } from '../charts/Sparkline';

export type BigKpiTone = 'primary' | 'success' | 'warning' | 'danger' | 'info';

export type BigKpiProps = {
  label: string;
  value: string;
  unit?: string;
  /** Signed delta string e.g. "+12%" or "-4%" */
  delta?: string;
  /** Trend direction for arrow and color. */
  deltaDir?: 'up' | 'down' | 'flat';
  /** Sparkline data (last ~12 buckets). */
  trend?: readonly number[];
  tone?: BigKpiTone;
  /** Box width in chars. */
  width?: number;
};

function toneColor(tone: BigKpiTone): string {
  switch (tone) {
    case 'primary': return tokens.color.primary.fg;
    case 'success': return tokens.color.success.fg;
    case 'warning': return tokens.color.warning.fg;
    case 'danger':  return tokens.color.danger.fg;
    case 'info':    return tokens.color.info.fg;
  }
}

export function BigKpi({
  label,
  value,
  unit,
  delta,
  deltaDir = 'flat',
  trend,
  tone = 'primary',
  width = 12,
}: BigKpiProps): JSX.Element {
  const col = toneColor(tone);
  const innerW = Math.max(8, width - 4);
  const bar = '▔'.repeat(innerW);
  const barBottom = '▁'.repeat(innerW);
  const arrow = deltaDir === 'up' ? '▲' : deltaDir === 'down' ? '▼' : '·';
  const deltaColor =
    deltaDir === 'up'
      ? tokens.color.success.fg
      : deltaDir === 'down'
      ? tokens.color.danger.fg
      : tokens.color.muted.fg;

  return (
    <Box
      borderStyle={tokens.border.subtle as never}
      borderColor={tokens.color.muted.fg}
      flexDirection="column"
      paddingX={1}
      width={width}
    >
      {/* Top bar */}
      <Text color={col} dimColor>{bar}</Text>

      {/* Label */}
      <Text color={tokens.color.muted.fg} dimColor>{label}</Text>

      {/* Value */}
      <Box flexDirection="row">
        <Text color={col} bold>{value}</Text>
        {unit && <Text color={tokens.color.muted.fg} dimColor> {unit}</Text>}
      </Box>

      {/* Delta + sparkline */}
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row">
          <Text color={deltaColor}>{arrow}</Text>
          {delta && <Text color={deltaColor}> {delta}</Text>}
        </Box>
        {trend && trend.length > 0 && (
          <Sparkline
            data={trend}
            width={Math.min(8, Math.floor(innerW / 2))}
            color={col}
          />
        )}
      </Box>

      {/* Bottom bar */}
      <Text color={col} dimColor>{barBottom}</Text>
    </Box>
  );
}
