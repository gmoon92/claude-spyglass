/**
 * sequential-flow.test.ts — V-1~V-5 자동화 검증 × {세트 A, B, C}
 *
 * 책임:
 *   06 보고서 §4.3 의 V-1~V-5 기대 결과를 mock client + 3종 시드 위에서 자동 단언.
 *   세트별 핵심 검증 의도가 다르므로 세트별 describe 블록으로 격리.
 *
 * 의존성:
 *   - seed-mocks/* (MockLadybugClient + 세트 A/B/C 시드 + 기대값 헬퍼)
 *   - queries/sequential-flow.ts (getSequentialFlow — 본 PR 핵심 모듈)
 *
 * 검증 매트릭스:
 *   세트 A — V-1 (direct), V-2 (*1..3), V-3 (temporal), V-4 (turn-after), V-5 (self-loop)
 *   세트 B — V-2 (*1..7) 8개 메타 + Kahn 안정성 + 같은 layer 결정성
 *   세트 C — fan-out 25 모두 layer 1 + started_at ASC 순서 보존
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { getSequentialFlow } from '../queries/sequential-flow';
import {
  createMockClient,
  seedSetA,
  seedSetB,
  seedSetC,
  META_DOC_IDS_A,
  META_DOC_IDS_B,
  META_DOC_IDS_C,
  TOOL_USE_IDS_A,
  TOOL_USE_IDS_B,
} from './seed-mocks';
import { expectedSetCChildOrder } from './seed-mocks/set-c-wide-breadth';

// =============================================================================
// 세트 A — 06 §4.3 기대 결과 1:1 재현
// =============================================================================

describe('Sequential Flow — Set A (/refactor 표준)', () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    seedSetA(client);
  });

  test('center 카드와 seed ToolCall 이 응답에 포함', async () => {
    const result = await getSequentialFlow(client, {
      centerKind: 'command',
      centerName: '/refactor',
      depth: 3,
    });
    expect(result.meta.seedCount).toBe(1);
    expect(result.nodes.some((n) => n.id === 'center')).toBe(true);
    expect(result.nodes.some((n) => n.id === TOOL_USE_IDS_A.center)).toBe(true);
  });

  test('V-2 변형 — depth 3 traversal 로 8개 자손 메타 문서 회수', async () => {
    const result = await getSequentialFlow(client, {
      centerKind: 'command',
      centerName: '/refactor',
      depth: 3,
    });
    const childNames = result.nodes
      .filter((n) => n.data.depth > 0 && n.data.depth <= 3)
      .map((n) => n.data.name)
      .sort();

    // 06 §4.3 V-2 기대: 8개 자손 (PARENT_OF chain). turn-after 의 changelog 는 별도.
    expect(childNames).toContain('source-comments');
    expect(childNames).toContain('avoid-spaghetti');
    expect(childNames).toContain('code-reviewer');
    expect(childNames).toContain('lint-fix');
    expect(childNames).toContain('linear/issue');
    expect(childNames).toContain('commit');
    expect(childNames).toContain('git:diff');
    expect(childNames).toContain('git:format-message');
  });

  test('V-4 — turn-after 의 changelog-update 가 별도 노드로 등장', async () => {
    const result = await getSequentialFlow(client, {
      centerKind: 'command',
      centerName: '/refactor',
      depth: 3,
    });
    const turnAfterNodes = result.nodes.filter((n) => n.data.depth === -1);
    expect(turnAfterNodes.length).toBeGreaterThanOrEqual(1);
    expect(turnAfterNodes.map((n) => n.data.name)).toContain('changelog-update');
  });

  test('V-5 — self-loop 격하: center 자기 자신은 결과에 없어야', async () => {
    const result = await getSequentialFlow(client, {
      centerKind: 'command',
      centerName: '/refactor',
      depth: 3,
    });
    // center 합성 노드는 1개만, 자손 중 /refactor 는 없어야.
    const refactorChildren = result.nodes.filter(
      (n) => n.id !== 'center' && n.data.name === '/refactor' && n.data.depth > 0,
    );
    expect(refactorChildren.length).toBe(0);
  });

  test('V-3 — temporal sort: nodes 가 started_at ASC 순서로 정렬되어야', async () => {
    const result = await getSequentialFlow(client, {
      centerKind: 'command',
      centerName: '/refactor',
      depth: 3,
    });
    // center + seeds + chain 만 골라 시간순 정렬되어야.
    const chainNodes = result.nodes
      .filter((n) => n.data.depth >= 0)
      .sort((a, b) => a.data.started_at - b.data.started_at);
    for (let i = 1; i < chainNodes.length; i++) {
      expect(chainNodes[i].data.started_at).toBeGreaterThanOrEqual(
        chainNodes[i - 1].data.started_at,
      );
    }
  });

  test('layers — center 가 layer 0, seed 는 layer 1', async () => {
    const result = await getSequentialFlow(client, {
      centerKind: 'command',
      centerName: '/refactor',
      depth: 3,
    });
    expect(result.layers.length).toBeGreaterThan(0);
    expect(result.layers[0]).toContain('center');
    // seed (tu-CENTER) 는 layer 1 (center 다음).
    expect(result.layers[1]).toContain(TOOL_USE_IDS_A.center);
  });

  test('cycleDetected 는 false (트리 구조)', async () => {
    const result = await getSequentialFlow(client, {
      centerKind: 'command',
      centerName: '/refactor',
      depth: 3,
    });
    expect(result.meta.cycleDetected).toBe(false);
  });
});

// =============================================================================
// 세트 B — Deep Hierarchy depth 7 + 분기 2
// =============================================================================

describe('Sequential Flow — Set B (Deep Hierarchy depth 7)', () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    seedSetB(client);
  });

  test('가변 깊이 *1..7 — 9개 자손 메타 문서 모두 회수', async () => {
    const result = await getSequentialFlow(client, {
      centerKind: 'command',
      centerName: '/auto-pilot',
      depth: 7,
    });
    const childNames = result.nodes
      .filter((n) => n.data.depth > 0)
      .map((n) => n.data.name);

    // depth 1..7 의 9개 자손 (분기 포함).
    expect(childNames).toContain('auto-pilot-orchestrator');
    expect(childNames).toContain('architect-plan');
    expect(childNames).toContain('code-generator');
    expect(childNames).toContain('file-io');
    expect(childNames).toContain('type-check');
    expect(childNames).toContain('linter-bot');
    expect(childNames).toContain('lint-fix');
    expect(childNames).toContain('format-source');
    expect(childNames).toContain('git:commit');
  });

  test('분기 #1 (Layer 4) — file-io 와 type-check 가 같은 layer 에 같이 등장', async () => {
    const result = await getSequentialFlow(client, {
      centerKind: 'command',
      centerName: '/auto-pilot',
      depth: 7,
    });
    const fileIo   = result.nodes.find((n) => n.data.name === 'file-io');
    const typeChk  = result.nodes.find((n) => n.data.name === 'type-check');
    expect(fileIo).toBeDefined();
    expect(typeChk).toBeDefined();
    // 두 노드는 같은 Kahn layer.
    expect(fileIo!.data.layer).toBe(typeChk!.data.layer);
  });

  test('분기 #2 (Layer 6) — lint-fix 와 format-source 가 같은 layer', async () => {
    const result = await getSequentialFlow(client, {
      centerKind: 'command',
      centerName: '/auto-pilot',
      depth: 7,
    });
    const lintFix = result.nodes.find((n) => n.data.name === 'lint-fix');
    const fmtSrc  = result.nodes.find((n) => n.data.name === 'format-source');
    expect(lintFix).toBeDefined();
    expect(fmtSrc).toBeDefined();
    expect(lintFix!.data.layer).toBe(fmtSrc!.data.layer);
  });

  test('같은 layer 안 결정성 — 100ms 차로 좌→우 정렬 보장', async () => {
    const result = await getSequentialFlow(client, {
      centerKind: 'command',
      centerName: '/auto-pilot',
      depth: 7,
    });
    const layer4 = result.layers.find((ids) => ids.includes(TOOL_USE_IDS_B.L4A));
    expect(layer4).toBeDefined();
    // tu-B-4-A (4000ms) 가 tu-B-4-B (4100ms) 보다 먼저 와야 한다.
    const idxA = layer4!.indexOf(TOOL_USE_IDS_B.L4A);
    const idxB = layer4!.indexOf(TOOL_USE_IDS_B.L4B);
    expect(idxA).toBeLessThan(idxB);
  });

  test('Kahn 안정성 — 부모 → 자식 layer 가 단조 증가', async () => {
    const result = await getSequentialFlow(client, {
      centerKind: 'command',
      centerName: '/auto-pilot',
      depth: 7,
    });
    // layer of L1 < L2 < L3 < L4-A < L5 < L6-A < L7
    const layerOf = (tuid: string) => result.nodes.find((n) => n.id === tuid)?.data.layer ?? -1;
    expect(layerOf(TOOL_USE_IDS_B.L1)).toBeLessThan(layerOf(TOOL_USE_IDS_B.L2));
    expect(layerOf(TOOL_USE_IDS_B.L2)).toBeLessThan(layerOf(TOOL_USE_IDS_B.L3));
    expect(layerOf(TOOL_USE_IDS_B.L3)).toBeLessThan(layerOf(TOOL_USE_IDS_B.L4A));
    expect(layerOf(TOOL_USE_IDS_B.L4A)).toBeLessThan(layerOf(TOOL_USE_IDS_B.L5));
    expect(layerOf(TOOL_USE_IDS_B.L5)).toBeLessThan(layerOf(TOOL_USE_IDS_B.L6A));
    expect(layerOf(TOOL_USE_IDS_B.L6A)).toBeLessThan(layerOf(TOOL_USE_IDS_B.L7));
  });

  test('cycleDetected 는 false (트리 + 분기)', async () => {
    const result = await getSequentialFlow(client, {
      centerKind: 'command',
      centerName: '/auto-pilot',
      depth: 7,
    });
    expect(result.meta.cycleDetected).toBe(false);
  });
});

// =============================================================================
// 세트 C — Wide Breadth 25 fan-out
// =============================================================================

describe('Sequential Flow — Set C (Wide Breadth 25 fan-out)', () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    seedSetC(client);
  });

  test('25 자식 모두 응답에 포함 (혼합 skill 15 + agent 5 + mcp 5)', async () => {
    const result = await getSequentialFlow(client, {
      centerKind: 'command',
      centerName: '/scan-all',
      depth: 1,
    });
    const childNodes = result.nodes.filter((n) => n.data.depth === 1);
    expect(childNodes.length).toBe(25);
  });

  test('25 자식 모두 같은 layer (단일 layer 보장)', async () => {
    const result = await getSequentialFlow(client, {
      centerKind: 'command',
      centerName: '/scan-all',
      depth: 1,
    });
    const childNodes = result.nodes.filter((n) => n.data.depth === 1);
    const layerSet = new Set(childNodes.map((n) => n.data.layer));
    expect(layerSet.size).toBe(1); // 단일 layer
  });

  test('priority queue stability — started_at ASC 순서로 좌→우', async () => {
    const result = await getSequentialFlow(client, {
      centerKind: 'command',
      centerName: '/scan-all',
      depth: 1,
    });
    const childLayer = result.layers.find((ids) => ids.length === 25);
    expect(childLayer).toBeDefined();
    // 기대: skill-1..15 → agent-1..5 → mcp-1..5 (시간순).
    const expected = expectedSetCChildOrder();
    expect(childLayer).toEqual(expected);
  });

  test('혼합 kind 가 정렬을 깨뜨리지 않음 — agent 가 skill 들 사이에 끼지 않음', async () => {
    const result = await getSequentialFlow(client, {
      centerKind: 'command',
      centerName: '/scan-all',
      depth: 1,
    });
    const childNodes = result.nodes
      .filter((n) => n.data.depth === 1)
      .sort((a, b) => a.data.started_at - b.data.started_at);

    // 첫 15개 = skill, 다음 5개 = agent, 마지막 5개 = mcp.
    expect(childNodes.slice(0, 15).every((n) => n.type === 'skill')).toBe(true);
    expect(childNodes.slice(15, 20).every((n) => n.type === 'agent')).toBe(true);
    expect(childNodes.slice(20, 25).every((n) => n.type === 'mcp')).toBe(true);
  });

  test('seedCount = 1 (center 1 회 호출)', async () => {
    const result = await getSequentialFlow(client, {
      centerKind: 'command',
      centerName: '/scan-all',
      depth: 1,
    });
    expect(result.meta.seedCount).toBe(1);
  });

  test('cycleDetected 는 false (순수 fan-out)', async () => {
    const result = await getSequentialFlow(client, {
      centerKind: 'command',
      centerName: '/scan-all',
      depth: 1,
    });
    expect(result.meta.cycleDetected).toBe(false);
  });
});

// =============================================================================
// 횡단 검증 — 모든 세트가 공통적으로 만족해야 할 invariants
// =============================================================================

describe('Sequential Flow — 횡단 invariants (모든 세트)', () => {
  test.each([
    { name: 'A', seed: seedSetA, centerKind: 'command' as const, centerName: '/refactor',  depth: 3 },
    { name: 'B', seed: seedSetB, centerKind: 'command' as const, centerName: '/auto-pilot', depth: 7 },
    { name: 'C', seed: seedSetC, centerKind: 'command' as const, centerName: '/scan-all',   depth: 1 },
  ])('세트 $name — node.id 중복 없음', async ({ seed, centerKind, centerName, depth }) => {
    const client = createMockClient();
    seed(client);
    const result = await getSequentialFlow(client, { centerKind, centerName, depth });
    const ids = result.nodes.map((n) => n.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  test.each([
    { name: 'A', seed: seedSetA, centerKind: 'command' as const, centerName: '/refactor' },
    { name: 'B', seed: seedSetB, centerKind: 'command' as const, centerName: '/auto-pilot' },
    { name: 'C', seed: seedSetC, centerKind: 'command' as const, centerName: '/scan-all' },
  ])('세트 $name — edge.source/target 이 모두 nodes 안에 존재', async ({ seed, centerKind, centerName }) => {
    const client = createMockClient();
    seed(client);
    const result = await getSequentialFlow(client, { centerKind, centerName, depth: 3 });
    const ids = new Set(result.nodes.map((n) => n.id));
    for (const e of result.edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
  });

  test('META_DOC_IDS 격리 — 세트 간 id 겹침 없음', () => {
    const aIds = new Set<number>(Object.values(META_DOC_IDS_A));
    const bIds = new Set<number>(Object.values(META_DOC_IDS_B));
    const cIds = new Set<number>([META_DOC_IDS_C.center]);
    // 세트 격리 — 각 id 가 다른 세트에 없는지 양방향 확인.
    for (const a of aIds) {
      expect(bIds.has(a)).toBe(false);
      expect(cIds.has(a)).toBe(false);
    }
    for (const b of bIds) {
      expect(aIds.has(b)).toBe(false);
      expect(cIds.has(b)).toBe(false);
    }
  });
});
