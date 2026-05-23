/**
 * F-3 결정성 — 같은 입력에 대한 BFS 응답 동일성 (100회 내부 반복).
 *
 * 검증 목적:
 *  - getMetaFlowEgo 가 같은 (DB state, filter) 에 대해 100회 호출 시 모두 같은 결과.
 *  - ORDER BY 부재로 인한 SQLite 행 반환 순서 비결정성 회귀 즉시 빨강.
 *
 * 외부 셸 루프(A)와의 차이:
 *  - 본 테스트는 같은 프로세스 안 반복 — 셸 오버헤드 없이 ~5초.
 *  - CI gate 로 매번 실행 가능. PR 단계에서 결정성 회귀 차단.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getMetaFlowEgo } from '../index';
import { makeFlowDb, seedCatalog, chain, type FlowSeedHandle } from './__helpers__/flow-seed';

const REPEAT = 100;

/** ego 결과를 결정적 JSON 문자열로 직렬화 — 비교용. */
function serializeEgo(ego: ReturnType<typeof getMetaFlowEgo>): string {
  const nodes = ego.callTree.nodes
    .map(n => `${n.kind}:${n.name}|d=${n.depth}|t=${n.timeline ?? '-'}|c=${n.count}`)
    .sort();
  const edges = ego.callTree.edges
    .map(e => `${e.fromKind}:${e.fromName}→${e.toKind}:${e.toName}|${e.relation}|c=${e.count}`)
    .sort();
  return JSON.stringify({
    center: { type: ego.center.type, name: ego.center.name, turns: ego.center.turns },
    totalTurns: ego.totalTurns,
    nodes,
    edges,
  });
}

describe('F-3 결정성 — getMetaFlowEgo 100회 반복', () => {
  let ctx: FlowSeedHandle;

  beforeAll(() => {
    ctx = makeFlowDb({ project: 'determinism' });
    ['pm', 'backend', 'agent', 'orchestrator', 'coder', 'doc'].forEach(n =>
      seedCatalog(ctx.inst, 'agent', n, ctx.now),
    );
    ['doc-addr', 'commit', 'review'].forEach(n =>
      seedCatalog(ctx.inst, 'skill', n, ctx.now),
    );

    // 패턴 1 Bypass — turn 1 간접, turn 2 직접.
    chain('T1', [
      { kind: 'agent', name: 'pm', toolUseId: 'p1-pm', parent: null },
      { kind: 'skill', name: 'doc-addr', toolUseId: 'p1-d', parent: 'p1-pm' },
      { kind: 'agent', name: 'backend', toolUseId: 'p1-b', parent: 'p1-d' },
      { kind: 'agent', name: 'agent', toolUseId: 'p1-a', parent: 'p1-b' },
    ], ctx);
    chain('T2', [
      { kind: 'agent', name: 'pm', toolUseId: 'p2-pm', parent: null },
      { kind: 'agent', name: 'backend', toolUseId: 'p2-b', parent: 'p2-pm' },
      { kind: 'agent', name: 'agent', toolUseId: 'p2-a', parent: 'p2-b' },
    ], ctx);

    // 패턴 2 Conditional Branching — 분기 turn 3개.
    chain('T3', [
      { kind: 'agent', name: 'orchestrator', toolUseId: 't3-o', parent: null },
      { kind: 'skill', name: 'review', toolUseId: 't3-r', parent: 't3-o' },
      { kind: 'agent', name: 'coder', toolUseId: 't3-c', parent: 't3-r' },
      { kind: 'skill', name: 'commit', toolUseId: 't3-cm', parent: 't3-c' },
    ], ctx);
    chain('T4', [
      { kind: 'agent', name: 'orchestrator', toolUseId: 't4-o', parent: null },
      { kind: 'skill', name: 'review', toolUseId: 't4-r', parent: 't4-o' },
      { kind: 'agent', name: 'doc', toolUseId: 't4-d', parent: 't4-r' },
      { kind: 'skill', name: 'commit', toolUseId: 't4-cm', parent: 't4-d' },
    ], ctx);
  });

  afterAll(() => ctx.cleanup());

  it(`center=pm — ${REPEAT}회 반복 동일`, () => {
    const filter = {
      centerType: 'agent' as const,
      centerName: 'pm',
      project: 'determinism',
      windowDays: 7,
    };
    const baseline = serializeEgo(getMetaFlowEgo(ctx.inst, filter));
    let mismatch = 0;
    for (let i = 0; i < REPEAT; i++) {
      const got = serializeEgo(getMetaFlowEgo(ctx.inst, filter));
      if (got !== baseline) mismatch++;
    }
    expect(mismatch).toBe(0);
  });

  it(`center=backend — ${REPEAT}회 반복 동일 (부모 방향 BFS)`, () => {
    const filter = {
      centerType: 'agent' as const,
      centerName: 'backend',
      project: 'determinism',
      windowDays: 7,
    };
    const baseline = serializeEgo(getMetaFlowEgo(ctx.inst, filter));
    let mismatch = 0;
    for (let i = 0; i < REPEAT; i++) {
      const got = serializeEgo(getMetaFlowEgo(ctx.inst, filter));
      if (got !== baseline) mismatch++;
    }
    expect(mismatch).toBe(0);
  });

  it(`center=review — ${REPEAT}회 반복 동일 (skill, 양방향 BFS)`, () => {
    const filter = {
      centerType: 'skill' as const,
      centerName: 'review',
      project: 'determinism',
      windowDays: 7,
    };
    const baseline = serializeEgo(getMetaFlowEgo(ctx.inst, filter));
    let mismatch = 0;
    for (let i = 0; i < REPEAT; i++) {
      const got = serializeEgo(getMetaFlowEgo(ctx.inst, filter));
      if (got !== baseline) mismatch++;
    }
    expect(mismatch).toBe(0);
  });

  it(`center=orchestrator — ${REPEAT}회 반복 동일 (Conditional Branching)`, () => {
    const filter = {
      centerType: 'agent' as const,
      centerName: 'orchestrator',
      project: 'determinism',
      windowDays: 7,
    };
    const baseline = serializeEgo(getMetaFlowEgo(ctx.inst, filter));
    let mismatch = 0;
    for (let i = 0; i < REPEAT; i++) {
      const got = serializeEgo(getMetaFlowEgo(ctx.inst, filter));
      if (got !== baseline) mismatch++;
    }
    expect(mismatch).toBe(0);
  });
});
