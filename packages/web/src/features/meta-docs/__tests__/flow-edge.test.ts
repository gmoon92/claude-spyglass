/**
 * flow-edge.test.ts — 엣지 path 좌표 순수 기하 (P4-03 선행 특성화)
 *
 * 원본 meta-docs-flow.js 의 computeEdgeD/chooseAnchors/anchorPoint/offsetOutward(flow.js:672-731)
 * 동치를 순수 함수로 고정한다. arch §4.2: lib/flow-edge.ts 순수 기하.
 * 회귀 게이트: 4면 앵커 선택 + 외곽 offset(마커 가림 방지, flow.js:653).
 */
import { describe, it, expect } from 'bun:test';
import {
  chooseAnchors,
  anchorPoint,
  offsetOutward,
  computeEdgeD,
  EDGE_END_OFFSET,
  type FlowBox,
} from '../flow-edge';

const A: FlowBox = { x: 0, y: 0, w: 100, h: 50 };

describe('anchorPoint — 4면 중심 좌표 (flow.js:693)', () => {
  it('left/right/top/bottom 면 중심', () => {
    expect(anchorPoint(A, 'left')).toEqual({ x: 0, y: 25 });
    expect(anchorPoint(A, 'right')).toEqual({ x: 100, y: 25 });
    expect(anchorPoint(A, 'top')).toEqual({ x: 50, y: 0 });
    expect(anchorPoint(A, 'bottom')).toEqual({ x: 50, y: 50 });
  });
});

describe('offsetOutward — 경계 밖 offset (flow.js:704)', () => {
  it('각 면 방향 바깥으로 offset 이동', () => {
    expect(offsetOutward({ x: 10, y: 10 }, 'right', 6)).toEqual({ x: 16, y: 10 });
    expect(offsetOutward({ x: 10, y: 10 }, 'top', 6)).toEqual({ x: 10, y: 4 });
  });
});

describe('chooseAnchors — |dy| > |dx|*0.8 이면 vertical (flow.js:724)', () => {
  it('수직 정렬(아래) → [bottom, top]', () => {
    const from: FlowBox = { x: 0, y: 0, w: 100, h: 50 };
    const to: FlowBox = { x: 0, y: 200, w: 100, h: 50 };
    expect(chooseAnchors(from, to)).toEqual(['bottom', 'top']);
  });
  it('수직 정렬(위) → [top, bottom]', () => {
    const from: FlowBox = { x: 0, y: 200, w: 100, h: 50 };
    const to: FlowBox = { x: 0, y: 0, w: 100, h: 50 };
    expect(chooseAnchors(from, to)).toEqual(['top', 'bottom']);
  });
  it('수평 흐름(우) → [right, left]', () => {
    const from: FlowBox = { x: 0, y: 0, w: 100, h: 50 };
    const to: FlowBox = { x: 300, y: 0, w: 100, h: 50 };
    expect(chooseAnchors(from, to)).toEqual(['right', 'left']);
  });
});

describe('computeEdgeD — 베지어 path d (flow.js:672)', () => {
  it('수평 우향 → M..C.. + 끝점 EDGE_END_OFFSET 외곽', () => {
    const from: FlowBox = { x: 0, y: 0, w: 100, h: 50 };
    const to: FlowBox = { x: 300, y: 0, w: 100, h: 50 };
    const d = computeEdgeD(from, to);
    expect(d.startsWith('M 100 25')).toBe(true);
    // to.left = 300, offsetOutward left = 300 - 6 = 294
    expect(d).toContain(`${300 - EDGE_END_OFFSET} 25`);
  });
});
