/**
 * Unit tests — buildEgoFlowGraph 동적 컬럼 레이아웃
 *
 * meta-docs-flow-dynamic-columns (2026-05-21):
 *  - 컬럼 수는 등장한 depth 집합에 따라 가변.
 *  - 컬럼당 Top-N=64 까지 노드 수용.
 *  - sectionLabel.kind는 `parent-N` / `depth-N` / `turn-after` 동적 생성.
 *  - 노드 sub는 `<b>N</b> turns · M%` (단위 통일).
 */

import { describe, test, expect } from 'bun:test';
import type { MetaFlowEgo } from '@spyglass/storage';
import { buildEgoFlowGraph } from '../meta-docs';

function makeEgo(opts: {
  centerTurns?: number;
  centerInvocations?: number;
  totalTurns?: number;
  nodes?: MetaFlowEgo['callTree']['nodes'];
  edges?: MetaFlowEgo['callTree']['edges'];
}): MetaFlowEgo {
  const turns = opts.centerTurns ?? 10;
  return {
    center: {
      type: 'skill',
      name: 'commit',
      turns,
      invocations: opts.centerInvocations ?? turns,
    },
    totalTurns: opts.totalTurns ?? 100,
    callTree: {
      nodes: opts.nodes ?? [],
      edges: opts.edges ?? [],
    },
  };
}

