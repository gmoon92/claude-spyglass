/**
 * format.test.ts — 특성화 테스트 for format.ts pure functions.
 *
 * 현재 동작을 고정하는 회귀 가드.
 * 소스 변경 없이 테스트만 추가.
 */

import { describe, expect, test } from 'bun:test';
import {
  formatTokens,
  formatDuration,
  formatClock,
  formatRelative,
  sparkline,
  sparklineAscii,
  bar,
  truncate,
  sanitizeOneLine,
  compressToolName,
  shortSession,
} from '../lib/format';

// ---------------------------------------------------------------------------
// formatTokens
// ---------------------------------------------------------------------------
describe('formatTokens', () => {
  test('null/undefined → "0"', () => {
    expect(formatTokens(null)).toBe('0');
    expect(formatTokens(undefined)).toBe('0');
    expect(formatTokens(0)).toBe('0');
  });

  test('< 1000 → bare integer string', () => {
    expect(formatTokens(1)).toBe('1');
    expect(formatTokens(847)).toBe('847');
    expect(formatTokens(999)).toBe('999');
  });

  test('1000..9999 → "N.Nk"', () => {
    expect(formatTokens(1000)).toBe('1.0k');
    expect(formatTokens(1200)).toBe('1.2k');
    expect(formatTokens(9999)).toBe('10.0k');
  });

  test('10_000..999_999 → "Nk" (rounded)', () => {
    expect(formatTokens(10_000)).toBe('10k');
    expect(formatTokens(12_500)).toBe('13k');
    expect(formatTokens(999_999)).toBe('1000k');
  });

  test('≥ 1_000_000 → "N.NM"', () => {
    expect(formatTokens(1_000_000)).toBe('1.0M');
    expect(formatTokens(1_200_000)).toBe('1.2M');
  });

  test('≥ 10_000_000 → "NM" (rounded)', () => {
    expect(formatTokens(10_000_000)).toBe('10M');
    expect(formatTokens(12_500_000)).toBe('13M');
  });
});

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------
describe('formatDuration', () => {
  test('null/undefined → "-"', () => {
    expect(formatDuration(null)).toBe('-');
    expect(formatDuration(undefined)).toBe('-');
  });

  test('< 1ms → "<1ms"', () => {
    expect(formatDuration(0)).toBe('<1ms');
    expect(formatDuration(0.5)).toBe('<1ms');
  });

  test('1..999ms → "Nms"', () => {
    expect(formatDuration(1)).toBe('1ms');
    expect(formatDuration(120)).toBe('120ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  test('1000..59999ms → "N.Ns"', () => {
    expect(formatDuration(1000)).toBe('1.0s');
    expect(formatDuration(1200)).toBe('1.2s');
    expect(formatDuration(59_999)).toBe('60.0s');
  });

  test('60_000..3_599_999ms → "NmNs"', () => {
    expect(formatDuration(60_000)).toBe('1m0s');
    expect(formatDuration(90_000)).toBe('1m30s');
    expect(formatDuration(3_599_999)).toBe('59m59s');
  });

  test('≥ 3_600_000ms → "NhNm"', () => {
    expect(formatDuration(3_600_000)).toBe('1h0m');
    expect(formatDuration(4_320_000)).toBe('1h12m');
  });
});

// ---------------------------------------------------------------------------
// formatClock
// ---------------------------------------------------------------------------
describe('formatClock', () => {
  test('outputs "HH:MM:SS" with zero-padding', () => {
    // Use a fixed timestamp to avoid locale/timezone surprises.
    // 2026-05-03T14:32:08 UTC
    const ts = new Date('2026-05-03T14:32:08').getTime();
    const result = formatClock(ts);
    // We only verify the shape (HH:MM:SS) since actual hours depend on local tz.
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    // Length is always 8
    expect(result.length).toBe(8);
  });

  test('single-digit hours/minutes/seconds are zero-padded', () => {
    // Find a timestamp where local hours/minutes/seconds are 1:2:3 — hard to engineer.
    // Instead verify the formatter handles known Date values.
    const d = new Date();
    d.setHours(1, 2, 3, 0);
    const result = formatClock(d.getTime());
    const parts = result.split(':');
    expect(parts.length).toBe(3);
    expect(parts.every((p) => p.length === 2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatRelative
// ---------------------------------------------------------------------------
describe('formatRelative', () => {
  test('diff < 1s → "just now"', () => {
    const now = 1_000_000_000;
    expect(formatRelative(now - 500, now)).toBe('just now');
    expect(formatRelative(now, now)).toBe('just now');
  });

  test('1s..59s → "Ns ago"', () => {
    const now = 1_000_000_000;
    expect(formatRelative(now - 1000, now)).toBe('1s ago');
    expect(formatRelative(now - 30_000, now)).toBe('30s ago');
    expect(formatRelative(now - 59_000, now)).toBe('59s ago');
  });

  test('1m..59m → "Nm ago"', () => {
    const now = 1_000_000_000;
    expect(formatRelative(now - 60_000, now)).toBe('1m ago');
    expect(formatRelative(now - 3_599_000, now)).toBe('59m ago');
  });

  test('1h..23h → "Nh ago"', () => {
    const now = 1_000_000_000;
    expect(formatRelative(now - 3_600_000, now)).toBe('1h ago');
    expect(formatRelative(now - 23 * 3_600_000, now)).toBe('23h ago');
  });

  test('≥ 24h → "Nd ago"', () => {
    const now = 1_000_000_000;
    expect(formatRelative(now - 86_400_000, now)).toBe('1d ago');
    expect(formatRelative(now - 3 * 86_400_000, now)).toBe('3d ago');
  });

  test('future timestamp (diff < 0) → "just now"', () => {
    const now = 1_000_000_000;
    expect(formatRelative(now + 5000, now)).toBe('just now');
  });
});

// ---------------------------------------------------------------------------
// sparkline / sparklineAscii
// ---------------------------------------------------------------------------
describe('sparkline', () => {
  test('empty array → ""', () => {
    expect(sparkline([])).toBe('');
    expect(sparklineAscii([])).toBe('');
  });

  test('output length matches input length (no width limit)', () => {
    const data = [1, 2, 3, 4, 5];
    expect(sparkline(data).length).toBe(5);
    expect(sparklineAscii(data).length).toBe(5);
  });

  test('output length respects width limit', () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(sparkline(data, 4).length).toBe(4);
    expect(sparklineAscii(data, 4).length).toBe(4);
  });

  test('all-zero data → all lowest chars', () => {
    const data = [0, 0, 0];
    const result = sparkline(data);
    // All chars should be the lowest block '▁'
    expect(result.split('').every((c) => c === result[0])).toBe(true);
  });

  test('sparklineAscii output is all ASCII printable', () => {
    const data = [0, 25, 50, 75, 100];
    const result = sparklineAscii(data);
    for (const ch of result) {
      expect(ch.charCodeAt(0)).toBeGreaterThanOrEqual(0x20);
      expect(ch.charCodeAt(0)).toBeLessThanOrEqual(0x7e);
    }
  });
});

// ---------------------------------------------------------------------------
// bar
// ---------------------------------------------------------------------------
describe('bar', () => {
  test('ratio 0 → all spaces (width-1)', () => {
    const result = bar(0, 5);
    expect(result.length).toBe(5);
    // No filled blocks at 0
    expect(result.includes('█')).toBe(false);
  });

  test('ratio 1 → full blocks', () => {
    const result = bar(1, 4);
    expect(result.length).toBe(4);
    // All '█'
    expect(result).toBe('████');
  });

  test('ratio clamped to [0,1] — negative treated as 0', () => {
    const neg = bar(-0.5, 4);
    const zero = bar(0, 4);
    expect(neg).toBe(zero);
  });

  test('ratio clamped to [0,1] — over 1 treated as 1', () => {
    const over = bar(2, 4);
    const full = bar(1, 4);
    expect(over).toBe(full);
  });

  test('output length always equals width', () => {
    for (const w of [1, 4, 8, 20]) {
      expect(bar(0.5, w).length).toBe(w);
    }
  });
});

// ---------------------------------------------------------------------------
// truncate
// ---------------------------------------------------------------------------
describe('truncate', () => {
  test('string within max → returned as-is', () => {
    expect(truncate('hello', 10)).toBe('hello');
    expect(truncate('hello', 5)).toBe('hello');
  });

  test('string longer than max → truncated with "~"', () => {
    // truncate('hello world', 8): str.slice(0, 7) + '~' = 'hello w~'
    expect(truncate('hello world', 8)).toBe('hello w~');
    expect(truncate('abcdef', 4)).toBe('abc~');
  });

  test('max = 1 → single char (no tilde)', () => {
    expect(truncate('abc', 1)).toBe('a');
  });

  test('max = 0 → empty string', () => {
    expect(truncate('abc', 0)).toBe('');
  });

  test('result length <= max', () => {
    for (const max of [1, 2, 5, 10, 20]) {
      expect(truncate('a very long string that will definitely be truncated', max).length).toBeLessThanOrEqual(max);
    }
  });
});

// ---------------------------------------------------------------------------
// sanitizeOneLine
// ---------------------------------------------------------------------------
describe('sanitizeOneLine', () => {
  test('null/undefined → ""', () => {
    expect(sanitizeOneLine(null)).toBe('');
    expect(sanitizeOneLine(undefined)).toBe('');
    expect(sanitizeOneLine('')).toBe('');
  });

  test('newlines replaced with single space', () => {
    expect(sanitizeOneLine('a\nb')).toBe('a b');
    expect(sanitizeOneLine('a\r\nb')).toBe('a b');
  });

  test('tabs replaced with single space', () => {
    expect(sanitizeOneLine('a\tb')).toBe('a b');
  });

  test('consecutive whitespace collapsed to single space', () => {
    expect(sanitizeOneLine('a   b')).toBe('a b');
    expect(sanitizeOneLine('a\n\n\nb')).toBe('a b');
  });

  test('leading/trailing whitespace trimmed', () => {
    expect(sanitizeOneLine('  hello  ')).toBe('hello');
    expect(sanitizeOneLine('\nhello\n')).toBe('hello');
  });

  test('multiline SQLite command → single line', () => {
    const input = 'sqlite3 db\n"SELECT *\nFROM t"';
    const result = sanitizeOneLine(input);
    expect(result.includes('\n')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// compressToolName
// ---------------------------------------------------------------------------
describe('compressToolName', () => {
  test('null/undefined/empty → ""', () => {
    expect(compressToolName(null)).toBe('');
    expect(compressToolName(undefined)).toBe('');
    expect(compressToolName('')).toBe('');
  });

  test('non-mcp name within budget → returned as-is', () => {
    expect(compressToolName('Read', 14)).toBe('Read');
    expect(compressToolName('Edit', 14)).toBe('Edit');
    expect(compressToolName('Bash', 14)).toBe('Bash');
  });

  test('mcp name with budget >= 20 → server:action form', () => {
    const result = compressToolName('mcp__playwright__browser_click', 24);
    expect(result).toBe('playwright:browser_click');
  });

  test('mcp name with budget 12..19 → tail only', () => {
    const result = compressToolName('mcp__playwright__browser_click', 16);
    // tail = 'browser_click' (13 chars) fits in 16
    expect(result).toBe('browser_click');
  });

  test('mcp name with budget < 12 → truncated tail', () => {
    const result = compressToolName('mcp__playwright__browser_click', 8);
    expect(result.length).toBeLessThanOrEqual(8);
  });

  test('result always <= budget', () => {
    const names = [
      'Read', 'mcp__playwright__browser_click', 'NotebookEdit',
      'mcp__some__very__deeply__nested__tool_name',
    ];
    for (const name of names) {
      for (const budget of [4, 8, 14, 20, 24]) {
        const result = compressToolName(name, budget);
        expect(result.length, `${name} budget=${budget} → "${result}"`).toBeLessThanOrEqual(budget);
      }
    }
  });

  test('long non-mcp name → truncated with "~" to budget', () => {
    const result = compressToolName('SuperLongToolNameThatExceedsBudget', 14);
    expect(result.length).toBe(14);
    expect(result.endsWith('~')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shortSession
// ---------------------------------------------------------------------------
describe('shortSession', () => {
  test('null/undefined → "-"', () => {
    expect(shortSession(null)).toBe('-');
    expect(shortSession(undefined)).toBe('-');
    expect(shortSession('')).toBe('-');
  });

  test('outputs "S-<first6>"', () => {
    // shortSession slices first 6 chars of the id
    expect(shortSession('abcdef0123')).toBe('S-abcdef');
    // 'sess-xyz' → first 6 = 'sess-x' → 'S-sess-x'
    expect(shortSession('sess-xyz')).toBe('S-sess-x');
  });

  test('short id (< 6 chars) → S- plus what is available', () => {
    expect(shortSession('abc')).toBe('S-abc');
  });
});
