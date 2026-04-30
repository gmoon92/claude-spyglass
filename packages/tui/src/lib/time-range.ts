/**
 * time-range — time window presets for Tools / Anomalies screens.
 */

export type TimeRange = '1h' | '6h' | '24h' | '7d';

export const TIME_RANGES: TimeRange[] = ['1h', '6h', '24h', '7d'];

export function nextTimeRange(current: TimeRange): TimeRange {
  const idx = TIME_RANGES.indexOf(current);
  return TIME_RANGES[(idx + 1) % TIME_RANGES.length];
}

export function timeRangeMs(range: TimeRange): number {
  switch (range) {
    case '1h':  return 60 * 60 * 1000;
    case '6h':  return 6 * 60 * 60 * 1000;
    case '24h': return 24 * 60 * 60 * 1000;
    case '7d':  return 7 * 24 * 60 * 60 * 1000;
  }
}

export function timeRangeLabel(range: TimeRange): string {
  return range;
}
