// compute-range.test.ts — rangeToParams/rangeToMetricParams 가 레거시 api.js computeRange/
//   getMetricRangeParams 와 동치임을 고정(date-filter-propagation 회귀 가드).
//   now 주입으로 TZ 의존 격리(레거시 export computeRange(activeRange, now) 동일 전략).

import { describe, it, expect } from 'vitest';
import { rangeToParams, rangeToMetricParams, buildModelUsageParams } from '../compute-range';

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

// =============================================================================
// buildModelUsageParams — 연쇄 리로드 방지의 SSoT(BrowseLayout effect 분리 근거).
//
// 핵심 불변(회귀 가드): selectedProject 는 **model-usage 도넛 fetch 에만** 영향을 준다. dashboard/
//   sessions/requests/cache 가 쓰는 range 파라미터(rangeToParams)는 project 인자를 받지 않으므로,
//   진입 auto-select 가 selectedProject 를 채워도 그 4요청의 파라미터는 불변이다(= effect deps 에서
//   selectedProject 를 빼도 안전 = 마운트 시 무거운 요청 2회 재발화 회귀가 구조적으로 불가능).
// =============================================================================
describe('buildModelUsageParams — selectedProject 스코프 격리', () => {
  it('project null → metricRange 그대로(전역, 동일 내용)', () => {
    const metricRange = { from: 100, to: 200 };
    expect(buildModelUsageParams(metricRange, null)).toEqual({ from: 100, to: 200 });
  });

  it("project 빈 문자열(falsy) → project 키 미부착(전역)", () => {
    expect(buildModelUsageParams({ range: 'all' }, '')).toEqual({ range: 'all' });
    expect(buildModelUsageParams({ range: 'all' }, '')).not.toHaveProperty('project');
  });

  it('project 지정 → metricRange 에 project 병합', () => {
    expect(buildModelUsageParams({ from: 100, to: 200 }, 'alpha')).toEqual({
      from: 100,
      to: 200,
      project: 'alpha',
    });
  });

  it("range:'all' + project → 둘 다 보존", () => {
    expect(buildModelUsageParams({ range: 'all' }, 'beta')).toEqual({ range: 'all', project: 'beta' });
  });

  it('입력 metricRange 를 변형하지 않는다(스프레드 복사 — 순수)', () => {
    const metricRange = { from: 1, to: 2 };
    const out = buildModelUsageParams(metricRange, 'gamma');
    expect(metricRange).toEqual({ from: 1, to: 2 }); // 원본 불변
    expect(out).not.toBe(metricRange); // 새 객체
  });

  it('연쇄 리로드 불변: rangeToParams(메인 4요청 파라미터)는 project 와 무관하다', () => {
    // selectedProject 가 무엇이든 메인 4요청의 range 파라미터는 동일하다 — buildModelUsageParams 만
    //   project 를 흡수하므로, 프로젝트 전환이 dashboard/sessions/requests/cache 재발화를 유발하지 않는다.
    const ar = { type: 'preset', value: '7d' } as const;
    const mainParams = rangeToParams(ar, NOW);
    const metricRange = rangeToMetricParams(ar, NOW);
    const usageA = buildModelUsageParams(metricRange, null);
    const usageB = buildModelUsageParams(metricRange, 'proj-x');
    // 메인 파라미터는 project 와 독립(불변), model-usage 만 project 로 갈린다.
    expect(mainParams).toEqual({ from: NOW - 7 * D, to: NOW });
    expect(usageA).not.toEqual(usageB);
    expect(usageB).toHaveProperty('project', 'proj-x');
  });
});
