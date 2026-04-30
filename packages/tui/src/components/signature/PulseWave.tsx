/**
 * PulseWave — real line chart of token throughput (asciichart).
 *
 * Always renders a chart. Idle = flat line at 0, never blinking dots.
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
  /** Total rows including header and time axis. Default 10. */
  height?: number;
  miniMode?: boolean;
};

const Y_AXIS_COLS = 8;

function inkLineColor(state: PulseState): string {
  if (state === 'spike') return tokens.color.danger.fg;
  if (state === 'active') return tokens.color.info.fg;
  return tokens.color.muted.fg;
}

function headerLabel(state: PulseState): string {
  if (state === 'spike') return '● PULSE · spike';
  if (state === 'active') return '● PULSE · active';
  return '○ PULSE · idle';
}

export function PulseWave({ buckets, state, width = 80, height = 10 }: PulseWaveProps): JSX.Element {
  const dataWidth = Math.max(16, width - Y_AXIS_COLS - 2);
  // Reserve 2 rows for header + axis, the rest for chart.
  const chartHeight = Math.max(3, Math.min(8, height - 3));

  const series = useMemo(() => {
    const slice = buckets.slice(-dataWidth);
    if (slice.length === 0) return new Array(dataWidth).fill(0) as number[];
    if (slice.length < dataWidth) {
      return [...new Array(dataWidth - slice.length).fill(0), ...slice];
    }
    return [...slice];
  }, [buckets, dataWidth]);

  const peak = Math.max(...series, 1);
  const max = peak < 10 ? 10 : niceCeil(peak);

  const chart = useMemo(
    () =>
      asciichart.plot(series, {
        height: chartHeight,
        max,
        min: 0,
        format: (x: number) => x.toFixed(0).padStart(Y_AXIS_COLS - 2, ' '),
      }),
    [series, chartHeight, max],
  );

  const right = `max ${formatNum(max)} · last 30m`;

  // Pad header to full width manually (Ink's flexbox can be flaky on row alignment).
  const left = headerLabel(state);
  const gap = Math.max(1, width - left.length - right.length);

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={inkLineColor(state)} bold>{left}</Text>
        <Text>{' '.repeat(gap)}</Text>
        <Text dimColor>{right}</Text>
      </Text>
      <Text color={inkLineColor(state)}>{chart}</Text>
      <Text dimColor>{buildTimeAxis(dataWidth)}</Text>
    </Box>
  );
}

function niceCeil(n: number): number {
  if (n <= 0) return 10;
  const exp = Math.floor(Math.log10(n));
  const base = Math.pow(10, exp);
  const m = n / base;
  const stepped = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
  return stepped * base;
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
}

function buildTimeAxis(dataWidth: number): string {
  const labels = ['-30m', '-20m', '-10m', 'now'];
  const slotW = Math.max(8, Math.floor(dataWidth / (labels.length - 1)));
  let line = '';
  for (let i = 0; i < labels.length; i++) {
    if (i === 0) {
      line += labels[i];
    } else if (i === labels.length - 1) {
      line += labels[i].padStart(dataWidth - line.length);
    } else {
      const target = i * slotW;
      line += ' '.repeat(Math.max(0, target - line.length)) + labels[i];
    }
  }
  return ' '.repeat(Y_AXIS_COLS) + line.slice(0, dataWidth);
}

export function derivePulseState(buckets: readonly number[], lastEventAt: number | null): PulseState {
  const now = Date.now();
  const idleMs = lastEventAt == null ? Number.POSITIVE_INFINITY : now - lastEventAt;
  if (idleMs > 30_000) return 'idle';
  const last = buckets[buckets.length - 1] ?? 0;
  const recentAvg = buckets.slice(-12).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(12, buckets.length));
  if (last > recentAvg * 2.4 && last > 1000) return 'spike';
  return 'active';
}
