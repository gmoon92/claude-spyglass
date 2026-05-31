/**
 * parent-of-correction.test.ts — stale PARENT_OF 엣지 교정 (single-parent 불변식)
 *
 * @description
 *   배경: 라이브 hook 추측이 자식 ToolCall 의 부모를 형제 Agent A 로 잘못 귀속하면 그래프엔
 *   PARENT_OF(A→child) 가 적재된다. 이후 Agent sub-transcript 가 도착하면 RDB 의 persistSubagentChildren
 *   가 parent_tool_use_id 를 권위값 B 로 UPDATE 하고 kuzu_outbox(source='requests', op='update') 를
 *   직접 발행한다(persist.ts:387-401, 회귀테스트 subagent-sibling-parent.regression.test.ts).
 *
 *   결함(그래프 한정): 그래프 sync 의 mergeRel 이 CREATE-only 였다 — 'update' 가 흘러와 enrich 가
 *   PARENT_OF(B→child) 를 발행해도 새 엣지만 CREATE 되고 구 엣지 PARENT_OF(A→child) 는 잔존했다.
 *   결과: child 가 A·B 양쪽의 자식으로 *중복* 표시(그래프는 throw-away 캐시라 cold rebuild 로는
 *   치유되나 증분 sync 에서 잔존).
 *
 *   해결(single-parent 불변식 강제): mergeRel 이 PARENT_OF(parent→child) 를 CREATE 하기 전,
 *   같은 child 로 들어오는 *다른* parent 의 PARENT_OF 엣지를 먼저 DELETE 한다. 한 tool call 은
 *   부모가 정확히 1개라는 도메인 불변식과 일치, idempotent, self-healing.
 *
 *   본 파일은 *graph write-path* 를 검증한다 — mergeRel 의 DELETE-then-CREATE 동작을, 실제 PARENT_OF
 *   엣지 집합을 in-memory 로 모델링하는 mock 으로 닫는다(read-only seed-mocks/mock-client 대신 write 모델).
 *
 * @see packages/storage-graph/src/sync/merge.ts (mergeRel single-parent 강제)
 * @see packages/server/src/hook/persist.ts (parent_tool_use_id 교정 + outbox update 발행)
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { unlinkSync } from 'node:fs';
import { SpyglassDatabase, closeDatabase, createSession, createRequest } from '@spyglass/storage';
import { mergeOps } from '../sync/merge';
import { enrichOutboxRow, type OutboxRow } from '../sync/enrich';
import { runOutboxTick } from '../sync/worker';
import type { LadybugClient } from '../client';

const NOW = 1778904000000;

// =============================================================================
// graph-state mock client — PARENT_OF 엣지 집합을 실제로 모델링.
//   mergeRel 의 3개 sub-query (DELETE / 존재체크 count / CREATE) 를 정확히 실행해
//   write-path 의 최종 엣지 상태를 검증 가능하게 한다. 그 외 노드 MERGE·기타 rel 은 no-op.
// =============================================================================

interface ParentEdge {
  from: string; // parent tool_use_id
  to: string; // child tool_use_id
}

function createGraphStateClient(seed: ParentEdge[] = []) {
  const parentOf: ParentEdge[] = [...seed];
  const recorded: Array<{ cypher: string; params?: Record<string, unknown> }> = [];

  const client = {
    async query(cypher: string, params: Record<string, unknown> = {}) {
      recorded.push({ cypher, params });
      const text = cypher.replace(/\s+/g, ' ').trim();
      const fromV = params.from_value as string | undefined;
      const toV = params.to_value as string | undefined;

      // PARENT_OF DELETE — single-parent 강제: 같은 child 로 들어오는 다른 parent 제거.
      if (/-\[r:PARENT_OF]->/.test(text) && /\bDELETE\b/i.test(text)) {
        for (let i = parentOf.length - 1; i >= 0; i--) {
          if (parentOf[i].to === toV && parentOf[i].from !== fromV) parentOf.splice(i, 1);
        }
        return { rows: [], durationMs: 0 };
      }

      // PARENT_OF 존재체크 — count.
      if (/-\[r:PARENT_OF]->/.test(text) && /RETURN count\(r\)/i.test(text)) {
        const cnt = parentOf.filter((e) => e.from === fromV && e.to === toV).length;
        return { rows: [{ cnt }], durationMs: 0 };
      }

      // PARENT_OF CREATE.
      if (/-\[r:PARENT_OF]->/.test(text) && /CREATE \(a\)/.test(text)) {
        if (!parentOf.some((e) => e.from === fromV && e.to === toV)) {
          parentOf.push({ from: fromV as string, to: toV as string });
        }
        return { rows: [], durationMs: 0 };
      }

      // 그 외 (노드 MERGE, PRODUCED/CALLED/USES/CONTAINS 등) — count 패턴이면 0, 아니면 no-op.
      if (/RETURN count\(r\)/i.test(text)) return { rows: [{ cnt: 0 }], durationMs: 0 };
      return { rows: [], durationMs: 0 };
    },
    async transaction<T>(work: () => Promise<T>): Promise<T> {
      return work();
    },
  };

  return {
    client: client as unknown as LadybugClient,
    recorded,
    parentsOf(child: string): string[] {
      return parentOf.filter((e) => e.to === child).map((e) => e.from);
    },
    hasEdge(from: string, to: string): boolean {
      return parentOf.some((e) => e.from === from && e.to === to);
    },
    edgeCount(): number {
      return parentOf.length;
    },
  };
}

const fakeCursor = (start = 0) => ({ current: start, advance(id: number) { this.current = id; } });
const fakeBreaker = () => ({ recordSuccess() {}, recordFailure() {} });

// =============================================================================
// 테스트 하네스 — 고유 임시 DB.
// =============================================================================

let CURRENT_DB_PATH = '';
function dbPath(): string {
  CURRENT_DB_PATH = `/tmp/spyglass-poc-${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}.db`;
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
    .query("SELECT id, source, event_id, op, ts FROM kuzu_outbox WHERE source='requests' AND event_id = ? ORDER BY id DESC")
    .get(eventId) as OutboxRow;
}

/** persist.ts 의 교정 경로를 그대로 모사 — parent 를 권위값으로 UPDATE + outbox 'update' 발행. */
function correctParentAndEmitUpdate(db: SpyglassDatabase, childRequestId: string, newParent: string): void {
  db.instance.run('UPDATE requests SET parent_tool_use_id = ? WHERE id = ?', [newParent, childRequestId]);
  db.instance.run("INSERT INTO kuzu_outbox(source, event_id, op) VALUES ('requests', ?, 'update')", [childRequestId]);
}

