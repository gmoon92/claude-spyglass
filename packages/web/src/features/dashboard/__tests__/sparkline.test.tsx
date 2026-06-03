/**
 * sparkline.test.tsx — Sparkline 순수 기하 골든마스터 (P3-09)
 *
 * 전략: 순수 기하(sparkline-data.ts)의 좌표 산식을 리터럴 골든마스터로 고정한다.
 *  obs-panel 카드(BurnRate/CacheHealth/LivePulse)가 이 sparkline 을 소비한다.
 *  (구 sparkline.js 와의 마크업 동치 oracle 비교는 P5 데드 vanilla 삭제로 제거됨.)
 */
import { describe, it, expect } from 'vitest';
import { computeSparkBars, computeSparkLine } from '../sparkline-data';

describe('computeSparkBars — 순수 기하(좌표 산식 골든마스터)', () => {
  it('빈 입력 → bars 0(empty baseline), baselineY = height-1', () => {
    const v = computeSparkBars([], { width: 76, height: 24 });
    expect(v.bars).toHaveLength(0);
    expect(v.baselineY).toBe(23);
  });

  it('전부 0/음수/NaN → 각 막대 height=1 클램프(원본 동작: max=Math.max(...,1) 이라 height 1)', () => {
    // 원본 sparklineBars 는 max=Math.max(...safe,1) 이므로 전부 0 이어도 막대 n 개를
    // height 1px 로 그린다(empty baseline 아님). 동치 보존을 위해 동일 동작 고정.
    const zeros = computeSparkBars([0, 0, 0], { width: 30, height: 10 });
    expect(zeros.bars).toHaveLength(3);
    expect(zeros.bars.every((b) => b.height === '1.00')).toBe(true);
    const neg = computeSparkBars([-1, -5], { width: 30, height: 10 });
    expect(neg.bars).toHaveLength(2);
    expect(neg.bars.every((b) => b.height === '1.00')).toBe(true);
    // NaN/null/undefined → 0 처리(=음수와 동일)
    expect(computeSparkBars([NaN, null, undefined]).bars).toHaveLength(3);
  });

  it('barW = max(1, (width-gap*(n-1))/n), h = max(1,(v/max)*(height-1))', () => {
    const v = computeSparkBars([1, 4, 2], { width: 76, height: 24, gap: 1 });
    expect(v.bars).toHaveLength(3);
    // n=3, barW=(76-2)/3=24.67, max=4, h2=(4/4)*23=23
    expect(v.bars[0].width).toBe('24.67');
    expect(v.bars[1].height).toBe('23.00'); // 최대값 막대 = 전체 높이-1
  });

  it('h 최소 1px 보장(아주 작은 비율도 1로 클램프)', () => {
    const v = computeSparkBars([1, 1000], { width: 96, height: 22 });
    expect(Number(v.bars[0].height)).toBeGreaterThanOrEqual(1);
  });
});

describe('computeSparkLine — 순수 기하(원본 산식 골든마스터)', () => {
  it('빈/전부 null → linePath "" + areaPath null', () => {
    expect(computeSparkLine([]).linePath).toBe('');
    expect(computeSparkLine([null, null]).linePath).toBe('');
    expect(computeSparkLine([null, null]).areaPath).toBeNull();
  });

  it('null 은 직전 valid 로 보간(직선화)', () => {
    // [10, null, 30] → 가운데는 10 유지 후 30
    const v = computeSparkLine([10, null, 30], { width: 100, height: 22 });
    const pts = v.linePath.replace('M ', '').split(' L ');
    expect(pts).toHaveLength(3);
  });

  it('fill=false 면 areaPath null', () => {
    expect(computeSparkLine([1, 2, 3], { fill: false }).areaPath).toBeNull();
    expect(computeSparkLine([1, 2, 3], { fill: true }).areaPath).not.toBeNull();
  });
});
