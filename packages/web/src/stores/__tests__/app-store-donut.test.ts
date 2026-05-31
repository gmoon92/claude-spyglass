/**
 * app-store-donut.test.ts — donutMode 슬라이스 (P3-01)
 *
 * chart.js donutMode 모듈 변수(초기 'model') + setDonutMode 유효값 가드 +
 *   chart-policy.js setChartMode 매핑(default→model, detail→cache)을 스토어 액션으로 검증.
 *   기존 app-store.test.ts(14 case)는 무수정 — 본 파일은 신규 슬라이스 addition.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../app-store';

beforeEach(() => {
  useAppStore.getState().setDonutMode('model');
});

describe('donutMode 초기값/setDonutMode', () => {
  it("초기값(복원 후)은 'model'", () => {
    expect(useAppStore.getState().donutMode).toBe('model');
  });

  it("setDonutMode 유효값 적용 ('type'|'model'|'cache')", () => {
    useAppStore.getState().setDonutMode('type');
    expect(useAppStore.getState().donutMode).toBe('type');
    useAppStore.getState().setDonutMode('cache');
    expect(useAppStore.getState().donutMode).toBe('cache');
  });

  it('무효값은 무시(가드) — 직전 값 유지', () => {
    useAppStore.getState().setDonutMode('cache');
    // @ts-expect-error 런타임 가드 검증을 위한 의도적 무효값.
    useAppStore.getState().setDonutMode('nonsense');
    expect(useAppStore.getState().donutMode).toBe('cache');
  });
});

describe('setChartMode — chart-policy.js 매핑 SSoT', () => {
  it("'detail' → 'cache'", () => {
    useAppStore.getState().setChartMode('detail');
    expect(useAppStore.getState().donutMode).toBe('cache');
  });
  it("'default' → 'model'", () => {
    useAppStore.getState().setChartMode('detail');
    useAppStore.getState().setChartMode('default');
    expect(useAppStore.getState().donutMode).toBe('model');
  });
});

describe('donutMode 는 영속 비대상(휘발) — cs.dateRange 형식 미오염', () => {
  it('setDonutMode 후 localStorage cs.dateRange 에 donutMode 가 섞이지 않음', () => {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    useAppStore.getState().setDonutMode('cache');
    const raw = ls?.getItem('cs.dateRange');
    if (raw) expect(raw).not.toContain('donutMode');
  });
});
