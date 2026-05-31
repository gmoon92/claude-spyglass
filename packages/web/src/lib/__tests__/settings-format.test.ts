/**
 * settings-format.test.ts — formatBytes/formatUptime/formatRelTime 순수함수 (P2-06)
 *
 * 원본: settings-view.js:1546-1568. SSoT 1:1 이식(재구현 금지) 검증 — 경계값 포함.
 */
import { describe, it, expect } from 'vitest';
import { formatBytes, formatUptime, formatRelTime } from '../settings-format';

describe('formatBytes (settings-view.js:1546)', () => {
  it('null → —', () => expect(formatBytes(null)).toBe('—'));
  it('< 1KB → B', () => expect(formatBytes(512)).toBe('512 B'));
  it('1KB 경계', () => expect(formatBytes(1024)).toBe('1.0 KB'));
  it('KB 범위', () => expect(formatBytes(1536)).toBe('1.5 KB'));
  it('MB 범위', () => expect(formatBytes(1024 * 1024 * 2)).toBe('2.0 MB'));
  it('GB 범위(소수 2자리)', () => expect(formatBytes(1024 * 1024 * 1024 * 3)).toBe('3.00 GB'));
});

describe('formatUptime (settings-view.js:1554)', () => {
  it('< 60s → Ns', () => expect(formatUptime(45)).toBe('45s'));
  it('분 범위 → Nm Ns', () => expect(formatUptime(125)).toBe('2m 5s'));
  it('시간 범위 → Nh Nm', () => expect(formatUptime(3661)).toBe('1h 1m'));
  it('59s 경계', () => expect(formatUptime(59)).toBe('59s'));
});

describe('formatRelTime (settings-view.js:1562)', () => {
  it('< 60s → Ns ago', () => {
    const now = Date.now();
    expect(formatRelTime(now - 10_000)).toBe('10s ago');
  });
  it('분 범위 → Nm ago', () => {
    const now = Date.now();
    expect(formatRelTime(now - 5 * 60_000)).toBe('5m ago');
  });
  it('시간 범위 → Nh ago', () => {
    const now = Date.now();
    expect(formatRelTime(now - 3 * 3_600_000)).toBe('3h ago');
  });
  it('일 범위 → Nd ago', () => {
    const now = Date.now();
    expect(formatRelTime(now - 2 * 86_400_000)).toBe('2d ago');
  });
});
