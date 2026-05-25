/**
 * topological-sort.test.ts — Kahn 위상 정렬 단위 테스트
 *
 * 검증 항목:
 *   1. 빈 입력 — 빈 출력.
 *   2. 단일 노드 — layer 1개, cycleDetected=false.
 *   3. 단순 chain (A→B→C) — 3 layer 분리.
 *   4. 같은 layer 안 started_at ASC tie-break.
 *   5. 동일 started_at 일 때 id ASC tie-break.
 *   6. 사이클 (A→B→A) 감지 + cycleDetected=true.
 *   7. dangling edge 안전 무시.
 *   8. fan-out (1→N) 한 layer 단일.
 */

import { describe, test, expect } from 'bun:test';
import { topologicalLayers } from '../queries/topological-sort';

describe('topologicalLayers — Kahn', () => {
  test('빈 입력 → 빈 출력', () => {
    const r = topologicalLayers({ nodes: [], edges: [] });
    expect(r.layers).toEqual([]);
    expect(r.orderedIds).toEqual([]);
    expect(r.cycleDetected).toBe(false);
  });

  test('단일 노드', () => {
    const r = topologicalLayers({
      nodes: [{ id: 'a', started_at: 100 }],
      edges: [],
    });
    expect(r.layers).toEqual([['a']]);
    expect(r.cycleDetected).toBe(false);
  });

  test('단순 chain A→B→C — 3 layer 분리', () => {
    const r = topologicalLayers({
      nodes: [
        { id: 'A', started_at: 100 },
        { id: 'B', started_at: 200 },
        { id: 'C', started_at: 300 },
      ],
      edges: [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'C' },
      ],
    });
    expect(r.layers).toEqual([['A'], ['B'], ['C']]);
    expect(r.cycleDetected).toBe(false);
  });

  test('같은 layer 안 started_at ASC tie-break', () => {
    const r = topologicalLayers({
      nodes: [
        { id: 'X', started_at: 200 },
        { id: 'Y', started_at: 100 }, // 더 이르므로 좌측.
      ],
      edges: [],
    });
    expect(r.layers).toEqual([['Y', 'X']]);
  });

  test('동일 started_at 시 id ASC tie-break (결정성 100%)', () => {
    const r = topologicalLayers({
      nodes: [
        { id: 'b', started_at: 100 },
        { id: 'a', started_at: 100 },
      ],
      edges: [],
    });
    expect(r.layers).toEqual([['a', 'b']]);
  });

  test('사이클 (A→B→A) 감지 + cycleDetected=true', () => {
    const r = topologicalLayers({
      nodes: [
        { id: 'A', started_at: 100 },
        { id: 'B', started_at: 200 },
      ],
      edges: [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'A' },
      ],
    });
    expect(r.cycleDetected).toBe(true);
    expect(r.orderedIds.length).toBe(2); // 모든 노드는 결국 포함됨.
  });

  test('dangling edge (없는 node 참조) 안전 무시', () => {
    const r = topologicalLayers({
      nodes: [{ id: 'A', started_at: 100 }],
      edges: [{ from: 'A', to: 'GHOST' }],
    });
    expect(r.layers).toEqual([['A']]);
    expect(r.cycleDetected).toBe(false);
  });

  test('fan-out (1→3) — 부모 1 layer + 자식 3 layer 안에 같이', () => {
    const r = topologicalLayers({
      nodes: [
        { id: 'P', started_at: 0 },
        { id: 'C1', started_at: 100 },
        { id: 'C2', started_at: 200 },
        { id: 'C3', started_at: 300 },
      ],
      edges: [
        { from: 'P', to: 'C1' },
        { from: 'P', to: 'C2' },
        { from: 'P', to: 'C3' },
      ],
    });
    expect(r.layers).toEqual([['P'], ['C1', 'C2', 'C3']]);
  });

  test('reconvergence (다이아몬드 DAG) — A→B,A→C,B→D,C→D', () => {
    const r = topologicalLayers({
      nodes: [
        { id: 'A', started_at: 100 },
        { id: 'B', started_at: 200 },
        { id: 'C', started_at: 250 },
        { id: 'D', started_at: 400 },
      ],
      edges: [
        { from: 'A', to: 'B' },
        { from: 'A', to: 'C' },
        { from: 'B', to: 'D' },
        { from: 'C', to: 'D' },
      ],
    });
    // A → {B, C} → D 3 layer, 같은 layer 내 시간순.
    expect(r.layers).toEqual([['A'], ['B', 'C'], ['D']]);
    expect(r.cycleDetected).toBe(false);
  });
});