let db: SpyglassDatabase;
let sessionId: string;
beforeEach(() => {
  db = new SpyglassDatabase({ dbPath: dbPath(), autoInit: true });
  sessionId = crypto.randomUUID();
  createSession(db.instance, { id: sessionId, project_name: 'poc-correction', started_at: NOW });
});
afterEach(() => cleanup());

function mkReq(id: string, props: Record<string, unknown>): void {
  createRequest(db.instance, {
    id, session_id: sessionId, timestamp: NOW, type: 'tool_call', event_type: 'tool',
    ...props,
  } as Parameters<typeof createRequest>[1]);
}

// =============================================================================
// 핵심 — 교정 시나리오 (Red → Green)
// =============================================================================

describe('PARENT_OF 교정 — single-parent 불변식 (graph write-path)', () => {
  it('RDB 가 A→B 로 교정 + outbox update 발행 후 sync 하면 그래프에 B→child 존재 AND A→child 부재', async () => {
    // 자식 + 두 형제 부모 A, B. 라이브 추측이 A 로 오귀속했다고 가정.
    mkReq('child', { tool_use_id: 'tu-child', parent_tool_use_id: 'tu-A', tool_name: 'Bash', turn_id: `${sessionId}-T1` });
    mkReq('parentA', { tool_use_id: 'tu-A', tool_name: 'Agent', tool_detail: 'sub-a', turn_id: `${sessionId}-T1` });
    mkReq('parentB', { tool_use_id: 'tu-B', tool_name: 'Agent', tool_detail: 'sub-b', turn_id: `${sessionId}-T1` });

    // 그래프엔 이미 구 엣지 A→child 가 적재돼 있다(이전 sync 결과).
    const g = createGraphStateClient([{ from: 'tu-A', to: 'tu-child' }]);
    expect(g.hasEdge('tu-A', 'tu-child')).toBe(true);

    // RDB 교정: parent_tool_use_id A→B + outbox 'update' 발행(persist.ts 모사).
    correctParentAndEmitUpdate(db, 'child', 'tu-B');

    // 교정 outbox row 를 enrich → merge.
    const updateRow = outboxRowFor(db, 'child');
    expect(updateRow.op).toBe('update');
    const ops = enrichOutboxRow(updateRow, db.instance);
    await mergeOps(g.client, ops);

    // 단언: B→child 존재 AND A→child 부재 — single-parent 불변식.
    expect(g.hasEdge('tu-B', 'tu-child')).toBe(true);
    expect(g.hasEdge('tu-A', 'tu-child')).toBe(false);
    expect(g.parentsOf('tu-child')).toEqual(['tu-B']);
  });

  it('worker tick 통합: 교정 batch 처리 후 child 는 단 하나의 부모(B)만 갖는다', async () => {
    mkReq('child', { tool_use_id: 'tu-child', parent_tool_use_id: 'tu-A', tool_name: 'Bash', turn_id: `${sessionId}-T1` });
    mkReq('parentA', { tool_use_id: 'tu-A', tool_name: 'Agent', tool_detail: 'sub-a', turn_id: `${sessionId}-T1` });
    mkReq('parentB', { tool_use_id: 'tu-B', tool_name: 'Agent', tool_detail: 'sub-b', turn_id: `${sessionId}-T1` });

    // 그래프 구 엣지 A→child 선적재.
    const g = createGraphStateClient([{ from: 'tu-A', to: 'tu-child' }]);

    // 교정.
    correctParentAndEmitUpdate(db, 'child', 'tu-B');

    // 전체 outbox 를 tick 으로 처리(insert 들 + update).
    await runOutboxTick(db.instance, g.client, fakeCursor(0), fakeBreaker());

    expect(g.parentsOf('tu-child')).toEqual(['tu-B']);
    expect(g.hasEdge('tu-A', 'tu-child')).toBe(false);
  });

  it('멱등: 같은 교정을 두 번 sync 해도 B→child 1개만 유지(중복 엣지·재추가 없음)', async () => {
    mkReq('child', { tool_use_id: 'tu-child', parent_tool_use_id: 'tu-A', tool_name: 'Bash', turn_id: `${sessionId}-T1` });
    mkReq('parentB', { tool_use_id: 'tu-B', tool_name: 'Agent', tool_detail: 'sub-b', turn_id: `${sessionId}-T1` });

    const g = createGraphStateClient([{ from: 'tu-A', to: 'tu-child' }]);
    correctParentAndEmitUpdate(db, 'child', 'tu-B');
    const ops = enrichOutboxRow(outboxRowFor(db, 'child'), db.instance);

    await mergeOps(g.client, ops);
    await mergeOps(g.client, ops); // 두 번째 재실행 — 멱등이어야.

    expect(g.parentsOf('tu-child')).toEqual(['tu-B']);
    expect(g.edgeCount()).toBe(1);
  });

  it('self-healing: 그래프에 stale A→child 만 있고 B→child 없는 상태에서 교정 sync 가 단일부모로 수렴', async () => {
    mkReq('child', { tool_use_id: 'tu-child', parent_tool_use_id: 'tu-A', tool_name: 'Read', turn_id: `${sessionId}-T1` });
    mkReq('parentB', { tool_use_id: 'tu-B', tool_name: 'Agent', tool_detail: 'sub-b', turn_id: `${sessionId}-T1` });

    // B 노드 없을 수도 있는 상황 시뮬레이션 — 그래프는 A→child 만.
    const g = createGraphStateClient([{ from: 'tu-A', to: 'tu-child' }]);
    correctParentAndEmitUpdate(db, 'child', 'tu-B');

    const ops = enrichOutboxRow(outboxRowFor(db, 'child'), db.instance);
    await mergeOps(g.client, ops);

    // 한 번의 sync 로 stale 제거 + 정답 적재 — 운영자 개입/rebuild 불필요.
    expect(g.parentsOf('tu-child')).toEqual(['tu-B']);
  });

  it('회귀: 정상(교정 없는) PARENT_OF 발행은 기존 정답 부모를 보존한다', async () => {
    // 처음부터 올바른 부모 B 로 적재 — 교정 없음. 기존 동작 불변 확인.
    mkReq('child', { tool_use_id: 'tu-child', parent_tool_use_id: 'tu-B', tool_name: 'Bash', turn_id: `${sessionId}-T1` });
    mkReq('parentB', { tool_use_id: 'tu-B', tool_name: 'Agent', tool_detail: 'sub-b', turn_id: `${sessionId}-T1` });

    const g = createGraphStateClient([]); // 빈 그래프.
    const ops = enrichOutboxRow(outboxRowFor(db, 'child'), db.instance);
    await mergeOps(g.client, ops);

    expect(g.hasEdge('tu-B', 'tu-child')).toBe(true);
    expect(g.parentsOf('tu-child')).toEqual(['tu-B']);
  });

  it('회귀: 서로 다른 child 의 PARENT_OF 는 간섭하지 않는다(child 키 한정 삭제)', async () => {
    // 같은 부모 B 가 child1, child2 를 갖는다. child1 교정이 child2 엣지를 지우면 안 됨.
    mkReq('child1', { tool_use_id: 'tu-c1', parent_tool_use_id: 'tu-A', tool_name: 'Bash', turn_id: `${sessionId}-T1` });
    mkReq('parentB', { tool_use_id: 'tu-B', tool_name: 'Agent', tool_detail: 'sub-b', turn_id: `${sessionId}-T1` });

    // 그래프: A→c1 (stale), B→c2 (무관, 보존돼야).
    const g = createGraphStateClient([
      { from: 'tu-A', to: 'tu-c1' },
      { from: 'tu-B', to: 'tu-c2' },
    ]);
    correctParentAndEmitUpdate(db, 'child1', 'tu-B');

    const ops = enrichOutboxRow(outboxRowFor(db, 'child1'), db.instance);
    await mergeOps(g.client, ops);

    expect(g.hasEdge('tu-B', 'tu-c1')).toBe(true);
    expect(g.hasEdge('tu-A', 'tu-c1')).toBe(false);
    expect(g.hasEdge('tu-B', 'tu-c2')).toBe(true); // 무관 child 엣지 보존.
  });
});
