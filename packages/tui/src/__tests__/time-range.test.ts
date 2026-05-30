/**
 * time-range.test.ts — 특성화 테스트 for time-range.ts pure functions.
 *
 * 현재 동작을 고정하는 회귀 가드.
 */

import { describe, expect, test } from 'bun:test';
import { nextTimeRange, timeRangeMs, timeRangeLabel, TIME_RANGES } from '../lib/time-range';
import type { TimeRange } from '../lib/time-range';

describe('TIME_RANGES', () => {
  test('contains exactly 4 entries in order', () => {
    expect(TIME_RANGES).toEqual(['1h', '6h', '24h', '7d']);
  });
});

describe('nextTimeRange', () => {
  test('1h → 6h', () => {
    expect(nextTimeRange('1h')).toBe('6h');
  });

  test('6h → 24h', () => {
    expect(nextTimeRange('6h')).toBe('24h');
  });

  test('24h → 7d', () => {
    expect(nextTimeRange('24h')).toBe('7d');
  });

  test('7d wraps back to 1h', () => {
    expect(nextTimeRange('7d')).toBe('1h');
  });

  test('cycling through all ranges returns to start', () => {
    let r: TimeRange = '1h';
    for (let i = 0; i < TIME_RANGES.length; i++) {
      r = nextTimeRange(r);
    }
    expect(r).toBe('1h');
  });
});

describe('timeRangeMs', () => {
  test('1h → 3_600_000', () => {
    expect(timeRangeMs('1h')).toBe(3_600_000);
  });

  test('6h → 21_600_000', () => {
    expect(timeRangeMs('6h')).toBe(21_600_000);
  });

  test('24h → 86_400_000', () => {
    expect(timeRangeMs('24h')).toBe(86_400_000);
  });

  test('7d → 604_800_000', () => {
    expect(timeRangeMs('7d')).toBe(604_800_000);
  });

  test('all values are strictly ascending', () => {
    const values = TIME_RANGES.map(timeRangeMs);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]!);
    }
  });
});

describe('timeRangeLabel', () => {
  test('returns the range string itself', () => {
    for (const r of TIME_RANGES) {
      expect(timeRangeLabel(r)).toBe(r);
    }
  });
});
