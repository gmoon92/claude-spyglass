/**
 * PulseWave — real line chart of token throughput (asciichart).
 *
 * Always renders a chart. Idle = flat line at 0, never blinking dots.
 * X-axis: 30 minutes of 10s buckets (right-aligned to "now").
 * Y-axis: tokens per bucket, auto-scaled.
 */

import { useMemo } from 'react';
import { Box, Text } from 'ink';
import asciichart from 'asciichart';
import { tokens } from '../../design-tokens';
import type { PulseState } from '../../types';

export type PulseWaveProps = {
  buckets: readonly number[];
  state: PulseState;
  width?: number;
  /** Multi-row expanded mode = total box rows including border. Default 8. */
  height?: number;
  /** legacy — ignored. kept for backward compat. */
  miniMode?: boolean;
};

function inkLineColor(state: PulseState): string {
  if (state === 'spike') return tokens.color.danger.fg;
  if (state === 'active') return tokens.color.info.fg;
  return tokens.color.muted.fg;
}

export function PulseWave({ buckets, state, width = 80, height = 8 }: PulseWaveProps): JSX.Element {
  // Reserve cols for asciichart's Y-axis prefix (~7 cols), box border (2),
  // box padding (2), and a small safety margin (2) to avoid wrap.
  const dataWidth = Math.max(16, width - 13);
  const chartHeight = Math.max(3, height - 4);

  const series = useMemo(() => {
    const slice = buckets.slice(-dataWidth);
    if (slice.length === 0) return new Array(dataWidth).fill(0) as number[];
    if (slice.length < dataWidth) {
      return [...new Array(dataWidth - slice.length).fill(0), ...slice];
    }
    return [...slice];
  }, [buckets, dataWidth]);

  const peak = Math.max(...series, 1);
  const max = peak < 10 ? 10 : peak;

  const chart = useMemo(
    () =>
      asciichart.plot(series, {
        height: chartHeight,
        max,
        min: 0,
        format: (x: number) => x.toFixed(0).padStart(5, ' '),
        // Don't pass colors here — Ink would render the raw ANSI escapes as text.
        // We color the whole chart string via the Ink <Text> wrapper below.
      }),
    [series, chartHeight, max],
  );

  const headerLabel =
    state === 'spike' ? 'PULSE · spike' : state === 'active' ? 'PULSE · active' : 'PULSE · idle';
  const headerColor =
    state === 'spike'
      ? tokens.color.danger.fg
      : state === 'active'
      ? tokens.color.info.fg
      : tokens.color.muted.fg;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={tokens.color.muted.fg}>
      <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
        <Text color={headerColor} bold>
          {headerLabel}
        </Text>
        <Text dimColor>tokens/10s · last 30m</Text>
      </Box>
      <Text color={inkLineColor(state)}>{chart}</Text>
      <Box paddingX={1}>
        <Text dimColor>{buildTimeAxis(dataWidth)}</Text>
      </Box>
    </Box>
  );
}

/** Y-axis prefix takes ~7 cols ("  N.0 ┤"); add it to our left padding. */
function buildTimeAxis(dataWidth: number): string {
  const labels = ['-30m', '-20m', '-10m', 'now'];
  const slotW = Math.max(4, Math.floor(dataWidth / labels.length));
  let line = '';
  for (let i = 0; i < labels.length; i++) {
    if (i === labels.length - 1) {
      line += labels[i].padStart(dataWidth - line.length);
    } else {
      line += labels[i].padEnd(slotW);
    }
  }
  return ' '.repeat(7) + line.slice(0, dataWidth);
}

/** Compute pulse state from recent activity. */
export function derivePulseState(buckets: readonly number[], lastEventAt: number | null): PulseState {
  const now = Date.now();
  const idleMs = lastEventAt == null ? Number.POSITIVE_INFINITY : now - lastEventAt;
  if (idleMs > 30_000) return 'idle';
  const last = buckets[buckets.length - 1] ?? 0;
  const recentAvg = buckets.slice(-12).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(12, buckets.length));
  if (last > recentAvg * 2.4 && last > 1000) return 'spike';
  return 'active';
}
