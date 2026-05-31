/**
 * sparkline.test.tsx — Sparkline 기하/마크업 동치 검증 (P3-09)
 *
 * 전략: 원본 assets/js/sparkline.js(SVG 문자열) ↔ 신규 Sparkline.tsx(JSX) 의
 *  마크업을 정규화 비교 + 순수 기하(sparkline.ts)의 좌표 산식 골든마스터.
 *  obs-panel 카드(BurnRate/CacheHealth/LivePulse)가 이 sparkline 을 소비하므로
 *  카드 골든마스터의 기반 동치를 먼저 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SparklineBars, SparklineLine } from '../Sparkline';
import { computeSparkBars, computeSparkLine } from '../sparkline-data';
// 원본 vanilla 구현(병존) — 동치 비교 기준.
import { sparklineBars, sparklineLine } from '../../../../assets/js/sparkline.js';

/**
 * SVG 마크업 정규화 비교.
 *  - React renderToStaticMarkup 은 SVG 자식(path/line/rect)을 `<x>…</x>` 비-self-closing 으로
 *    직렬화하고, 원본 문자열은 `<x/>` self-closing 을 쓴다. 의미상 동일하므로
 *    빈 닫는 태그(`</x>`)와 self-close(`/>`)를 정규화해 동치 비교한다(공백/속성순서도 흡수).
 */
function tags(svg: string): string[] {
  return (
    svg
      // <x ...></x> → <x .../>  (빈 콘텐츠 요소 통일)
      .replace(/<(\w+)((?:\s[^>]*)?)>\s*<\/\1>/g, '<$1$2/>')
      .match(/<[^>]+>/g) ?? []
  )
    .map((t) => t.replace(/\s*\/>$/, '/>').replace(/\s+/g, ' ').trim())
    .filter((t) => !/^<\/\w+>$/.test(t));
}

describe('computeSparkBars — 순수 기하(원본 산식 골든마스터)', () => {
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

describe('Sparkline.tsx ↔ sparkline.js 마크업 동치', () => {
  it('bars: 동일 viewBox/rect/empty baseline 마크업', () => {
    const opts = { width: 76, height: 24 };
    const ours = renderToStaticMarkup(<SparklineBars values={[1, 4, 2, 8, 5]} {...opts} />);
    const orig = sparklineBars([1, 4, 2, 8, 5], opts);
    expect(tags(ours)).toEqual(tags(orig));
  });

  it('bars empty: 동일 baseline line', () => {
    const opts = { width: 76, height: 24 };
    const ours = renderToStaticMarkup(<SparklineBars values={[]} {...opts} />);
    const orig = sparklineBars([], opts);
    expect(tags(ours)).toEqual(tags(orig));
  });

  it('line: 동일 path/area 마크업', () => {
    const opts = { width: 96, height: 22 };
    const ours = renderToStaticMarkup(<SparklineLine values={[0.2, 0.5, 0.9, 0.7]} {...opts} />);
    const orig = sparklineLine([0.2, 0.5, 0.9, 0.7], opts);
    expect(tags(ours)).toEqual(tags(orig));
  });

  it('line empty: 동일 baseline line', () => {
    const ours = renderToStaticMarkup(<SparklineLine values={[null, null]} />);
    const orig = sparklineLine([null, null]);
    expect(tags(ours)).toEqual(tags(orig));
  });
});
