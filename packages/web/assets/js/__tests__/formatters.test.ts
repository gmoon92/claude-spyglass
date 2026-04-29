import { describe, it, expect } from 'bun:test';
import { fmt, formatDuration, fmtToken, fmtRelative, fmtTime, fmtDate, fmtTimestamp, escHtml, shortModelName } from '../formatters.js';

// ── fmt 테스트 (숫자 로케일 포맷) ─────────────────────────────────────────────

describe('fmt', () => {
  it('0 → "0"', () => {
    expect(fmt(0)).toBe('0');
  });

  it('양수 → 쉼표 포함 포맷', () => {
    expect(fmt(1000)).toContain('1');
    expect(fmt(1000000)).toContain('1');
  });

  it('음수 → 음수 기호 포함', () => {
    expect(fmt(-1000)).toContain('-');
  });

  it('null/undefined → "0"', () => {
    expect(fmt(null as any)).toBe('0');
    expect(fmt(undefined as any)).toBe('0');
  });

  it('소수 → 정수 부분만 포맷', () => {
    const result = fmt(1234.567);
    expect(result).toContain('1');
  });
});

// ── formatDuration 테스트 ──────────────────────────────────────────────────────

describe('formatDuration', () => {
  it('null/undefined → "—"', () => {
    expect(formatDuration(null as any)).toBe('—');
    expect(formatDuration(undefined as any)).toBe('—');
  });

  it('음수 → "—"', () => {
    expect(formatDuration(-1)).toBe('—');
  });

  it('0ms → "0ms"', () => {
    expect(formatDuration(0)).toBe('0ms');
  });

  it('0 < ms < 1000 → "Xms"', () => {
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('1000ms ≤ ms < 3600000 → "X.Xs"', () => {
    expect(formatDuration(1000)).toBe('1.0s');
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(60000)).toBe('60.0s');
    expect(formatDuration(3599999)).toBe('3600.0s');
  });

  it('ms ≥ 3600000 (1시간) → "—"', () => {
    expect(formatDuration(3600000)).toBe('—');
    expect(formatDuration(10000000)).toBe('—');
  });

  it('NaN → "—"', () => {
    expect(formatDuration(NaN)).toBe('—');
  });

  it('반올림: 549ms → "549ms", 550ms → "550ms"', () => {
    expect(formatDuration(549)).toBe('549ms');
    expect(formatDuration(550)).toBe('550ms');
  });
});

// ── fmtToken 테스트 ────────────────────────────────────────────────────────────

describe('fmtToken', () => {
  it('null/undefined/0 → "—"', () => {
    expect(fmtToken(null as any)).toBe('—');
    expect(fmtToken(undefined as any)).toBe('—');
    expect(fmtToken(0)).toBe('—');
  });

  it('1 ~ 999 → 그대로 반환', () => {
    expect(fmtToken(1)).toBe('1');
    expect(fmtToken(500)).toBe('500');
    expect(fmtToken(999)).toBe('999');
  });

  it('1000 ~ 999999 → "X.Xk"', () => {
    expect(fmtToken(1000)).toBe('1.0k');
    expect(fmtToken(5000)).toBe('5.0k');
    expect(fmtToken(999999)).toBe('1000.0k');
  });

  it('1000000 이상 → "X.XM"', () => {
    expect(fmtToken(1000000)).toBe('1.0M');
    expect(fmtToken(5500000)).toBe('5.5M');
    expect(fmtToken(1000000000)).toBe('1000.0M');
  });

  it('경계값: 999 vs 1000, 999999 vs 1000000', () => {
    expect(fmtToken(999)).toBe('999');
    expect(fmtToken(1000)).toBe('1.0k');
    expect(fmtToken(999999)).toBe('1000.0k');
    expect(fmtToken(1000000)).toBe('1.0M');
  });
});

// ── fmtRelative 테스트 ─────────────────────────────────────────────────────────

describe('fmtRelative', () => {
  it('null/undefined → ""', () => {
    expect(fmtRelative(null as any)).toBe('');
    expect(fmtRelative(undefined as any)).toBe('');
  });

  it('현재 시간 (0분 전) → "방금"', () => {
    const now = Date.now();
    expect(fmtRelative(now)).toBe('방금');
  });

  it('30초 전 → "방금"', () => {
    const past = Date.now() - 30 * 1000;
    expect(fmtRelative(past)).toBe('방금');
  });

  it('1분 전 → "1분 전"', () => {
    const past = Date.now() - 1 * 60 * 1000;
    expect(fmtRelative(past)).toBe('1분 전');
  });

  it('30분 전 → "30분 전"', () => {
    const past = Date.now() - 30 * 60 * 1000;
    expect(fmtRelative(past)).toBe('30분 전');
  });

  it('1시간 전 → "1시간 전"', () => {
    const past = Date.now() - 1 * 60 * 60 * 1000;
    expect(fmtRelative(past)).toBe('1시간 전');
  });

  it('24시간 전 → "1일 전"', () => {
    const past = Date.now() - 24 * 60 * 60 * 1000;
    expect(fmtRelative(past)).toBe('1일 전');
  });

  it('초 단위 타임스탐프 (< 1e12) → 자동 변환', () => {
    const secondsAgo = Math.floor(Date.now() / 1000) - 60;
    expect(fmtRelative(secondsAgo)).toBe('1분 전');
  });

  it('밀리초 단위 타임스탐프 (>= 1e12) → 그대로 사용', () => {
    const msAgo = Date.now() - 60 * 1000;
    expect(fmtRelative(msAgo)).toBe('1분 전');
  });

  it('경계값: 59분 vs 60분, 23시간 vs 24시간', () => {
    const ms59 = Date.now() - 59 * 60 * 1000;
    const ms60 = Date.now() - 60 * 60 * 1000;
    const ms23h = Date.now() - 23 * 60 * 60 * 1000;
    const ms24h = Date.now() - 24 * 60 * 60 * 1000;

    expect(fmtRelative(ms59)).toBe('59분 전');
    expect(fmtRelative(ms60)).toBe('1시간 전');
    expect(fmtRelative(ms23h)).toBe('23시간 전');
    expect(fmtRelative(ms24h)).toBe('1일 전');
  });
});

// ── fmtTime 테스트 ─────────────────────────────────────────────────────────────

describe('fmtTime', () => {
  it('null/undefined → "—"', () => {
    expect(fmtTime(null as any)).toBe('—');
    expect(fmtTime(undefined as any)).toBe('—');
  });

  it('유효한 밀리초 타임스탐프 → HH:mm:ss 포맷', () => {
    const ts = new Date('2026-04-28T14:30:45Z').getTime();
    const result = fmtTime(ts);
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('유효한 초 타임스탐프 (< 1e12) → HH:mm:ss 포맷', () => {
    const seconds = Math.floor(Date.now() / 1000);
    const result = fmtTime(seconds);
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('0 → "—"', () => {
    expect(fmtTime(0)).toBe('—');
  });
});

// ── fmtDate 테스트 ─────────────────────────────────────────────────────────────

describe('fmtDate', () => {
  it('null/undefined → "—"', () => {
    expect(fmtDate(null as any)).toBe('—');
    expect(fmtDate(undefined as any)).toBe('—');
  });

  it('오늘 날짜 → HH:mm:ss만 반환', () => {
    const ts = Date.now();
    const result = fmtDate(ts);
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
    // 월-일이 있는지 확인 (같은 날이므로 없어야 함)
    const today = new Date().toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
    expect(result).not.toContain(today);
  });

  it('어제 날짜 → 날짜 정보 포함 반환', () => {
    const yesterday = Date.now() - 24 * 60 * 60 * 1000;
    const result = fmtDate(yesterday);
    // 현재 날짜와 다른 날이므로 날짜 정보 포함
    expect(result.length).toBeGreaterThan(8);
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});

// ── fmtTimestamp 테스트 ────────────────────────────────────────────────────────

describe('fmtTimestamp', () => {
  it('null/undefined → "—"', () => {
    expect(fmtTimestamp(null as any)).toBe('—');
    expect(fmtTimestamp(undefined as any)).toBe('—');
  });

  it('현재 시간 → HH:mm · 상대시간', () => {
    const ts = Date.now();
    const result = fmtTimestamp(ts);
    expect(result).toContain('방금');
  });

  it('30분 전 → HH:mm · 30분 전', () => {
    const ts = Date.now() - 30 * 60 * 1000;
    const result = fmtTimestamp(ts);
    expect(result).toContain('30분 전');
    expect(result).toContain(':');
  });

  it('어제 시간 → MM-dd HH:mm · 상대시간', () => {
    const yesterday = Date.now() - 24 * 60 * 60 * 1000;
    const result = fmtTimestamp(yesterday);
    expect(result).toContain('일 전');
    expect(result).toContain(':');
  });

  it('오늘 시간 (fmtRelative 공백 불가) → HH:mm만 반환', () => {
    // fmtRelative가 빈 문자열을 반환하는 경우는 없지만, 로직상 그럴 수 있음
    const ts = new Date().getTime();
    const result = fmtTimestamp(ts);
    expect(result).toMatch(/\d{2}:\d{2}/);
  });
});

// ── escHtml 테스트 ─────────────────────────────────────────────────────────────

describe('escHtml', () => {
  it('"&" → "&amp;"', () => {
    expect(escHtml('&')).toBe('&amp;');
  });

  it('"<" → "&lt;"', () => {
    expect(escHtml('<')).toBe('&lt;');
  });

  it('">" → "&gt;"', () => {
    expect(escHtml('>')).toBe('&gt;');
  });

  it('"\\"" → "&quot;"', () => {
    expect(escHtml('"')).toBe('&quot;');
  });

  it('혼합: "<script>&" → "&lt;script&gt;&amp;"', () => {
    expect(escHtml('<script>&')).toBe('&lt;script&gt;&amp;');
  });

  it('순서: & 먼저 처리 (중복 방지)', () => {
    expect(escHtml('&lt;')).toBe('&amp;lt;');
  });

  it('안전한 텍스트 → 그대로', () => {
    expect(escHtml('hello world')).toBe('hello world');
  });

  it('null → "null" 문자열 반환', () => {
    expect(escHtml(null as any)).toBe('null');
  });

  it('숫자 → 문자열로 변환', () => {
    expect(escHtml(123 as any)).toBe('123');
  });
});

// ── shortModelName 테스트 ──────────────────────────────────────────────────────

describe('shortModelName', () => {
  it('모델명 반환 → 그대로 반환', () => {
    expect(shortModelName('claude-3-5-sonnet')).toBe('claude-3-5-sonnet');
  });

  it('null/undefined → null', () => {
    expect(shortModelName(null as any)).toBe(null);
    expect(shortModelName(undefined as any)).toBe(null);
  });

  it('빈 문자열 → falsy이므로 null 반환', () => {
    expect(shortModelName('')).toBe(null);
  });

  it('0 → falsy이므로 null 반환', () => {
    expect(shortModelName(0 as any)).toBe(null);
  });
});
