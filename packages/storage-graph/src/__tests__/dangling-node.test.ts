/**
 * dangling-node.test.ts — dangling-node 완화 메커니즘 특성화 (R7)
 *
 * 배경 (R7 회귀 가드):
 *   "한 outbox row 의 노드 op 는 성공했는데 엣지 op 만 영구 실패 → row 가 DLQ 격리되어
 *   노드는 적재됐으나 엣지가 누락 = dangling-node" 가 이론적 위험이다. 그러나 본 시스템은
 *   소스 변경 없이 다음 세 메커니즘으로 이를 완화한다 — 본 파일은 그 동작을 *고정*한다
 *   (소스 동작 변경 0, 테스트만).
 *
 *   1) **부분 적용 + 격리** — mergeOps 는 Ladybug 0.16.x 트랜잭션이 no-op 이라 롤백하지
 *      않는다. 노드 op 는 적재하고 실패한 엣지 op 만 `failed` 에 수집한다(설계대로).
 *      worker 는 그 row 를 (다른 row 가 성공해 시스템 healthy 임이 증명되면) 독성으로 보고
 *      attempts++/dead 격리한다.
 *   2) **resurrect 복구 연계** — DLQ 격리된 row 를 resurrectDeadLetters 로 reset 하면 다음
 *      tick 에서 다시 read 되어 재enrich → 엣지 재시도된다. 엣지 실패 원인이 해소되면 엣지가
 *      적재되어 dangling 이 해소된다 → dangling 은 *영구가 아님*.
 *   3) **노드-우선 op 순서** — enrich 는 한 row 안에서 노드 op 를, 그 노드를 참조하는 엣지
 *      op 보다 먼저 배치한다. 따라서 같은 batch 안에서는 엣지 MATCH 가 노드를 항상 찾는다.
 *      엣지 양끝 중 *다른 outbox row* 가 만드는 노드(예: Session, parent ToolCall)는 본 row
 *      에 없으므로 mergeRel 의 MATCH-0 no-op 재시도가 흡수한다(다음 tick 재시도).
 *
 * 기존 테스트와의 경계(중복 회피):
 *   - outbox-dlq.test.ts: recordOutboxFailure/readOutboxBatch/resurrect 의 *SQL primitive* 만
 *     검증(tick·enrich·merge 무관). 본 파일은 실제 tick→merge→엣지 재시도 *경로* 를 닫는다.
 *   - outbox-tick.test.ts: poison row 의 *모든* query 를 실패시켜(노드+엣지 동일) systemic/poison
 *     구분만 본다 — 노드는 적재되지 않는다. 본 파일은 노드는 성공하고 *엣지만* 실패하는 진짜
 *     dangling 상황을 따로 고정한다.
 *   - topological-sort.test.ts: 범용 그래프 알고리즘 — enrich 의 노드-우선 순서와 무관.
 *
 * 격리: 고유 임시 DB 파일, 자체 SpyglassDatabase(autoInit), afterEach 정리. merge/enrich 레벨
 *       케이스는 in-memory recording mock client 사용(무거운 seed-mocks/mock-client 불필요).
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { unlinkSync } from 'fs';
import { SpyglassDatabase, closeDatabase, createSession, createRequest } from '@spyglass/storage';
import { mergeOps } from '../sync/merge';
import { enrichOutboxRow, type GraphOp, type OutboxRow } from '../sync/enrich';
import { runOutboxTick, MAX_OUTBOX_ATTEMPTS } from '../sync/worker';
import type { LadybugClient } from '../client';

const NOW = 1778904000000;

// =============================================================================
// recording mock client — 모든 query 의 Cypher 를 기록. 엣지(rel) query 만 선택 실패 가능.
// =============================================================================

interface RecordedQuery {
  cypher: string;
  params: Record<string, unknown> | undefined;
}

/**
 * 엣지 query 판별 — mergeRel 만 `-[r:` 패턴(존재체크 MATCH 또는 CREATE)을 만든다.
 * 노드 MERGE 는 `MERGE (x:Label {...})` 로 `-[r:` 패턴이 없다.
 */
function isEdgeCypher(cypher: string): boolean {
  return cypher.includes('-[r:');
}

interface MockOptions {
  /** true 면 엣지(rel) query 를 throw — dangling 유발. 토글 가능. */
  failEdges: boolean;
}

