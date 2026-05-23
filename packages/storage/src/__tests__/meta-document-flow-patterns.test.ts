/**
 * 5가지 토폴로지 패턴 회귀 테스트 (structured-coalescing-feather Plan §2.3).
 *
 * 검증 목적:
 *  1) BFS 결과의 노드 count / depth / edge set / turnSet 가 reload-to-reload 결정적이다.
 *  2) 5개 패턴 (Bypass, Conditional Branching, Shared Critic, Retry/Fallback, Fan-out/Fan-in) 의
 *     의도된 노드·엣지 구조가 보존된다 (P0 — 결정성 보장만, P2 의 다이아몬드 압축은 아직 검증하지 않음).
 *
 * 실패 모드:
 *  - storage BFS 의 ORDER BY 부재 (meta-document.ts:918-927, 1029-1049) → depth 비결정.
 *  - dedup 첫-매칭 우승 정책과 결합 시 reload 마다 다른 그래프.
 *
 * 본 파일은 P0 패치 (`ORDER BY timestamp ASC, event_rank ASC, tool_use_id ASC, id ASC`)
 * 전에 빨갛게, 패치 후 초록이 되어야 한다.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { getMetaFlowEgo, createRequest } from '../index';
import {
  makeFlowDb,
  seedCatalog,
  chain,
  type FlowSeedHandle,
} from './__helpers__/flow-seed';

// ──────────────────────────────────────────────────────────────────────────
// Pattern 1 — Bypass & Direct Call
//   T1: pm → doc-addr → backend → impl
//   T2: pm → backend  → impl
//   backend 가 두 turn 모두 호출됨 — depth dedup 우승은 더 짧은 경로 (depth=1).
//   현재(ORDER BY 부재): T1 가 먼저 들어가면 depth=2, T2 가 먼저면 depth=1 — 비결정.
// ──────────────────────────────────────────────────────────────────────────
describe('Pattern 1 — Bypass & Direct Call', () => {
  let ctx: FlowSeedHandle;

  beforeEach(() => {
    ctx = makeFlowDb({ project: 'p1-bypass' });
    ['pm', 'backend', 'impl'].forEach(n => seedCatalog(ctx.inst, 'agent', n, ctx.now));
    seedCatalog(ctx.inst, 'skill', 'doc-addr', ctx.now);
  });
  afterEach(() => ctx.cleanup());

  it('backend depth=1 (직접 호출 우승), edges=4', () => {
    chain('T1', [
      { kind: 'agent', name: 'pm', toolUseId: 'p1-pm-T1', parent: null },
      { kind: 'skill', name: 'doc-addr', toolUseId: 'p1-da-T1' },
      { kind: 'agent', name: 'backend', toolUseId: 'p1-be-T1' },
      { kind: 'agent', name: 'impl', toolUseId: 'p1-im-T1' },
    ], ctx);
    chain('T2', [
      { kind: 'agent', name: 'pm', toolUseId: 'p1-pm-T2', parent: null },
      { kind: 'agent', name: 'backend', toolUseId: 'p1-be-T2' },
      { kind: 'agent', name: 'impl', toolUseId: 'p1-im-T2' },
    ], ctx);

    const ego = getMetaFlowEgo(ctx.inst, {
      centerType: 'agent',
      centerName: 'pm',
      project: ctx.project,
      windowDays: 7,
    });

    expect(ego.center.turns).toBe(2);

    const backend = ego.callTree.nodes.find(n => n.name === 'backend' && !n.timeline);
    expect(backend).toBeDefined();
    expect(backend!.depth).toBe(1);
    expect(backend!.count).toBe(2);

    const docAddr = ego.callTree.nodes.find(n => n.name === 'doc-addr' && !n.timeline);
    expect(docAddr).toBeDefined();
    expect(docAddr!.depth).toBe(1);
    expect(docAddr!.count).toBe(1);

    const impl = ego.callTree.nodes.find(n => n.name === 'impl' && !n.timeline);
    expect(impl).toBeDefined();
    expect(impl!.count).toBe(2);

    const edgeSet = new Set(
      ego.callTree.edges
        .filter(e => e.relation === 'call')
        .map(e => `${e.fromName}->${e.toName}`)
    );
    expect(edgeSet).toEqual(new Set([
      'pm->doc-addr',
      'pm->backend',
      'doc-addr->backend',
      'backend->impl',
    ]));
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Pattern 2 — Conditional Branching
//   T1: query → cache_search → vector_db → llm
//   T2: query → cache_search → llm
//   vector_db 는 한 turn 만 등장. cache_search/llm 은 두 turn 모두.
//   P0 단계: 모든 노드·엣지 결정적으로 등장만 확인. P2 의 다이아몬드 압축은 별도.
// ──────────────────────────────────────────────────────────────────────────
describe('Pattern 2 — Conditional Branching', () => {
  let ctx: FlowSeedHandle;

  beforeEach(() => {
    ctx = makeFlowDb({ project: 'p2-cond' });
    ['query', 'cache_search', 'vector_db', 'llm'].forEach(n =>
      seedCatalog(ctx.inst, 'agent', n, ctx.now)
    );
  });
  afterEach(() => ctx.cleanup());

  it('vector_db depth=2 (T1 만), cache_search/llm count=2', () => {
    chain('T1', [
      { kind: 'agent', name: 'query', toolUseId: 'p2-q-T1', parent: null },
      { kind: 'agent', name: 'cache_search', toolUseId: 'p2-cs-T1' },
      { kind: 'agent', name: 'vector_db', toolUseId: 'p2-vd-T1' },
      { kind: 'agent', name: 'llm', toolUseId: 'p2-llm-T1' },
    ], ctx);
    chain('T2', [
      { kind: 'agent', name: 'query', toolUseId: 'p2-q-T2', parent: null },
      { kind: 'agent', name: 'cache_search', toolUseId: 'p2-cs-T2' },
      { kind: 'agent', name: 'llm', toolUseId: 'p2-llm-T2' },
    ], ctx);

    const ego = getMetaFlowEgo(ctx.inst, {
      centerType: 'agent',
      centerName: 'query',
      project: ctx.project,
      windowDays: 7,
    });

    expect(ego.center.turns).toBe(2);

    const cs = ego.callTree.nodes.find(n => n.name === 'cache_search' && !n.timeline);
    expect(cs!.depth).toBe(1);
    expect(cs!.count).toBe(2);

    const vd = ego.callTree.nodes.find(n => n.name === 'vector_db' && !n.timeline);
    expect(vd!.depth).toBe(2);
    expect(vd!.count).toBe(1);

    const llm = ego.callTree.nodes.find(n => n.name === 'llm' && !n.timeline);
    expect(llm).toBeDefined();
    expect(llm!.count).toBe(2);
    // llm 의 depth 는 T2 의 직접 cache_search→llm 으로 dedup 우승 → 2.
    expect(llm!.depth).toBe(2);

    const edgeNames = new Set(
      ego.callTree.edges
        .filter(e => e.relation === 'call')
        .map(e => `${e.fromName}->${e.toName}`)
    );
    expect(edgeNames.has('query->cache_search')).toBe(true);
    expect(edgeNames.has('cache_search->vector_db')).toBe(true);
    expect(edgeNames.has('vector_db->llm')).toBe(true);
    expect(edgeNames.has('cache_search->llm')).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Pattern 3 — Shared Critic
//   T1: orch → coder → critic
//   T2: orch → doc   → critic
//   critic 가 두 부모로부터 호출됨 → 노드 1개, edges 2개 (coder→critic, doc→critic).
// ──────────────────────────────────────────────────────────────────────────
describe('Pattern 3 — Shared Critic', () => {
  let ctx: FlowSeedHandle;

  beforeEach(() => {
    ctx = makeFlowDb({ project: 'p3-shared' });
    ['orch', 'coder', 'doc', 'critic'].forEach(n =>
      seedCatalog(ctx.inst, 'agent', n, ctx.now)
    );
  });
  afterEach(() => ctx.cleanup());

  it('critic 단일 노드 + 두 부모 엣지', () => {
    chain('T1', [
      { kind: 'agent', name: 'orch', toolUseId: 'p3-or-T1', parent: null },
      { kind: 'agent', name: 'coder', toolUseId: 'p3-co-T1' },
      { kind: 'agent', name: 'critic', toolUseId: 'p3-cr-T1' },
    ], ctx);
    chain('T2', [
      { kind: 'agent', name: 'orch', toolUseId: 'p3-or-T2', parent: null },
      { kind: 'agent', name: 'doc', toolUseId: 'p3-dc-T2' },
      { kind: 'agent', name: 'critic', toolUseId: 'p3-cr-T2' },
    ], ctx);

    const ego = getMetaFlowEgo(ctx.inst, {
      centerType: 'agent',
      centerName: 'orch',
      project: ctx.project,
      windowDays: 7,
    });

    const critics = ego.callTree.nodes.filter(n => n.name === 'critic' && !n.timeline);
    expect(critics).toHaveLength(1);
    expect(critics[0].count).toBe(2);
    expect(critics[0].depth).toBe(2);

    const callEdges = ego.callTree.edges.filter(e => e.relation === 'call');
    const toCritic = callEdges.filter(e => e.toName === 'critic');
    expect(toCritic.map(e => e.fromName).sort()).toEqual(['coder', 'doc']);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Pattern 4 — Retry / Fallback
//   T1: gw → primary → db
//   T2: gw → primary → retry → backup → db
//   가변 길이 사슬. db 는 두 turn 모두 — depth dedup 우승은 더 짧은 경로 (depth=2).
//   primary count=2, retry/backup count=1, db count=2.
// ──────────────────────────────────────────────────────────────────────────
describe('Pattern 4 — Retry / Fallback', () => {
  let ctx: FlowSeedHandle;

  beforeEach(() => {
    ctx = makeFlowDb({ project: 'p4-retry' });
    ['gw', 'primary', 'retry', 'backup', 'db'].forEach(n =>
      seedCatalog(ctx.inst, 'agent', n, ctx.now)
    );
  });
  afterEach(() => ctx.cleanup());

  it('db depth=2 (짧은 사슬 우승), primary count=2', () => {
    chain('T1', [
      { kind: 'agent', name: 'gw', toolUseId: 'p4-gw-T1', parent: null },
      { kind: 'agent', name: 'primary', toolUseId: 'p4-pr-T1' },
      { kind: 'agent', name: 'db', toolUseId: 'p4-db-T1' },
    ], ctx);
    chain('T2', [
      { kind: 'agent', name: 'gw', toolUseId: 'p4-gw-T2', parent: null },
      { kind: 'agent', name: 'primary', toolUseId: 'p4-pr-T2' },
      { kind: 'agent', name: 'retry', toolUseId: 'p4-rt-T2' },
      { kind: 'agent', name: 'backup', toolUseId: 'p4-bk-T2' },
      { kind: 'agent', name: 'db', toolUseId: 'p4-db-T2' },
    ], ctx);

    const ego = getMetaFlowEgo(ctx.inst, {
      centerType: 'agent',
      centerName: 'gw',
      project: ctx.project,
      windowDays: 7,
    });

    const primary = ego.callTree.nodes.find(n => n.name === 'primary' && !n.timeline);
    expect(primary!.depth).toBe(1);
    expect(primary!.count).toBe(2);

    const db = ego.callTree.nodes.find(n => n.name === 'db' && !n.timeline);
    expect(db).toBeDefined();
    expect(db!.depth).toBe(2);   // T1 의 짧은 경로 우승
    expect(db!.count).toBe(2);

    const retry = ego.callTree.nodes.find(n => n.name === 'retry' && !n.timeline);
    expect(retry!.depth).toBe(2);
    expect(retry!.count).toBe(1);

    const backup = ego.callTree.nodes.find(n => n.name === 'backup' && !n.timeline);
    expect(backup!.depth).toBe(3);
    expect(backup!.count).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Pattern 5 — Fan-out / Fan-in
//   T1: main → sub1 → agg
//   T2: main → sub2 → agg
//   T3: main → sub3 → agg
//   agg 는 3 turn 누적 → count=3, depth=2.
//   sub_i 는 각자 count=1.
// ──────────────────────────────────────────────────────────────────────────
describe('Pattern 5 — Fan-out / Fan-in', () => {
  let ctx: FlowSeedHandle;

  beforeEach(() => {
    ctx = makeFlowDb({ project: 'p5-fan' });
    ['main', 'sub1', 'sub2', 'sub3', 'agg'].forEach(n =>
      seedCatalog(ctx.inst, 'agent', n, ctx.now)
    );
  });
  afterEach(() => ctx.cleanup());

  it('agg distinct-turn-count=3, sub_i count=1', () => {
    chain('T1', [
      { kind: 'agent', name: 'main', toolUseId: 'p5-mn-T1', parent: null },
      { kind: 'agent', name: 'sub1', toolUseId: 'p5-s1-T1' },
      { kind: 'agent', name: 'agg', toolUseId: 'p5-ag-T1' },
    ], ctx);
    chain('T2', [
      { kind: 'agent', name: 'main', toolUseId: 'p5-mn-T2', parent: null },
      { kind: 'agent', name: 'sub2', toolUseId: 'p5-s2-T2' },
      { kind: 'agent', name: 'agg', toolUseId: 'p5-ag-T2' },
    ], ctx);
    chain('T3', [
      { kind: 'agent', name: 'main', toolUseId: 'p5-mn-T3', parent: null },
      { kind: 'agent', name: 'sub3', toolUseId: 'p5-s3-T3' },
      { kind: 'agent', name: 'agg', toolUseId: 'p5-ag-T3' },
    ], ctx);

    const ego = getMetaFlowEgo(ctx.inst, {
      centerType: 'agent',
      centerName: 'main',
      project: ctx.project,
      windowDays: 7,
    });

    expect(ego.center.turns).toBe(3);

    const agg = ego.callTree.nodes.find(n => n.name === 'agg' && !n.timeline);
    expect(agg!.depth).toBe(2);
    expect(agg!.count).toBe(3);

    for (const n of ['sub1', 'sub2', 'sub3']) {
      const sub = ego.callTree.nodes.find(x => x.name === n && !x.timeline);
      expect(sub).toBeDefined();
      expect(sub!.depth).toBe(1);
      expect(sub!.count).toBe(1);
    }

    const aggInEdges = ego.callTree.edges
      .filter(e => e.relation === 'call' && e.toName === 'agg')
      .map(e => e.fromName)
      .sort();
    expect(aggInEdges).toEqual(['sub1', 'sub2', 'sub3']);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Determinism F-3 — 동일 timestamp + 다중 event_type / 다중 tool_use_id
//
//   "P0 ORDER BY 가 보장하는 명시적 결정성" 을 직접 검증한다.
//   같은 (timestamp, parent) 에서 두 행이 동시에 등장할 때 BFS dedup 우승이
//   reload-to-reload 동일하다는 사실을 그래프 시그니처 (kind/name/depth/count) 의
//   N회 반복 비교로 어셔트한다.
// ──────────────────────────────────────────────────────────────────────────
describe('Determinism F-3 — 동일 timestamp 다중 행', () => {
  let ctx: FlowSeedHandle;

  beforeEach(() => {
    ctx = makeFlowDb({ project: 'fd-determinism' });
    ['pm', 'X', 'Y', 'Z'].forEach(n => seedCatalog(ctx.inst, 'agent', n, ctx.now));
  });
  afterEach(() => ctx.cleanup());

  /** ego 응답을 비교 가능한 정렬된 시그니처 문자열로 환산. */
  function egoSignature(ego: ReturnType<typeof getMetaFlowEgo>): string {
    const nodes = ego.callTree.nodes
      .map(n => ({
        kind: n.kind, name: n.name, depth: n.depth,
        timeline: n.timeline ?? null, count: n.count,
      }))
      .sort((a, b) =>
        (a.timeline ?? '').localeCompare(b.timeline ?? '')
        || a.kind.localeCompare(b.kind)
        || a.name.localeCompare(b.name)
        || a.depth - b.depth,
      );
    const edges = ego.callTree.edges
      .map(e => ({
        from: `${e.fromKind}:${e.fromName}`,
        to: `${e.toKind}:${e.toName}`,
        relation: e.relation,
        count: e.count,
      }))
      .sort((a, b) =>
        a.relation.localeCompare(b.relation)
        || a.from.localeCompare(b.from)
        || a.to.localeCompare(b.to),
      );
    return JSON.stringify({ nodes, edges });
  }

  it('동일 (parent, kind, name, ts) 다중 행 — 노드 dedup + 자손 확장이 결정적', () => {
    // pm → X (tu-a, ts=T) / pm → X (tu-b, ts=T) — 같은 ts, 다른 tu_use_id, 같은 (kind,name).
    // tu-a 의 자식 Y, tu-b 의 자식 Z. ORDER BY tool_use_id ASC 가 처리 순서를 결정.
    // 결과 그래프의 노드/엣지 시그니처는 5회 반복 동일해야 한다.
    chain('T1', [
      { kind: 'agent', name: 'pm', toolUseId: 'fd-pm', parent: null },
    ], ctx);

    // 같은 ts (ctx.now + 1000) 에 X 두 행. id / tool_use_id 모두 다름.
    const sharedTs = ctx.now + 1000;
    createRequest(ctx.inst, {
      id: 'fd-x-a',
      session_id: ctx.sessionId,
      timestamp: sharedTs,
      type: 'tool_call',
      tool_name: 'Agent',
      tool_detail: 'X',
      turn_id: 'T1',
      tool_use_id: 'tu-a',
      parent_tool_use_id: 'fd-pm',
      event_type: 'tool',
      agent_type: 'X',
    });
    createRequest(ctx.inst, {
      id: 'fd-x-b',
      session_id: ctx.sessionId,
      timestamp: sharedTs,
      type: 'tool_call',
      tool_name: 'Agent',
      tool_detail: 'X',
      turn_id: 'T1',
      tool_use_id: 'tu-b',
      parent_tool_use_id: 'fd-pm',
      event_type: 'tool',
      agent_type: 'X',
    });
    // tu-a 의 자식 Y, tu-b 의 자식 Z — 다음 hop 에서 처리.
    createRequest(ctx.inst, {
      id: 'fd-y', session_id: ctx.sessionId, timestamp: ctx.now + 2000,
      type: 'tool_call', tool_name: 'Agent', tool_detail: 'Y',
      turn_id: 'T1', tool_use_id: 'tu-y', parent_tool_use_id: 'tu-a',
      event_type: 'tool', agent_type: 'Y',
    });
    createRequest(ctx.inst, {
      id: 'fd-z', session_id: ctx.sessionId, timestamp: ctx.now + 2000,
      type: 'tool_call', tool_name: 'Agent', tool_detail: 'Z',
      turn_id: 'T1', tool_use_id: 'tu-z', parent_tool_use_id: 'tu-b',
      event_type: 'tool', agent_type: 'Z',
    });

    // 5회 반복 — 시그니처 동일성 보장.
    let firstSig: string | null = null;
    for (let i = 0; i < 5; i++) {
      const ego = getMetaFlowEgo(ctx.inst, {
        centerType: 'agent', centerName: 'pm',
        project: ctx.project, windowDays: 7,
      });
      const sig = egoSignature(ego);
      if (firstSig === null) firstSig = sig;
      else expect(sig).toBe(firstSig);
    }

    // 의도된 구조 — X depth=1 + Y, Z depth=2 둘 다 X 자식으로.
    const ego = getMetaFlowEgo(ctx.inst, {
      centerType: 'agent', centerName: 'pm',
      project: ctx.project, windowDays: 7,
    });
    const X = ego.callTree.nodes.find(n => n.name === 'X' && !n.timeline);
    expect(X!.depth).toBe(1);
    const Y = ego.callTree.nodes.find(n => n.name === 'Y' && !n.timeline);
    const Z = ego.callTree.nodes.find(n => n.name === 'Z' && !n.timeline);
    expect(Y!.depth).toBe(2);
    expect(Z!.depth).toBe(2);
    const callEdges = ego.callTree.edges.filter(e => e.relation === 'call');
    expect(callEdges.some(e => e.fromName === 'X' && e.toName === 'Y')).toBe(true);
    expect(callEdges.some(e => e.fromName === 'X' && e.toName === 'Z')).toBe(true);
  });

  it('동일 (kind, name, ts) + 다른 event_type — "tool" 우선 (event_rank=0)', () => {
    // 같은 X 노드를 'tool' 행과 'post_tool' 행 두 개로 시드.
    // ORDER BY event_rank ASC 가 'tool'(0) > 'post_tool'(1) 순서로 처리.
    // BFS dedup 첫-매칭 우승 정책상 'tool' 행이 nodeMap 에 박힘.
    chain('T1', [
      { kind: 'agent', name: 'pm', toolUseId: 'fd2-pm', parent: null },
    ], ctx);

    const sharedTs = ctx.now + 1000;
    createRequest(ctx.inst, {
      id: 'fd2-x-tool',
      session_id: ctx.sessionId,
      timestamp: sharedTs,
      type: 'tool_call', tool_name: 'Agent', tool_detail: 'X',
      turn_id: 'T1', tool_use_id: 'tu-tool',
      parent_tool_use_id: 'fd2-pm',
      event_type: 'tool',
      agent_type: 'X',
    });
    createRequest(ctx.inst, {
      id: 'fd2-x-post',
      session_id: ctx.sessionId,
      timestamp: sharedTs,
      type: 'tool_call', tool_name: 'Agent', tool_detail: 'X',
      turn_id: 'T1', tool_use_id: 'tu-post',
      parent_tool_use_id: 'fd2-pm',
      event_type: 'post_tool',
      agent_type: 'X',
    });

    // 5회 반복 시그니처 동일.
    let firstSig: string | null = null;
    for (let i = 0; i < 5; i++) {
      const ego = getMetaFlowEgo(ctx.inst, {
        centerType: 'agent', centerName: 'pm',
        project: ctx.project, windowDays: 7,
      });
      const sig = egoSignature(ego);
      if (firstSig === null) firstSig = sig;
      else expect(sig).toBe(firstSig);
    }

    // X 가 depth=1 단일 노드. distinct turn count=1.
    const ego = getMetaFlowEgo(ctx.inst, {
      centerType: 'agent', centerName: 'pm',
      project: ctx.project, windowDays: 7,
    });
    const xNodes = ego.callTree.nodes.filter(n => n.name === 'X' && !n.timeline);
    expect(xNodes).toHaveLength(1);
    expect(xNodes[0].depth).toBe(1);
    expect(xNodes[0].count).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Project Filter Parity F-6 — storage BFS 모든 단계가 project 필터 일관 적용
//
//   같은 (kind, name) 의 다른-project 행이 누수되지 않는지 검증.
//   자식 BFS / 부모 BFS / turn-after / center 발견 4단계 모두에 적용되어야 한다.
// ──────────────────────────────────────────────────────────────────────────
describe('Project Filter Parity F-6 — 다른 project 누수 차단', () => {
  let ctx: FlowSeedHandle;

  beforeEach(() => {
    ctx = makeFlowDb({ project: 'parity-A' });
    // 추가 세션 — 다른 project (parity-B) 에 동일 (kind,name) 시드.
    const sessionB = crypto.randomUUID();
    ctx.inst.query(`
      INSERT INTO sessions (id, project_name, started_at, total_tokens)
      VALUES (?, ?, ?, 0)
    `).run(sessionB, 'parity-B', ctx.now - 60_000);
    // 카탈로그 — 두 project 가 공유.
    ['pm', 'X', 'leakedFromB'].forEach(n => seedCatalog(ctx.inst, 'agent', n, ctx.now));

    // project A: pm → X
    chain('T1', [
      { kind: 'agent', name: 'pm', toolUseId: 'pA-pm', parent: null },
      { kind: 'agent', name: 'X', toolUseId: 'pA-x' },
    ], ctx);

    // project B: pm → leakedFromB. 다른 session_id.
    createRequest(ctx.inst, {
      id: 'pB-pm', session_id: sessionB, timestamp: ctx.now,
      type: 'tool_call', tool_name: 'Agent', tool_detail: 'pm',
      turn_id: 'B1', tool_use_id: 'pB-pm', event_type: 'tool',
      agent_type: 'pm',
    });
    createRequest(ctx.inst, {
      id: 'pB-leak', session_id: sessionB, timestamp: ctx.now + 1000,
      type: 'tool_call', tool_name: 'Agent', tool_detail: 'leakedFromB',
      turn_id: 'B1', tool_use_id: 'pB-leak', parent_tool_use_id: 'pB-pm',
      event_type: 'tool', agent_type: 'leakedFromB',
    });
  });
  afterEach(() => ctx.cleanup());

  it('project=parity-A 호출 시 parity-B 의 leakedFromB 미노출', () => {
    const ego = getMetaFlowEgo(ctx.inst, {
      centerType: 'agent', centerName: 'pm',
      project: 'parity-A', windowDays: 7,
    });
    // center=pm 은 두 project 에 있지만 A 만 카운트.
    expect(ego.center.turns).toBe(1);

    // leakedFromB 노드가 callTree 에 나타나면 안 됨.
    const leaked = ego.callTree.nodes.find(n => n.name === 'leakedFromB');
    expect(leaked).toBeUndefined();

    // X 는 A 만의 자식이라 정상 노출.
    const X = ego.callTree.nodes.find(n => n.name === 'X' && !n.timeline);
    expect(X).toBeDefined();
  });

  it('project=null (전 project) 호출 시 두 project 모두 노출', () => {
    const ego = getMetaFlowEgo(ctx.inst, {
      centerType: 'agent', centerName: 'pm',
      project: null, windowDays: 7,
    });
    expect(ego.center.turns).toBe(2);
    const leaked = ego.callTree.nodes.find(n => n.name === 'leakedFromB');
    const X = ego.callTree.nodes.find(n => n.name === 'X' && !n.timeline);
    expect(leaked).toBeDefined();
    expect(X).toBeDefined();
  });
});