describe('buildEgoFlowGraph — 동적 컬럼 레이아웃', () => {
  test('등장한 depth 집합만으로 컬럼을 만든다 (depth 5까지)', () => {
    const nodes: MetaFlowEgo['callTree']['nodes'] = [
      { kind: 'skill', name: 'd1', depth: 1, timeline: null, count: 5, pct: 0.5 },
      { kind: 'skill', name: 'd5', depth: 5, timeline: null, count: 1, pct: 0.1 },
      { kind: 'skill', name: 'p2', depth: -2, timeline: null, count: 2, pct: 0.2 },
    ];
    const ego = makeEgo({ nodes });
    const g = buildEgoFlowGraph(ego, null, 14);

    // depth=5 노드가 누락 없이 등장
    const d5 = g.nodes.find((n) => n.title === 'd5');
    expect(d5).toBeTruthy();
    expect(d5!.depth).toBe(5);

    // depth=-2 부모 노드도 정상
    const p2 = g.nodes.find((n) => n.title === 'p2');
    expect(p2).toBeTruthy();
    expect(p2!.depth).toBe(-2);

    // section label kind가 동적
    const labelKinds = g.sectionLabels.map((l) => l.kind).sort();
    expect(labelKinds).toContain('depth-1');
    expect(labelKinds).toContain('depth-5');
    expect(labelKinds).toContain('parent-2');
  });

  test('Top-N=64까지 한 컬럼에 수용 (이전 6 상한 폐기)', () => {
    const nodes: MetaFlowEgo['callTree']['nodes'] = Array.from({ length: 70 }, (_, i) => ({
      kind: 'skill' as const,
      name: `s${i + 1}`,
      depth: 1,
      timeline: null as 'after' | null,
      count: 70 - i,
      pct: (70 - i) / 100,
    }));
    const ego = makeEgo({ nodes });
    const g = buildEgoFlowGraph(ego, null, 14);

    const depth1Nodes = g.nodes.filter((n) => n.depth === 1);
    // 64개까지 수용
    expect(depth1Nodes.length).toBe(64);
  });

  test('노드 sub 표기가 "<b>N</b> turns · M%" 형식', () => {
    const nodes: MetaFlowEgo['callTree']['nodes'] = [
      { kind: 'skill', name: 'd1', depth: 1, timeline: null, count: 7, pct: 0.7 },
    ];
    const ego = makeEgo({ centerTurns: 10, nodes });
    const g = buildEgoFlowGraph(ego, null, 14);

    const d1 = g.nodes.find((n) => n.title === 'd1');
    expect(d1!.sub).toContain('turns');
    expect(d1!.sub).toContain('<b>7</b>');
    // 회 표기는 더 이상 사용하지 않음
    expect(d1!.sub).not.toContain('회');
  });

  test('center 카드 sub도 "N turns" 단위', () => {
    const ego = makeEgo({ centerTurns: 12 });
    const g = buildEgoFlowGraph(ego, null, 14);

    const center = g.nodes.find((n) => n.id === 'center');
    expect(center!.sub).toBe('<b>12</b> turns');
  });

  test('center 카드 sub는 turns ≠ calls 일 때 "N turns · M calls" 보조 라벨 추가', () => {
    // pm 에이전트가 27 distinct turn 안에서 총 34회 호출된 케이스(사용자 보고).
    const ego = makeEgo({ centerTurns: 27, centerInvocations: 34 });
    const g = buildEgoFlowGraph(ego, null, 14);

    const center = g.nodes.find((n) => n.id === 'center');
    expect(center!.sub).toBe('<b>27</b> turns · 34 calls');
  });

  test('centerTurns=0 이면 center 노드 없이 빈 그래프 반환', () => {
    // 사용 이력이 0건인 메타 문서를 클릭한 경우 — 노드를 그리지 말고 안내 문구만.
    // 클라이언트(meta-docs-flow-view.js)는 nodes.length===0 분기로 emptyHtml 안내.
    const ego = makeEgo({ centerTurns: 0, centerInvocations: 0 });
    const g = buildEgoFlowGraph(ego, null, 14);

    expect(g.nodes).toHaveLength(0);
    expect(g.edges).toHaveLength(0);
    expect(g.sectionLabels).toHaveLength(0);
    // meta echo 는 유지 — 프론트가 center.name 으로 안내 문구를 채운다.
    expect(g.meta.centerTurns).toBe(0);
    expect(g.meta.center).toEqual({ type: 'skill', name: 'commit' });
  });

  test('등장한 depth 없는 컬럼은 콜오더에서 제외 (parent만 있는 경우)', () => {
    const nodes: MetaFlowEgo['callTree']['nodes'] = [
      { kind: 'skill', name: 'p1', depth: -1, timeline: null, count: 5, pct: 0.5 },
    ];
    const ego = makeEgo({ nodes });
    const g = buildEgoFlowGraph(ego, null, 14);

    // child 컬럼 없음 → depth-N 라벨 부재
    const labelKinds = g.sectionLabels.map((l) => l.kind);
    expect(labelKinds.some((k) => k.startsWith('depth-'))).toBe(false);
    // parent-1 라벨 존재
    expect(labelKinds).toContain('parent-1');
  });

  test('turn-after 컬럼은 turn-after 노드가 있을 때만 등장', () => {
    const withoutAfter = buildEgoFlowGraph(
      makeEgo({
        nodes: [
          { kind: 'skill', name: 'd1', depth: 1, timeline: null, count: 3, pct: 0.3 },
        ],
      }),
      null,
      14,
    );
    expect(withoutAfter.sectionLabels.some((l) => l.kind === 'turn-after')).toBe(false);

    const withAfter = buildEgoFlowGraph(
      makeEgo({
        nodes: [
          { kind: 'skill', name: 'd1', depth: 1, timeline: null, count: 3, pct: 0.3 },
          { kind: 'skill', name: 'af', depth: 1, timeline: 'after', count: 2, pct: 0.2 },
        ],
      }),
      null,
      14,
    );
    expect(withAfter.sectionLabels.some((l) => l.kind === 'turn-after')).toBe(true);
  });

  test('컬럼 x 좌표는 좌→우 누적, 동일 depth 노드는 동일 x', () => {
    const nodes: MetaFlowEgo['callTree']['nodes'] = [
      { kind: 'skill', name: 'a', depth: 1, timeline: null, count: 5, pct: 0.5 },
      { kind: 'skill', name: 'b', depth: 1, timeline: null, count: 3, pct: 0.3 },
      { kind: 'skill', name: 'c', depth: 2, timeline: null, count: 2, pct: 0.2 },
    ];
    const ego = makeEgo({
      nodes,
      edges: [
        { fromKind: 'skill', fromName: 'commit', toKind: 'skill', toName: 'a', relation: 'call', count: 5 },
        { fromKind: 'skill', fromName: 'commit', toKind: 'skill', toName: 'b', relation: 'call', count: 3 },
        { fromKind: 'skill', fromName: 'a',      toKind: 'skill', toName: 'c', relation: 'call', count: 2 },
      ],
    });
    const g = buildEgoFlowGraph(ego, null, 14);

    const a = g.nodes.find((n) => n.title === 'a')!;
    const b = g.nodes.find((n) => n.title === 'b')!;
    const c = g.nodes.find((n) => n.title === 'c')!;
    // 같은 depth=1 → 같은 x
    expect(a.x).toBe(b.x);
    // depth=2는 더 오른쪽
    expect(c.x).toBeGreaterThan(a.x);
  });
});

