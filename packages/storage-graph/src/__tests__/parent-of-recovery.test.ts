/**
 * R7 — PARENT_OF lost-edge 복구 (양방향 발행) 엣지 테스트
 *
 * @description
 *   부모 Agent ToolCall 노드는 PostToolUse 재enrich(event_type='tool') 시점에 생성되는데,
 *   이는 sub-agent 자식 활동 *이후*다(enrich.ts:255-256). 따라서 자식 측 PARENT_OF(enrich.ts:312-320)는
 *   부모 노드 부재 상태에서 실행돼 mergeRel MATCH-0 → CREATE no-op으로 **조용히 영구 유실**된다
 *   (재시도/dead/resurrect 모두 우회 — silent success).
 *
 *   해결: enrichRequest가 ToolCall을 발행할 때 이 ToolCall을 parent로 갖는 기존 자식들에 대해서도
 *   PARENT_OF(parent→child)를 발행한다(양방향). child-side와 합쳐 순서 무관 최종 일관성:
 *   C→P 순서면 부모 재enrich가 엣지를 만든다. 모두 idempotent MERGE라 중복 무해, throw 없음
 *   (worker Phase 2a sync-halt·dead-letter 위험 0). 영구 부재(pre_tool) 부모는 phantom 없이 엣지 없음.
 *
 * @see docs/architecture/stabilization/adr-r7-graph-batch-atomicity.md
 * @see packages/storage-graph/src/sync/enrich.ts (parent-side PARENT_OF)
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { unlinkSync } from 'node:fs';
import { SpyglassDatabase, closeDatabase, createSession, createRequest } from '@spyglass/storage';
import { enrichOutboxRow, type GraphOp, type OutboxRow } from '../sync/enrich';
import { runOutboxTick } from '../sync/worker';
import type { LadybugClient } from '../client';

const NOW = 1778904000000;
let CURRENT_DB_PATH = '';

function dbPath(): string {
  CURRENT_DB_PATH = `/tmp/spyglass-r7po-${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}.db`;
  return CURRENT_DB_PATH;
}
function cleanup(): void {
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

/** 모든 Cypher 를 기록하는 mock — 엣지 CREATE 발행 여부 검증용. */
function recordingClient() {
  const recorded: Array<{ cypher: string; params?: Record<string, unknown> }> = [];
  const client = {
    async query(cypher: string, params?: Record<string, unknown>) {
      recorded.push({ cypher, params });
      return { rows: [], durationMs: 0 };
    },
    async transaction<T>(work: () => Promise<T>): Promise<T> { return work(); },
  };
  return { client: client as unknown as LadybugClient, recorded };
}
const fakeCursor = (start = 0) => ({ current: start, advance(id: number) { this.current = id; } });
const fakeBreaker = () => ({ recordSuccess() {}, recordFailure() {} });

/** ops 에서 특정 from→to 의 PARENT_OF rel 을 찾는다. */
function parentOf(ops: GraphOp[], fromVal: string, toVal: string): GraphOp | undefined {
  return ops.find(
    (o) => o.kind === 'rel' && o.rel.type === 'PARENT_OF'
      && o.rel.from.value === fromVal && o.rel.to.value === toVal,
  );
}

let db: SpyglassDatabase;
let sessionId: string;
beforeEach(() => {
  db = new SpyglassDatabase({ dbPath: dbPath(), autoInit: true });
  sessionId = crypto.randomUUID();
  createSession(db.instance, { id: sessionId, project_name: 'r7-parentof', started_at: NOW });
});
afterEach(() => cleanup());

function mkReq(id: string, props: Record<string, unknown>): void {
  createRequest(db.instance, {
    id, session_id: sessionId, timestamp: NOW, type: 'tool_call', event_type: 'tool',
    ...props,
  } as Parameters<typeof createRequest>[1]);
}