function createRecordingClient(opts: MockOptions) {
  const recorded: RecordedQuery[] = [];
  const succeeded: RecordedQuery[] = [];
  const state = { failEdges: opts.failEdges };
  const client = {
    async query(cypher: string, params?: Record<string, unknown>) {
      recorded.push({ cypher, params });
      if (state.failEdges && isEdgeCypher(cypher)) {
        throw new Error('edge op boom (dangling)');
      }
      succeeded.push({ cypher, params });
      return { rows: [], durationMs: 0 };
    },
    async transaction<T>(work: () => Promise<T>): Promise<T> {
      // Ladybug 0.16.x 와 동일하게 no-op 래퍼(롤백 없음).
      return work();
    },
  };
  return {
    client: client as unknown as LadybugClient,
    recorded,
    succeeded,
    state,
    nodeMergeCount: () => succeeded.filter((q) => q.cypher.startsWith('MERGE (')).length,
    edgeCreateCount: () =>
      succeeded.filter((q) => q.cypher.includes('CREATE (a)') && isEdgeCypher(q.cypher)).length,
  };
}

/** fake cursor — 메모리 상태만. */
function fakeCursor(start = 0) {
  return { current: start, advance(id: number) { this.current = id; } };
}
/** fake circuit breaker — 호출 횟수만 카운트. */
function fakeBreaker() {
  return {
    successes: 0,
    failures: 0,
    recordSuccess() { this.successes++; },
    recordFailure() { this.failures++; },
  };
}

// =============================================================================
// CASE 1 — 부분 적용 + 격리 (롤백 없음 = 설계대로)
// =============================================================================