describe('buildEgoFlowGraph — MCP server 단위 그룹핑', () => {
  // meta-docs-flow-mcp-grouping (2026-05-21):
  // 같은 컬럼 안에서 동일 server 의 mcp 도구가 2+ 이면 server 카드 1개로 묶는다.
  // 부모/자식/turn-after 등 다른 컬럼에서는 독립적으로 그룹핑 판단.

  test('같은 컬럼의 mcp 도구를 server 단위로 그룹화한다 (2+)', () => {
    const nodes: MetaFlowEgo['callTree']['nodes'] = [
      { kind: 'mcp', name: 'mcp__redmine__getIssue',         depth: 1, timeline: null, count: 3, pct: 0.3 },
      { kind: 'mcp', name: 'mcp__redmine__getIssueStatuses', depth: 1, timeline: null, count: 2, pct: 0.2 },
      { kind: 'mcp', name: 'mcp__redmine__updateIssue',      depth: 1, timeline: null, count: 2, pct: 0.2 },
    ];
    const ego = makeEgo({ centerTurns: 16, nodes });
    const g = buildEgoFlowGraph(ego, null, 14);

    // 그룹 카드 1개로 수렴 — title 은 server 이름.
    const redmine = g.nodes.find((n) => n.title === 'redmine');
    expect(redmine).toBeTruthy();
    expect(redmine!.kind).toBe('mcp');
    expect(redmine!.depth).toBe(1);

    // subRows 에 3개 도구가 각각 노출.
    expect(redmine!.subRows).toBeDefined();
    expect(redmine!.subRows!.length).toBe(3);
    const toolNames = redmine!.subRows!.map((r) => r.toolName).sort();
    expect(toolNames).toEqual(['getIssue', 'getIssueStatuses', 'updateIssue']);

    // 합산 count = 7 → 16 turns 분모에서 43.8%.
    expect(redmine!.sub).toContain('<b>7</b>');
    expect(redmine!.sub).toContain('43.8%');

    // 풀네임 카드는 더 이상 등장하지 않음(=그룹으로 흡수).
    const fullCards = g.nodes.filter((n) => n.title.startsWith('mcp__'));
    expect(fullCards.length).toBe(0);
  });

  test('컬럼에 같은 server mcp 도구가 1개뿐이면 그룹화하지 않는다', () => {
    const nodes: MetaFlowEgo['callTree']['nodes'] = [
      { kind: 'mcp', name: 'mcp__redmine__getIssue', depth: 1, timeline: null, count: 5, pct: 0.5 },
    ];
    const ego = makeEgo({ centerTurns: 10, nodes });
    const g = buildEgoFlowGraph(ego, null, 14);

    // 풀네임이 그대로 카드 title 로 남는다 — 단일 도구에 무의미한 wrap 방지.
    const card = g.nodes.find((n) => n.title === 'mcp__redmine__getIssue');
    expect(card).toBeTruthy();
    expect(card!.subRows).toBeUndefined();

    // 'redmine' 그룹 카드는 발급되지 않음.
    expect(g.nodes.find((n) => n.title === 'redmine')).toBeUndefined();
  });

  test('같은 server 가 부모/자식 컬럼에 분산되면 컬럼별로 별도 카드', () => {
    // depth=-1 에 1개, depth=1 에 1개 — 양쪽 모두 단일이라 그룹화 X. 분리만 확인.
    const nodes: MetaFlowEgo['callTree']['nodes'] = [
      { kind: 'mcp', name: 'mcp__redmine__updateIssue', depth: -1, timeline: null, count: 2, pct: 0.2 },
      { kind: 'mcp', name: 'mcp__redmine__getIssue',    depth:  1, timeline: null, count: 3, pct: 0.3 },
    ];
    const ego = makeEgo({ centerTurns: 10, nodes });
    const g = buildEgoFlowGraph(ego, null, 14);

    const parentCard = g.nodes.find((n) => n.title === 'mcp__redmine__updateIssue');
    const childCard  = g.nodes.find((n) => n.title === 'mcp__redmine__getIssue');
    expect(parentCard).toBeTruthy();
    expect(childCard).toBeTruthy();
    expect(parentCard!.depth).toBe(-1);
    expect(childCard!.depth).toBe(1);
    // 컬럼이 다르면 x 도 다르다.
    expect(parentCard!.x).not.toBe(childCard!.x);
  });

  test('그룹화된 노드를 향하는 center 의 edge 가 1개로 dedupe 된다', () => {
    const nodes: MetaFlowEgo['callTree']['nodes'] = [
      { kind: 'mcp', name: 'mcp__redmine__getIssue',         depth: 1, timeline: null, count: 6, pct: 0.6 },
      { kind: 'mcp', name: 'mcp__redmine__getIssueStatuses', depth: 1, timeline: null, count: 2, pct: 0.2 },
      { kind: 'mcp', name: 'mcp__redmine__updateIssue',      depth: 1, timeline: null, count: 1, pct: 0.1 },
    ];
    const edges: MetaFlowEgo['callTree']['edges'] = [
      // center(commit) → 각 도구. strength: 60%=strong / 20%=medium / 10%=weak.
      { fromKind: 'skill', fromName: 'commit', toKind: 'mcp', toName: 'mcp__redmine__getIssue',         relation: 'call', count: 6 },
      { fromKind: 'skill', fromName: 'commit', toKind: 'mcp', toName: 'mcp__redmine__getIssueStatuses', relation: 'call', count: 2 },
      { fromKind: 'skill', fromName: 'commit', toKind: 'mcp', toName: 'mcp__redmine__updateIssue',      relation: 'call', count: 1 },
    ];
    const ego = makeEgo({ centerTurns: 10, nodes, edges });
    const g = buildEgoFlowGraph(ego, null, 14);

    // center → redmine 그룹 1개 edge 로 수렴.
    const redmine = g.nodes.find((n) => n.title === 'redmine')!;
    const toRedmine = g.edges.filter((e) => e.from === 'center' && e.to === redmine.id);
    expect(toRedmine.length).toBe(1);
    // strength 는 입력 3개(strong/medium/weak) 중 최강 = 'strong'.
    expect(toRedmine[0].strength).toBe('strong');
  });
});
