/**
 * gradient.test.ts — 특성화 테스트 for gradient.ts pure functions.
 *
 * pickGradientColor / buildGradientLut 의 현재 동작을 고정하는 회귀 가드.
 */

import { describe, expect, test } from 'bun:test';
import { pickGradientColor, buildGradientLut } from '../lib/gradient';

// ---------------------------------------------------------------------------
// pickGradientColor
// ---------------------------------------------------------------------------
describe('pickGradientColor', () => {
  test('empty stops → "#ffffff"', () => {
    expect(pickGradientColor([], 0.5)).toBe('#ffffff');
  });

  test('single stop → that color', () => {
    expect(pickGradientColor(['#ff0000'], 0)).toBe('#ff0000');
    expect(pickGradientColor(['#ff0000'], 1)).toBe('#ff0000');
  });

  test('t=0 → first stop', () => {
    expect(pickGradientColor(['#ff0000', '#0000ff'], 0)).toBe('#ff0000');
  });

  test('t=1 → last stop', () => {
    expect(pickGradientColor(['#ff0000', '#0000ff'], 1)).toBe('#0000ff');
  });

  test('t=0.5 with two stops → midpoint color', () => {
    // Midpoint of #000000 and #ffffff should be #7f7f7f or #808080 (rounding)
    const result = pickGradientColor(['#000000', '#ffffff'], 0.5);
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
    // r, g, b should all be around 127-128
    const r = parseInt(result.slice(1, 3), 16);
    expect(r).toBeGreaterThanOrEqual(127);
    expect(r).toBeLessThanOrEqual(128);
  });

  test('t clamped — t < 0 → same as t=0', () => {
    const c0 = pickGradientColor(['#ff0000', '#0000ff'], 0);
    const cNeg = pickGradientColor(['#ff0000', '#0000ff'], -1);
    expect(cNeg).toBe(c0);
  });

  test('t clamped — t > 1 → same as t=1', () => {
    const c1 = pickGradientColor(['#ff0000', '#0000ff'], 1);
    const cOver = pickGradientColor(['#ff0000', '#0000ff'], 2);
    expect(cOver).toBe(c1);
  });

  test('result always matches "#rrggbb" format', () => {
    const stops = ['#9ece6a', '#e0af68', '#f7768e'];
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(pickGradientColor(stops, t)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test('3-stop gradient — t=0.5 is midpoint between stop[0] and stop[1]', () => {
    // With 3 stops, segment 0 is t=[0,0.5], segment 1 is t=[0.5,1]
    const stops = ['#000000', '#ff0000', '#0000ff'];
    const mid = pickGradientColor(stops, 0.5);
    // At t=0.5, should be exactly stop[1] = #ff0000
    expect(mid).toBe('#ff0000');
  });
});

// ---------------------------------------------------------------------------
// buildGradientLut
// ---------------------------------------------------------------------------
describe('buildGradientLut', () => {
  test('returns array of exactly `size` entries', () => {
    const lut = buildGradientLut(['#000000', '#ffffff'], 10);
    expect(lut.length).toBe(10);
  });

  test('first entry matches t=0, last entry matches t=1', () => {
    const stops = ['#ff0000', '#0000ff'];
    const lut = buildGradientLut(stops, 5);
    expect(lut[0]).toBe(pickGradientColor(stops, 0));
    expect(lut[4]).toBe(pickGradientColor(stops, 1));
  });

  test('all entries are valid "#rrggbb" strings', () => {
    const lut = buildGradientLut(['#9ece6a', '#e0af68', '#f7768e'], 7);
    for (const color of lut) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test('size=1 edge case — array of length 1 (NaN t clamps to first stop)', () => {
    // size=1: i / (size-1) = 0/0 = NaN. pickGradientColor with NaN t:
    // clamped = Math.max(0, Math.min(1, NaN)) = NaN → segIdx = Math.min(Math.floor(NaN*segments), segments-1) = NaN
    // In practice this triggers parseHex on an undefined stop and throws.
    // BUG: buildGradientLut(stops, 1) throws due to NaN index — document current behavior.
    expect(() => buildGradientLut(['#ff0000', '#0000ff'], 1)).toThrow();
  });
});