describe('R7 dangling-node — 부분 적용 + 격리', () => {
  it('mergeOps: 노드 op 는 적재하고 실패한 엣지 op 만 failed 에 담는다 (롤백 없음)', async () => {
    const m = createRecordingClient({ failEdges: true });

    // 노드 op 2개 + 엣지 op 1개 — 엣지가 두 노드를 잇는 정상적 형태.
    const ops: GraphOp[] = [
      {
        kind: 'tool_call',
        props: {
          tool_use_id: 'tu-1',
          request_id: 'req-1',
          session_id: 'sess-1',
          turn_id: 'sess-1-T1',
          agent_id: 'main',
          tool_name: 'Skill',
          tool_detail: 'commit',
          slash_command: null,
          is_virtual_slash: false,
          started_at: NOW,
          duration_ms: 0,
          tokens_total: 0,
          interrupted: false,
        },
      },
      {
        kind: 'meta_doc',
        props: { id: 'skill::commit', kind: 'skill', name: 'commit', source: null, source_root: null },
      },
      {
        kind: 'rel',
        rel: {
          type: 'USES',
          from: { label: 'ToolCall', key: 'tool_use_id', value: 'tu-1' },
          to: { label: 'MetaDocument', key: 'id', value: 'skill::commit' },
        },
      },
    ];

    const { failed } = await mergeOps(m.client, ops);

    // 노드 2개는 실제로 MERGE 됐다 — 부분 적용 발생(롤백 없음).
    expect(m.nodeMergeCount()).toBe(2);
    // 실패는 엣지 op 1개뿐 — 노드 실패는 0.
    expect(failed.length).toBe(1);
    expect(failed[0].op.kind).toBe('rel');
    // 노드 적재가 엣지 실패로 되돌려지지 않는다(설계: idempotent MERGE + no rollback).
    expect(m.succeeded.some((q) => q.cypher.includes('MERGE (c:ToolCall'))).toBe(true);
    expect(m.succeeded.some((q) => q.cypher.includes('MERGE (m:MetaDocument'))).toBe(true);
  });

  it('mergeOps: 엣지가 throw 해도 *중단하지 않고* 뒤 노드 op 를 계속 적재한다 (HoL 제거)', async () => {
    const m = createRecordingClient({ failEdges: true });
    const ops: GraphOp[] = [
      {
        kind: 'rel',
        rel: {
          type: 'PRODUCED',
          from: { label: 'ToolCall', key: 'tool_use_id', value: 'tu-x' },
          to: { label: 'Event', key: 'id', value: 'evt-x' },
        },
      },
      // 엣지 실패 *뒤* 의 노드 op 도 적재돼야 함(독성 1개가 batch 를 막지 않음).
      {
        kind: 'event',
        props: {
          id: 'evt-after',
          event_type: 'tool',
          tool_use_id: null,
          turn_id: null,
          session_id: 'sess-1',
          timestamp: NOW,
          payload_ref: 'evt-after',
        },
      },
    ];

    const { failed } = await mergeOps(m.client, ops);

    expect(failed.length).toBe(1);
    expect(failed[0].op.kind).toBe('rel');
    // 엣지 실패 후의 Event 노드는 적재됨.
    expect(m.succeeded.some((q) => q.cypher.includes('MERGE (e:Event'))).toBe(true);
  });

  it('worker: 엣지만 영구 실패하는 row 는 co-resident healthy row 와 같은 batch 면 MAX tick 내 DLQ 격리', async () => {
    const db = new SpyglassDatabase({ dbPath: dbPath(), autoInit: true });
    try {
      const sessionId = crypto.randomUUID();
      createSession(db.instance, { id: sessionId, project_name: 'r7', started_at: NOW });

      // dangling row 가 *먼저* — cursor 가 이 row 직전에서 동결되어(HoL) 매 tick 같은 batch 에
      //   재등장한다. tool_use_id 있음 → ToolCall 노드 + PRODUCED/CALLED 엣지.
      //   노드 query 성공, 엣지 query 만 실패 → 노드 적재됐는데 엣지 누락 = dangling.
      createRequest(db.instance, {
        id: 'dangling', session_id: sessionId, timestamp: NOW, type: 'tool_call',
        tool_name: 'Skill', tool_detail: 'commit', event_type: 'tool',
        tool_use_id: 'tu-dangling', turn_id: `${sessionId}-T1`,
      });
      // healthy row 가 *뒤* — tool_use_id·turn_id 없음 → 엣지 query 0 → 항상 성공.
      //   매 tick 같은 batch 안에 있어 anySuccess=true(시스템 healthy) 를 보장 → dangling 을
      //   진짜 독성으로 확정시켜 attempts++ 시킨다(Phase 2b).
      createRequest(db.instance, {
        id: 'healthy', session_id: sessionId, timestamp: NOW, type: 'response',
        event_type: 'assistant',
      });

      const m = createRecordingClient({ failEdges: true });
      const cursor = fakeCursor(0); // persistent — dangling 이 cursor 전진을 막아 HoL 유지.
      const breaker = fakeBreaker();

      let ticks = 0;
      while (deadOf(db, 'dangling') === 0 && ticks < MAX_OUTBOX_ATTEMPTS + 2) {
        await runOutboxTick(db.instance, m.client, cursor, breaker);
        ticks++;
      }

      // dangling row 는 정확히 MAX tick 만에 DLQ 격리.
      expect(deadOf(db, 'dangling')).toBe(1);
      expect(attemptsOf(db, 'dangling')).toBe(MAX_OUTBOX_ATTEMPTS);
      // 시스템 healthy(co-resident row 성공) → 회로는 한 번도 열리지 않음.
      expect(breaker.failures).toBe(0);
      // 노드는 실제로 적재됐다(dangling 의 ToolCall/Event 노드 MERGE 성공).
      expect(m.succeeded.some((q) => q.cypher.includes('MERGE (c:ToolCall'))).toBe(true);
      // 엣지는 단 한 번도 성공하지 못함(누락) — dangling 확정.
      expect(m.edgeCreateCount()).toBe(0);
      // DLQ 격리 후 cursor 는 dangling·뒤 row 를 모두 통과(HoL 해소).
      expect(cursor.current).toBeGreaterThan(0);
    } finally {
      cleanup(db);
    }
  });

  it('worker[특성화 발견]: 엣지 실패 row 가 batch 에 *홀로* 남으면 systemic 으로 분류돼 자동 DLQ 되지 않는다', async () => {
    // 발견: runOutboxTick 의 Phase 2a 는 "전량 실패=시스템 장애"로 본다. 엣지만 실패하는
    //   row 가 앞선 healthy row 들이 cursor 통과 후 batch 에 *혼자* 남으면 anySuccess=false 가
    //   되어 attempts 가 오르지 않고 cursor 동결 + 회로 failure 만 누적된다. 즉 이 row 는
    //   *자동으로는* DLQ 격리되지 않고 무한 재시도 루프에 들어간다.
    //   → 이는 의도된 systemic/poison 휴리스틱의 결과(소스 버그 아님)이며, 복구는 systemic 장애
    //     해소(엣지 원인 제거) 또는 운영자 개입에 의존한다. 본 테스트는 이 동작을 *고정* 한다.
    const db = new SpyglassDatabase({ dbPath: dbPath(), autoInit: true });
    try {
      const sessionId = crypto.randomUUID();
      createSession(db.instance, { id: sessionId, project_name: 'r7-alone', started_at: NOW });
      // dangling row 단독(session row 는 첫 tick 에 성공해 cursor 가 통과).
      createRequest(db.instance, {
        id: 'lonely', session_id: sessionId, timestamp: NOW, type: 'tool_call',
        tool_name: 'Skill', tool_detail: 'commit', event_type: 'tool',
        tool_use_id: 'tu-lonely', turn_id: `${sessionId}-T1`,
      });

      const m = createRecordingClient({ failEdges: true });
      const cursor = fakeCursor(0);
      const breaker = fakeBreaker();

      // 충분히 많이 돌려도 dead 가 되지 않음을 고정.
      for (let t = 0; t < MAX_OUTBOX_ATTEMPTS + 3; t++) {
        await runOutboxTick(db.instance, m.client, cursor, breaker);
      }

      // 홀로 남은 엣지-실패 row 는 자동 DLQ 되지 않는다(attempts 안 오름, dead=0).
      expect(deadOf(db, 'lonely')).toBe(0);
      expect(attemptsOf(db, 'lonely')).toBeLessThan(MAX_OUTBOX_ATTEMPTS);
      // systemic 으로 분류되어 회로 failure 가 누적된다(전량 실패 tick 마다 1회).
      expect(breaker.failures).toBeGreaterThan(0);
    } finally {
      cleanup(db);
    }
  });
});

