/**
 * Unit tests — pctToStrength
 *
 * ADR meta-docs-flow-strength 002의 임계값(50/20/5) 정확성 검증.
 * 경계값(<=, <, >=) 처리가 ADR 정의와 일치하는지 확인.
 */

import { describe, test, expect } from 'bun:test';
import { pctToStrength } from '../meta-docs';

describe('pctToStrength — ADR-002 4단 임계값', () => {
  test('strong: pct >= 50', () => {
    expect(pctToStrength(50)).toBe('strong');
    expect(pctToStrength(75.5)).toBe('strong');
    expect(pctToStrength(100)).toBe('strong');
  });

  test('medium: 20 <= pct < 50', () => {
    expect(pctToStrength(20)).toBe('medium');
    expect(pctToStrength(35)).toBe('medium');
    expect(pctToStrength(49.9)).toBe('medium');
  });

  test('weak: 5 <= pct < 20', () => {
    expect(pctToStrength(5)).toBe('weak');
    expect(pctToStrength(12.3)).toBe('weak');
    expect(pctToStrength(19.9)).toBe('weak');
  });

  test('sparse: pct < 5 — 공출현 흡수 영역', () => {
    expect(pctToStrength(0)).toBe('sparse');
    expect(pctToStrength(0.1)).toBe('sparse');
    expect(pctToStrength(4.9)).toBe('sparse');
  });

  test('경계 직전/직후 — 50/20/5 분기점', () => {
    // 50% 직전은 medium, 50% 정확은 strong
    expect(pctToStrength(49.99)).toBe('medium');
    expect(pctToStrength(50.0)).toBe('strong');

    // 20% 직전은 weak, 20% 정확은 medium
    expect(pctToStrength(19.99)).toBe('weak');
    expect(pctToStrength(20.0)).toBe('medium');

    // 5% 직전은 sparse, 5% 정확은 weak
    expect(pctToStrength(4.99)).toBe('sparse');
    expect(pctToStrength(5.0)).toBe('weak');
  });
});
