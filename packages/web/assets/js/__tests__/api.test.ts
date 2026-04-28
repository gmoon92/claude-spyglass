import { describe, it, expect } from 'bun:test';
import { setActiveRange, getDateRange, buildQuery } from '../api.js';

// ── getDateRange 테스트 ────────────────────────────────────────────────────────

describe('getDateRange', () => {
  it('activeRange = "today" → 오늘 00:00:00부터 현재까지', () => {
    setActiveRange('today');
    const range = getDateRange();

    expect(range).toHaveProperty('from');
    expect(range).toHaveProperty('to');

    const from = new Date(range.from);
    const today = new Date();

    expect(from.getFullYear()).toBe(today.getFullYear());
    expect(from.getMonth()).toBe(today.getMonth());
    expect(from.getDate()).toBe(today.getDate());
    expect(from.getHours()).toBe(0);
    expect(from.getMinutes()).toBe(0);
    expect(from.getSeconds()).toBe(0);
    expect(range.to).toBeGreaterThanOrEqual(range.from);
  });

  it('activeRange = "week" → 7일 전 00:00:00부터 현재까지', () => {
    setActiveRange('week');
    const range = getDateRange();

    expect(range).toHaveProperty('from');
    expect(range).toHaveProperty('to');

    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;

    // 7일 전부터 현재까지 (오차 범위: ±1일)
    expect(now - range.from).toBeGreaterThanOrEqual(weekMs - 86400000);
    expect(now - range.from).toBeLessThanOrEqual(weekMs + 86400000);
    expect(range.to).toBeGreaterThanOrEqual(range.from);
  });

  it('activeRange = 기본값("all") → 빈 객체 반환', () => {
    setActiveRange('all');
    const range = getDateRange();
    expect(Object.keys(range).length).toBe(0);
  });

  it('activeRange = 미지원 범위("month") → 빈 객체 반환', () => {
    setActiveRange('month' as any);
    const range = getDateRange();
    expect(Object.keys(range).length).toBe(0);
  });
});

// ── buildQuery 테스트 ──────────────────────────────────────────────────────────

describe('buildQuery', () => {
  it('base URL만 지정 (activeRange 기본) → 쿼리 없이 반환', () => {
    setActiveRange('all');
    const result = buildQuery('/api/test');
    expect(result).toBe('/api/test');
  });

  it('base + extra 파라미터 (dateRange 없음) → URL에 쿼리 추가', () => {
    setActiveRange('all');
    const result = buildQuery('/api/test', { limit: '100', offset: '0' });
    expect(result).toContain('/api/test?');
    expect(result).toContain('limit=100');
    expect(result).toContain('offset=0');
  });

  it('activeRange "today" + extra → from, to, extra 파라미터 포함', () => {
    setActiveRange('today');
    const result = buildQuery('/api/requests', { limit: '50' });

    expect(result).toContain('/api/requests?');
    expect(result).toContain('from=');
    expect(result).toContain('to=');
    expect(result).toContain('limit=50');
  });

  it('activeRange "week" + extra → 긴 시간 범위 포함', () => {
    setActiveRange('week');
    const result = buildQuery('/api/sessions', { project: 'test' });

    expect(result).toContain('/api/sessions?');
    expect(result).toContain('from=');
    expect(result).toContain('to=');
    expect(result).toContain('project=test');
  });

  it('특수 문자 in extra → URL 인코딩 처리', () => {
    setActiveRange('all');
    const result = buildQuery('/api/search', { q: 'hello world&key' });
    expect(result).toContain('%26');
  });

  it('dateRange 오버라이드 → extra의 from/to 사용', () => {
    setActiveRange('today');
    const result = buildQuery('/api/test', { from: '999999', to: '888888' });
    expect(result).toContain('from=999999');
    expect(result).toContain('to=888888');
  });
});
