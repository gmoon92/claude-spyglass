import { describe, it, expect } from 'bun:test';
import {
  deriveContextWindowSize, formatContextWindowLabel,
  DEFAULT_CONTEXT_WINDOW, EXTENDED_CONTEXT_WINDOW,
} from '../context-window.js';

// ── deriveContextWindowSize ──────────────────────────────────────────────────

describe('deriveContextWindowSize', () => {
  it('model 미상이면 표준 200K로 안전 폴백', () => {
    expect(deriveContextWindowSize(null, null)).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(deriveContextWindowSize(undefined, undefined)).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(deriveContextWindowSize('', '')).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it('[1m] suffix는 최우선 — 다른 신호와 무관하게 1M', () => {
    // 기본 200K 모델이라도 suffix가 있으면 1M
    expect(deriveContextWindowSize('claude-haiku-4-5[1m]', null)).toBe(EXTENDED_CONTEXT_WINDOW);
    expect(deriveContextWindowSize('claude-sonnet-3-5[1m]', null)).toBe(EXTENDED_CONTEXT_WINDOW);
  });

  it('Opus 4.7 / Opus 4.6 / Sonnet 4.6 — GA 1M 모델군 (beta 무관)', () => {
    expect(deriveContextWindowSize('claude-opus-4-7', null)).toBe(EXTENDED_CONTEXT_WINDOW);
    expect(deriveContextWindowSize('claude-opus-4-6', null)).toBe(EXTENDED_CONTEXT_WINDOW);
    expect(deriveContextWindowSize('claude-sonnet-4-6', null)).toBe(EXTENDED_CONTEXT_WINDOW);
    // beta 헤더가 비어 있어도 GA 1M
    expect(deriveContextWindowSize('claude-opus-4-7', '')).toBe(EXTENDED_CONTEXT_WINDOW);
  });

  it('레거시 beta 헤더 context-1m-2025-08-07 → 1M', () => {
    // GA 1M에 미포함된 가상의 모델 + 레거시 beta
    expect(deriveContextWindowSize(
      'claude-some-future-4-x',
      'context-1m-2025-08-07,other-beta',
    )).toBe(EXTENDED_CONTEXT_WINDOW);
  });

  it('beta 헤더에 1M 토큰 없으면 기본 200K', () => {
    expect(deriveContextWindowSize(
      'claude-haiku-4-5',
      'interleaved-thinking-2025-05-14,context-management-2025-06-27',
    )).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it('Opus 4.7 + 실제 운영 beta 헤더 (현 세션 케이스) → 1M', () => {
    const realBeta = 'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,'
      + 'context-management-2025-06-27,prompt-caching-scope-2026-01-05';
    expect(deriveContextWindowSize('claude-opus-4-7', realBeta)).toBe(EXTENDED_CONTEXT_WINDOW);
  });
});

// ── formatContextWindowLabel ─────────────────────────────────────────────────

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

  it('1000 미만은 그대로 숫자 문자열', () => {
    expect(formatContextWindowLabel(500)).toBe('500');
    expect(formatContextWindowLabel(0)).toBe('0');
  });
});
