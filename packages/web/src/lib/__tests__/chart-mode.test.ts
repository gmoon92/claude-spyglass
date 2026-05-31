/**
 * chart-mode.test.ts — 도넛/차트 모드 SSoT 매핑 (P3-01)
 *
 * lib/ 는 universal leaf(architecture.md §1.3) — stores/components 양쪽이 import 가능.
 *   DonutMode/ChartMode 타입과 chartModeToDonutMode 매핑(chart-policy.js setChartMode SSoT)을
 *   여기 두어, store(donutMode 슬라이스)와 Chart 컴포넌트(prop)가 동일 출처를 공유한다.
 */
import { describe, it, expect } from 'vitest';
import { chartModeToDonutMode, DONUT_MODES } from '../chart-mode';

describe('chartModeToDonutMode — chart-policy.js setChartMode 매핑', () => {
  it("'default' → 'model'", () => {
    expect(chartModeToDonutMode('default')).toBe('model');
  });
  it("'detail' → 'cache'", () => {
    expect(chartModeToDonutMode('detail')).toBe('cache');
  });
});

describe('DONUT_MODES — 유효 모드 집합(스토어 가드용)', () => {
  it("'type' | 'model' | 'cache' 3종", () => {
    expect(DONUT_MODES).toEqual(['type', 'model', 'cache']);
  });
});
