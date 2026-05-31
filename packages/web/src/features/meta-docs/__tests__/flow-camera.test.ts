/**
 * flow-camera.test.ts — viewBox fit/easing 순수 계산 (P4-03 선행 특성화)
 *
 * 원본 meta-docs-flow-camera.js 의 computeFitView/easeInOutCubic(camera.js:55,155) 동치.
 * arch §4.2: lib/flow-camera.ts (rAF/이징/fit 계산, 외부 의존 0). animateToView 의 rAF 트윈은
 * 컴포넌트 effect 가 호출 — 본 테스트는 순수 계산부(fit/이징/즉시적용)만 고정.
 * 회귀 게이트: fit scale 클램프(camera.js:171), getBoundingClientRect 모킹.
 */
import { describe, it, expect } from 'bun:test';
import {
  easeInOutCubic,
  computeFitView,
  viewBoxStr,
  applyImmediate,
  type ViewState,
} from '../flow-camera';

// getBoundingClientRect 만 제공하는 최소 SVG 스텁.
function svgStub(w: number, h: number): SVGSVGElement {
  return {
    getBoundingClientRect: () => ({ width: w, height: h, x: 0, y: 0, top: 0, left: 0, right: w, bottom: h, toJSON() {} }),
    setAttribute: () => {},
  } as unknown as SVGSVGElement;
}

describe('easeInOutCubic — 0..1 경계 + 중점 (camera.js:55)', () => {
  it('0 → 0, 1 → 1, 0.5 → 0.5', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 5);
  });
});

describe('computeFitView — bbox + 컨테이너 → viewBox (camera.js:155)', () => {
  it('측정 불가(컨테이너 0) → null 폴백', () => {
    const v = computeFitView(svgStub(0, 0), { x: 0, y: 0, width: 100, height: 100 });
    expect(v).toBeNull();
  });
  it('빈 bbox(width 0) → null', () => {
    const v = computeFitView(svgStub(800, 600), { x: 0, y: 0, width: 0, height: 100 });
    expect(v).toBeNull();
  });
  it('정상 fit — 중심이 bbox 중심', () => {
    const v = computeFitView(svgStub(800, 600), { x: 0, y: 0, width: 400, height: 300 });
    expect(v).not.toBeNull();
    const cx = v!.x + v!.w / 2;
    const cy = v!.y + v!.h / 2;
    expect(cx).toBeCloseTo(200, 5);
    expect(cy).toBeCloseTo(150, 5);
  });
  it('scale 상한 클램프(maxScale 1.2) — 매우 작은 콘텐츠', () => {
    // 작은 bbox 라 scale 이 1.2 초과 시도 → 클램프. vbW = cW / 1.2.
    const v = computeFitView(svgStub(800, 600), { x: 0, y: 0, width: 1, height: 1 });
    expect(v!.w).toBeCloseTo(800 / 1.2, 3);
  });
});

describe('viewBoxStr / applyImmediate (camera.js:236)', () => {
  it('viewBoxStr — "x y w h"', () => {
    expect(viewBoxStr({ x: 1, y: 2, w: 3, h: 4 })).toBe('1 2 3 4');
  });
  it('applyImmediate — viewState in-place 갱신', () => {
    const vs: ViewState = { x: 0, y: 0, w: 100, h: 100 };
    applyImmediate(svgStub(800, 600), vs, { x: 10, y: 20, w: 30, h: 40 });
    expect(vs).toEqual({ x: 10, y: 20, w: 30, h: 40 });
  });
});
