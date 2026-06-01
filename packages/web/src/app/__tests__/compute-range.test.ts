// compute-range.test.ts — rangeToParams/rangeToMetricParams 가 레거시 api.js computeRange/
//   getMetricRangeParams 와 동치임을 고정(date-filter-propagation 회귀 가드).
//   now 주입으로 TZ 의존 격리(레거시 export computeRange(activeRange, now) 동일 전략).

import { describe, it, expect } from 'vitest';
import { rangeToParams, rangeToMetricParams } from '../compute-range';

// 고정 기준 시각 — 로컬 자정 계산이 들어가는 today/yesterday 는 now 만 고정하면 결정적.
const NOW = new Date(2026, 4, 15, 13, 30, 0, 0).getTime(); // 2026-05-15 13:30 local
const H = 60 * 60 * 1000;
const D = 24 * H;

describe('rangeToParams — 레거시 computeRange 1:1', () => {
  it('null → {} (전체, 호출자 default 폴백)', () => {
    expect(rangeToParams(null, NOW)).toEqual({});
  });

  it("preset 'all' → {}", () => {
    expect(rangeToParams({ type: 'preset', value: 'all' }, NOW)).toEqual({});
  });

  it("preset '1h' → {from: now-1h, to: now}", () => {
    expect(rangeToParams({ type: 'preset', value: '1h' }, NOW)).toEqual({ from: NOW - H, to: NOW });
  });

  it("preset '7d' → {from: now-7d, to: now}", () => {
    expect(rangeToParams({ type: 'preset', value: '7d' }, NOW)).toEqual({ from: NOW - 7 * D, to: NOW });
  });

  it("preset '30d' → {from: now-30d, to: now}", () => {
    expect(rangeToParams({ type: 'preset', value: '30d' }, NOW)).toEqual({ from: NOW - 30 * D, to: NOW });
  });

  it("preset 'today' → 로컬 자정 ~ now", () => {
    const start = new Date(NOW);
    start.setHours(0, 0, 0, 0);
    expect(rangeToParams({ type: 'preset', value: 'today' }, NOW)).toEqual({ from: start.getTime(), to: NOW });
  });

  it("preset 'yesterday' → 전일 자정 ~ 금일 자정-1ms", () => {
    const start = new Date(NOW);
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(NOW);
    end.setHours(0, 0, 0, 0);
    expect(rangeToParams({ type: 'preset', value: 'yesterday' }, NOW)).toEqual({ from: start.getTime(), to: end.getTime() - 1 });
  });

  it('custom 유한값 → {from,to} 그대로', () => {
    expect(rangeToParams({ type: 'custom', from: 1000, to: 2000 }, NOW)).toEqual({ from: 1000, to: 2000 });
  });

  it('custom NaN → {} 폴백(레거시 console.warn 분기 동치)', () => {
    expect(rangeToParams({ type: 'custom', from: NaN, to: 2000 }, NOW)).toEqual({});
  });
});

describe('rangeToMetricParams — 레거시 getMetricRangeParams 1:1', () => {
  it("'all'/null → {range:'all'} (서버 기본 24h 폴백 방지)", () => {
    expect(rangeToMetricParams(null, NOW)).toEqual({ range: 'all' });
    expect(rangeToMetricParams({ type: 'preset', value: 'all' }, NOW)).toEqual({ range: 'all' });
  });

  it("from/to 있으면 그대로(range 키 없음)", () => {
    expect(rangeToMetricParams({ type: 'preset', value: '7d' }, NOW)).toEqual({ from: NOW - 7 * D, to: NOW });
  });
});