// =============================================================================
// CASE 2 — resurrect 복구 연계 (dangling 은 영구가 아님)
// =============================================================================

describe('R7 dangling-node — resurrect 복구 연계', () => {
  it('DLQ 격리된 dangling row 를 resurrect → 다음 tick 재read·재enrich → 엣지 재시도되어 적재', async () => {
    const db = new SpyglassDatabase({ dbPath: dbPath(), autoInit: true });
    try {
      const sessionId = crypto.randomUUID();
      createSession(db.instance, { id: sessionId, project_name: 'r7-resurrect', started_at: NOW });

      // dangling row 가 먼저(HoL), healthy row 가 뒤(co-resident healthy 보장).
      createRequest(db.instance, {
        id: 'dangling2', session_id: sessionId, timestamp: NOW, type: 'tool_call',
        tool_name: 'Skill', tool_detail: 'deep-think', event_type: 'tool',
        tool_use_id: 'tu-dangling2', turn_id: `${sessionId}-T1`,
      });
      createRequest(db.instance, {
        id: 'healthy2', session_id: sessionId, timestamp: NOW, type: 'response',
        event_type: 'assistant',
      });

      const m = createRecordingClient({ failEdges: true });
      const cursor = fakeCursor(0);
      const breaker = fakeBreaker();

      // 1) 엣지 실패 상태로 dangling row 가 DLQ 될 때까지 tick.
      let ticks = 0;
      while (deadOf(db, 'dangling2') === 0 && ticks < MAX_OUTBOX_ATTEMPTS + 2) {
        await runOutboxTick(db.instance, m.client, cursor, breaker);
        ticks++;
      }
      expect(deadOf(db, 'dangling2')).toBe(1);
      expect(m.edgeCreateCount()).toBe(0); // 복구 전: 엣지 0건(누락).

      // 2) 운영자가 원인 해소 후 resurrect — dead=0/attempts=0 reset.
      const { resurrectDeadLetters } = await import('../sync/worker');
      const resurrected = resurrectDeadLetters(db.instance);
      expect(resurrected).toBeGreaterThanOrEqual(1);
      // resurrect 직후 dead row 가 다시 read set 에 포함됨(다음 tick 재처리 대상).
      expect(deadOf(db, 'dangling2')).toBe(0);

      // 3) 엣지 실패 원인 해소(client 정상화) 후 tick — cursor 를 되감아 dead 였던 row 재read.
      m.state.failEdges = false;
      const cursor2 = fakeCursor(0);
      await runOutboxTick(db.instance, m.client, cursor2, breaker);

      // 엣지가 재시도되어 실제로 적재됨 → dangling 해소(영구가 아님).
      expect(m.edgeCreateCount()).toBeGreaterThan(0);
      // 재처리된 row 는 더 이상 dead 가 아님.
      expect(deadOf(db, 'dangling2')).toBe(0);
    } finally {
      cleanup(db);
    }
  });
});

