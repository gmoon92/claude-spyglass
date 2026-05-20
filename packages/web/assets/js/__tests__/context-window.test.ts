import { describe, it, expect } from 'bun:test';
import { formatContextWindowLabel, DEFAULT_CONTEXT_WINDOW } from '../context-window.js';

// context-window-unify: 추론 로직은 서버 SSoT(`getModelMaxTokens`)로 이전됨.
// 이 모듈은 표시 유틸 + 안전 폴백 상수만 노출하므로, 그 두 가지만 회귀 검증한다.

describe('formatContextWindowLabel', () => {
  it('200000 → "200K"', () => {
    expect(formatContextWindowLabel(200_000)).toBe('200K');
  });

  it('1000000 → "1M" (정수 단위)', () => {
    expect(formatContextWindowLabel(1_000_000)).toBe('1M');
  });

  it('1500000 → "1.5M" (소수 단위)', () => {
    expect(formatContextWindowLabel(1_500_000)).toBe('1.5M');
  });

  it('262144 → "262.1K" (Kimi K2.6 등 비표준 한도)', () => {
    expect(formatContextWindowLabel(262_144)).toBe('262.1K');
  });

  it('1000 미만은 그대로 숫자 문자열', () => {
    expect(formatContextWindowLabel(500)).toBe('500');
    expect(formatContextWindowLabel(0)).toBe('0');
  });
});

describe('DEFAULT_CONTEXT_WINDOW', () => {
  it('서버 응답 누락 시 안전 폴백 200K', () => {
    expect(DEFAULT_CONTEXT_WINDOW).toBe(200_000);
  });
});