describe('R7 PARENT_OF 양방향 발행 (enrich 레벨)', () => {
  it('부모 ToolCall enrich 가 기존 자식에 대한 PARENT_OF(parent→child)를 발행한다', () => {
    // 자식 먼저 적재(C→P 순서) — 부모 노드 아직 없음.
    mkReq('child', { tool_use_id: 'tu-child', parent_tool_use_id: 'tu-parent', tool_name: 'Bash', turn_id: `${sessionId}-T1` });
    // 부모(top-level Agent ToolCall) 적재 → 재enrich 시 자식 발견.
    mkReq('parent', { tool_use_id: 'tu-parent', tool_name: 'Agent', tool_detail: 'sub', turn_id: `${sessionId}-T1` });

    const ops = enrichOutboxRow(outboxRowFor(db, 'parent'), db.instance);
    expect(parentOf(ops, 'tu-parent', 'tu-child')).toBeDefined();
  });

  it('자식 측(child-side)도 동일 from→to 의 PARENT_OF 를 발행한다 — 순서 무관 복구의 짝', () => {
    mkReq('child', { tool_use_id: 'tu-child', parent_tool_use_id: 'tu-parent', tool_name: 'Bash', turn_id: `${sessionId}-T1` });
    const childOps = enrichOutboxRow(outboxRowFor(db, 'child'), db.instance);
    // child-side: from=parent, to=child (부모 미존재여도 op 자체는 발행됨)
    expect(parentOf(childOps, 'tu-parent', 'tu-child')).toBeDefined();
  });

  it('pre_tool 자식은 제외한다 (ToolCall 노드 미생성 — 자식 PostToolUse 재enrich 때 child-side 가 처리)', () => {
    mkReq('prechild', { tool_use_id: 'tu-prechild', parent_tool_use_id: 'tu-parent', tool_name: 'Bash', event_type: 'pre_tool', turn_id: `${sessionId}-T1` });
    mkReq('parent', { tool_use_id: 'tu-parent', tool_name: 'Agent', tool_detail: 'sub', turn_id: `${sessionId}-T1` });
    const ops = enrichOutboxRow(outboxRowFor(db, 'parent'), db.instance);
    expect(parentOf(ops, 'tu-parent', 'tu-prechild')).toBeUndefined();
  });

  it('여러 자식 모두에 대해 발행한다', () => {
    mkReq('c1', { tool_use_id: 'tu-c1', parent_tool_use_id: 'tu-parent', tool_name: 'Bash', turn_id: `${sessionId}-T1` });
    mkReq('c2', { tool_use_id: 'tu-c2', parent_tool_use_id: 'tu-parent', tool_name: 'Read', turn_id: `${sessionId}-T1` });
    mkReq('parent', { tool_use_id: 'tu-parent', tool_name: 'Agent', tool_detail: 'sub', turn_id: `${sessionId}-T1` });
    const ops = enrichOutboxRow(outboxRowFor(db, 'parent'), db.instance);
    expect(parentOf(ops, 'tu-parent', 'tu-c1')).toBeDefined();
    expect(parentOf(ops, 'tu-parent', 'tu-c2')).toBeDefined();
  });

  it('회귀: 자식이 없는 ToolCall 은 추가 PARENT_OF 를 발행하지 않는다 (일반 케이스 불변)', () => {
    mkReq('solo', { tool_use_id: 'tu-solo', tool_name: 'Bash', turn_id: `${sessionId}-T1` });
    const ops = enrichOutboxRow(outboxRowFor(db, 'solo'), db.instance);
    expect(ops.some((o) => o.kind === 'rel' && o.rel.type === 'PARENT_OF')).toBe(false);
  });

  it('pre_tool 부모는 enrich 빈 배열 — phantom ToolCall/PARENT_OF 미생성 (정확)', () => {
    mkReq('preparent', { tool_use_id: 'tu-pp', tool_name: 'Agent', event_type: 'pre_tool', turn_id: `${sessionId}-T1` });
    const ops = enrichOutboxRow(outboxRowFor(db, 'preparent'), db.instance);
    expect(ops).toEqual([]);
  });
});

describe('R7 PARENT_OF 양방향 발행 (worker tick 통합)', () => {
  it('C→P 순서로 적재돼도 부모 tick 처리 시 PARENT_OF CREATE 가 발행된다', async () => {
    mkReq('child', { tool_use_id: 'tu-child', parent_tool_use_id: 'tu-parent', tool_name: 'Bash', turn_id: `${sessionId}-T1` });
    mkReq('parent', { tool_use_id: 'tu-parent', tool_name: 'Agent', tool_detail: 'sub', turn_id: `${sessionId}-T1` });

    const { client, recorded } = recordingClient();
    // 배치 전체(session+child+parent)를 한 tick 에 처리.
    await runOutboxTick(db.instance, client, fakeCursor(0), fakeBreaker());

    const parentOfCreate = recorded.find(
      (q) => q.cypher.includes('PARENT_OF') && q.cypher.includes('CREATE (a)')
        && q.params?.from_value === 'tu-parent' && q.params?.to_value === 'tu-child',
    );
    expect(parentOfCreate).toBeDefined();
  });
});