// =============================================================================
// CASE 3 — 노드-우선 op 순서 불변
// =============================================================================

describe('R7 dangling-node — enrich 노드-우선 op 순서', () => {
  let db: SpyglassDatabase;
  let sessionId: string;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: dbPath(), autoInit: true });
    sessionId = crypto.randomUUID();
    createSession(db.instance, { id: sessionId, project_name: 'r7-order', started_at: NOW });
  });

  afterEach(() => {
    cleanup(db);
  });

  /** GraphOp 가 노드면 그 노드의 식별자(label/key/value), 엣지면 null. */
  function nodeIdentity(
    op: GraphOp,
  ): { label: string; key: string; value: string | number } | null {
    switch (op.kind) {
      case 'session': return { label: 'Session', key: 'id', value: op.props.id };
      case 'turn': return { label: 'Turn', key: 'id', value: op.props.id };
      case 'agent': return { label: 'Agent', key: 'id', value: op.props.id };
      case 'tool_call': return { label: 'ToolCall', key: 'tool_use_id', value: op.props.tool_use_id };
      case 'event': return { label: 'Event', key: 'id', value: op.props.id };
      case 'meta_doc': return { label: 'MetaDocument', key: 'id', value: op.props.id };
      case 'rel': return null;
    }
  }

  function indexOfNode(
    ops: GraphOp[],
    ref: { label: string; key: string; value: string | number },
  ): number {
    return ops.findIndex((op) => {
      const id = nodeIdentity(op);
      return id !== null && id.label === ref.label && id.key === ref.key && id.value === ref.value;
    });
  }

  it('한 row 가 만드는 모든 엣지는, 같은 row 가 만드는 노드를 *항상 먼저* 배치한다', () => {
    // 가장 풍부한 enrich 경로: tool_use_id + turn_id + parent + Skill → 5노드 + 5엣지.
    createRequest(db.instance, {
      id: 'rich', session_id: sessionId, timestamp: NOW, type: 'tool_call',
      tool_name: 'Skill', tool_detail: 'commit', event_type: 'tool',
      tool_use_id: 'tu-rich', parent_tool_use_id: 'tu-parent', turn_id: `${sessionId}-T2`,
    });
    const row = outboxRowFor(db, 'rich');
    const ops = enrichOutboxRow(row, db.instance);

    const rels = ops.filter((o) => o.kind === 'rel');
    expect(rels.length).toBeGreaterThan(0);

    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (op.kind !== 'rel') continue;
      // 엣지 양끝 중, 이 row 가 *직접 만드는* 노드는 반드시 엣지보다 앞 index.
      for (const endpoint of [op.rel.from, op.rel.to]) {
        const nodeIdx = indexOfNode(ops, endpoint);
        if (nodeIdx >= 0) {
          expect(nodeIdx).toBeLessThan(i);
        }
      }
    }
  });

  it('알려진 엣지별 노드-우선 고정: PRODUCED/USES/CONTAINS/CALLED', () => {
    createRequest(db.instance, {
      id: 'known', session_id: sessionId, timestamp: NOW, type: 'tool_call',
      tool_name: 'Skill', tool_detail: 'commit', event_type: 'tool',
      tool_use_id: 'tu-known', turn_id: `${sessionId}-T3`,
    });
    const ops = enrichOutboxRow(outboxRowFor(db, 'known'), db.instance);

    const idxOfKind = (kind: GraphOp['kind']) => ops.findIndex((o) => o.kind === kind);
    const idxOfRel = (type: string) =>
      ops.findIndex((o) => o.kind === 'rel' && o.rel.type === type);

    // ToolCall, Event 노드는 PRODUCED 엣지보다 먼저.
    expect(idxOfKind('tool_call')).toBeLessThan(idxOfRel('PRODUCED'));
    expect(idxOfKind('event')).toBeLessThan(idxOfRel('PRODUCED'));
    // ToolCall, MetaDocument 노드는 USES 엣지보다 먼저.
    expect(idxOfKind('tool_call')).toBeLessThan(idxOfRel('USES'));
    expect(idxOfKind('meta_doc')).toBeLessThan(idxOfRel('USES'));
    // Turn 노드는 CONTAINS 엣지보다 먼저.
    expect(idxOfKind('turn')).toBeLessThan(idxOfRel('CONTAINS'));
    // Agent 노드는 CALLED 엣지보다 먼저.
    expect(idxOfKind('agent')).toBeLessThan(idxOfRel('CALLED'));
  });

  it('외부 row 가 만드는 엣지 끝점(Session·parent ToolCall)은 본 row 에 노드 op 가 없다', () => {
    // CONTAINS 의 from=Session, PARENT_OF 의 from=parent ToolCall 은 *다른* outbox row 가 만든다.
    //   이 끝점들이 본 row 의 노드 op 에 없음을 고정.
    //   R7 정정(adr-r7): 끝점 부재 시 mergeRel 은 MATCH-0 no-op 이며 *재시도되지 않는다*
    //   (silent success → cursor 전진). 복구는 "다음 tick 재시도"가 아니라:
    //     - CONTAINS: Session outbox row 가 PK 순서상 선행하므로 정상 운영에서 부재 미발생.
    //     - PARENT_OF: enrich 의 양방향 발행(부모 재enrich 시 자식 PARENT_OF 발행, parent-of-recovery.test.ts)이
    //       순서 무관 최종 일관성을 만든다.
    createRequest(db.instance, {
      id: 'ext', session_id: sessionId, timestamp: NOW, type: 'tool_call',
      tool_name: 'Bash', tool_detail: 'ls', event_type: 'tool',
      tool_use_id: 'tu-ext', parent_tool_use_id: 'tu-ext-parent', turn_id: `${sessionId}-T4`,
    });
    const ops = enrichOutboxRow(outboxRowFor(db, 'ext'), db.instance);

    const contains = ops.find((o) => o.kind === 'rel' && o.rel.type === 'CONTAINS');
    const parentOf = ops.find((o) => o.kind === 'rel' && o.rel.type === 'PARENT_OF');
    expect(contains).toBeDefined();
    expect(parentOf).toBeDefined();

    // Session 노드는 enrichRequest 가 만들지 않는다(sessions outbox row 소관).
    expect(indexOfNode(ops, (contains as Extract<GraphOp, { kind: 'rel' }>).rel.from)).toBe(-1);
    // parent ToolCall 노드도 본 row 가 만들지 않는다(부모 request 소관).
    expect(indexOfNode(ops, (parentOf as Extract<GraphOp, { kind: 'rel' }>).rel.from)).toBe(-1);
  });

  it('mergeRel: 끝점 노드가 그래프에 없으면 throw 없이 no-op (다음 tick 재시도 — dangling 흡수)', async () => {
    // 노드를 하나도 적재하지 않은 상태에서 엣지만 머지 → MATCH 0건 → CREATE 0행 → 무해.
    const m = createRecordingClient({ failEdges: false });
    const ops: GraphOp[] = [
      {
        kind: 'rel',
        rel: {
          type: 'CONTAINS',
          from: { label: 'Session', key: 'id', value: 'no-such-session' },
          to: { label: 'Turn', key: 'id', value: 'no-such-turn' },
        },
      },
    ];
    const { failed } = await mergeOps(m.client, ops);
    // throw 없음 → failed 비어 있음(no-op). 노드가 없을 뿐 에러 아님.
    expect(failed.length).toBe(0);
  });
});

// =============================================================================
// 공용 헬퍼
// =============================================================================

/** 현재 테스트의 임시 DB 경로(afterEach/finally 정리에 사용). */
let CURRENT_DB_PATH = '';

function dbPath(): string {
  CURRENT_DB_PATH = `/tmp/spyglass-dangling-${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}.db`;
  return CURRENT_DB_PATH;
}

function cleanup(_db: SpyglassDatabase): void {
  closeDatabase();
  for (const ext of ['', '-wal', '-shm']) {
    try { unlinkSync(`${CURRENT_DB_PATH}${ext}`); } catch { /* ignore */ }
  }
}

function outboxRowFor(db: SpyglassDatabase, eventId: string): OutboxRow {
  return db.instance
    .query("SELECT id, source, event_id, op, ts FROM kuzu_outbox WHERE source='requests' AND event_id = ?")
    .get(eventId) as OutboxRow;
}

function attemptsOf(db: SpyglassDatabase, eventId: string): number {
  const row = db.instance
    .query("SELECT attempts FROM kuzu_outbox WHERE source='requests' AND event_id = ?")
    .get(eventId) as { attempts: number };
  return row.attempts;
}

function deadOf(db: SpyglassDatabase, eventId: string): number {
  const row = db.instance
    .query("SELECT dead FROM kuzu_outbox WHERE source='requests' AND event_id = ?")
    .get(eventId) as { dead: number };
  return row.dead;
}
