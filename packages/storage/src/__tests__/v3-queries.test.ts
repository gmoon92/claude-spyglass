/**
 * storage-redesign-v3 query 헬퍼 단위 테스트.
 *
 * 보호:
 *  - appendEventV3 idempotent 동작
 *  - outbox claim / done / release 흐름
 *  - projection_state advance / error 분리 (R5 격리)
 *  - request_view / turn_view / agent_chain_view upsert + read
 *  - sumDescendantTokens 가 depth>0 만 합산
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';
import {
  appendEventV3,
  getEventsAfter,
  getMaxEventId,
  countEventsBySession,
} from '../queries/v3/events-v3';
import {
  enqueueOutboxEvent,
  claimOutboxBatch,
  markOutboxDone,
  releaseOutboxClaim,
  releaseStuckClaims,
  countOutboxPending,
} from '../queries/v3/outbox';
import {
  getAllProjectionState,
  getProjectionState,
  advanceWatermark,
  recordProjectionError,
} from '../queries/v3/projection-state';
import {
  upsertRequestView,
  getRequestViewBySession,
  countRequestView,
} from '../queries/v3/request-view';
import {
  upsertTurnView,
  getTurnViewBySession,
  countTurnView,
} from '../queries/v3/turn-view';
import {
  upsertAgentChainEdge,
  getDescendantsForRoot,
  sumDescendantTokens,
  countAgentChainView,
} from '../queries/v3/agent-chain-view';

function fresh(): Database {
  const db = new Database(':memory:');
  runMigrations(db, false);
  return db;
}

describe('appendEventV3', () => {
  let db: Database;
  beforeEach(() => { db = fresh(); });
  afterEach(() => { db.close(); });

  it('INSERT 시 lastInsertRowid 반환', () => {
    const id = appendEventV3(db, {
      event_id: 'e1',
      session_id: 's1',
      timestamp: 1000,
      event_kind: 'hook_pre_tool',
      payload_json: '{}',
    });
    expect(id).toBeGreaterThan(0);
  });

  it('중복 event_id 는 null 반환 (idempotent)', () => {
    appendEventV3(db, {
      event_id: 'e-dup',
      session_id: 's1',
      timestamp: 1000,
      event_kind: 'hook_pre_tool',
      payload_json: '{}',
    });
    const second = appendEventV3(db, {
      event_id: 'e-dup',
      session_id: 's1',
      timestamp: 2000,
      event_kind: 'hook_post_tool',
      payload_json: '{}',
    });
    expect(second).toBeNull();
    expect(countEventsBySession(db, 's1')).toBe(1);
  });

  it('getEventsAfter 가 watermark 기반 배치를 ASC 로 반환', () => {
    for (let i = 1; i <= 5; i++) {
      appendEventV3(db, {
        event_id: `e${i}`,
        session_id: 's1',
        timestamp: 1000 + i,
        event_kind: 'hook_pre_tool',
        payload_json: '{}',
      });
    }
    const batch = getEventsAfter(db, 2, 10);
    expect(batch.length).toBe(3);
    expect(batch[0].event_id).toBe('e3');
    expect(batch[2].event_id).toBe('e5');
  });

  it('getMaxEventId 가 watermark 비교 base 를 제공', () => {
    expect(getMaxEventId(db)).toBe(0);
    appendEventV3(db, { event_id: 'a', session_id: 's', timestamp: 1, event_kind: 'hook_pre_tool', payload_json: '{}' });
    appendEventV3(db, { event_id: 'b', session_id: 's', timestamp: 2, event_kind: 'hook_pre_tool', payload_json: '{}' });
    expect(getMaxEventId(db)).toBe(2);
  });
});

describe('outbox', () => {
  let db: Database;
  beforeEach(() => { db = fresh(); });
  afterEach(() => { db.close(); });

  it('enqueue 후 claim → done 흐름', () => {
    enqueueOutboxEvent(db, 'e1', 1000);
    enqueueOutboxEvent(db, 'e2', 1001);
    enqueueOutboxEvent(db, 'e3', 1002);

    const claimed = claimOutboxBatch(db, 'worker-1', 2, 5000);
    expect(claimed.length).toBe(2);
    expect(claimed.map((r) => r.event_id).sort()).toEqual(['e1', 'e2']);
    expect(claimed[0].claimed_at).toBe(5000);
    expect(claimed[0].claim_token).toBe('worker-1');

    const counts1 = countOutboxPending(db);
    expect(counts1.available).toBe(1);
    expect(counts1.claimed).toBe(2);

    const done = markOutboxDone(db, claimed.map((r) => r.id));
    expect(done).toBe(2);

    const counts2 = countOutboxPending(db);
    expect(counts2.total).toBe(1);
    expect(counts2.available).toBe(1);
  });

  it('enqueue 중복은 idempotent', () => {
    const a = enqueueOutboxEvent(db, 'e-dup', 1000);
    const b = enqueueOutboxEvent(db, 'e-dup', 2000);
    expect(a).toBe(true);
    expect(b).toBe(false);
    expect(countOutboxPending(db).total).toBe(1);
  });

  it('claim 빈 큐에서 호출 시 빈 배열', () => {
    expect(claimOutboxBatch(db, 'w', 10)).toEqual([]);
  });

  it('releaseOutboxClaim 이 retry_count 증가 + claimed 해제', () => {
    enqueueOutboxEvent(db, 'e1', 1000);
    const claimed = claimOutboxBatch(db, 'w', 1, 2000);
    expect(claimed.length).toBe(1);
    const released = releaseOutboxClaim(db, [claimed[0].id], 'parse error');
    expect(released).toBe(1);
    const counts = countOutboxPending(db);
    expect(counts.available).toBe(1);
    expect(counts.claimed).toBe(0);
  });

  it('releaseStuckClaims 가 오래된 claim 만 release', () => {
    enqueueOutboxEvent(db, 'e1', 1000);
    enqueueOutboxEvent(db, 'e2', 1001);
    claimOutboxBatch(db, 'w', 2, 5000);
    // 6000 시점에 olderThanMs=1000 → cutoff=5000 → "<" 이므로 5000 자체는 미포함
    expect(releaseStuckClaims(db, 1000, 6000)).toBe(0);
    // 7000 시점에 olderThanMs=1000 → cutoff=6000 → 5000 < 6000 이므로 둘 다 release
    expect(releaseStuckClaims(db, 1000, 7000)).toBe(2);
  });
});

describe('projection_state', () => {
  let db: Database;
  beforeEach(() => { db = fresh(); });
  afterEach(() => { db.close(); });

  it('초기 seed 3개', () => {
    const all = getAllProjectionState(db);
    expect(all.map((r) => r.projection_name).sort()).toEqual([
      'agent_chain_view', 'request_view', 'turn_view',
    ]);
  });

  it('advanceWatermark 가 last_event_id / last_advanced_at 갱신 + error clear', () => {
    recordProjectionError(db, 'request_view', 'boom', 100);
    let state = getProjectionState(db, 'request_view');
    expect(state?.last_error).toBe('boom');

    advanceWatermark(db, 'request_view', 50, 5, 200);
    state = getProjectionState(db, 'request_view');
    expect(state?.last_event_id).toBe(50);
    expect(state?.last_advanced_at).toBe(200);
    expect(state?.total_processed).toBe(5);
    expect(state?.last_error).toBeNull();
    expect(state?.last_error_at).toBeNull();
  });

  it('한 projection 의 error 는 다른 projection advance 를 막지 않음 (R5)', () => {
    recordProjectionError(db, 'request_view', 'boom', 100);
    advanceWatermark(db, 'turn_view', 30, 3, 200);

    const rv = getProjectionState(db, 'request_view');
    const tv = getProjectionState(db, 'turn_view');
    expect(rv?.last_error).toBe('boom');
    expect(rv?.last_event_id).toBe(0);  // 진행 안 됨
    expect(tv?.last_error).toBeNull();
    expect(tv?.last_event_id).toBe(30); // 정상 진행
  });

  it('advanceWatermark 가 미등록 projection 을 자동 INSERT', () => {
    advanceWatermark(db, 'experimental_view', 10, 1, 500);
    const state = getProjectionState(db, 'experimental_view');
    expect(state?.last_event_id).toBe(10);
    expect(state?.total_processed).toBe(1);
  });
});

describe('request_view upsert / read', () => {
  let db: Database;
  beforeEach(() => { db = fresh(); });
  afterEach(() => { db.close(); });

  it('upsert + getRequestViewBySession', () => {
    upsertRequestView(db, {
      id: 'r1',
      session_id: 's1',
      timestamp: 1000,
      type: 'tool_call',
      status: 'running',
      tool_name: 'Bash',
      source_event_id: 1,
    });
    upsertRequestView(db, {
      id: 'r2',
      session_id: 's1',
      timestamp: 2000,
      type: 'tool_call',
      status: 'ok',
      tool_name: 'Read',
      source_event_id: 2,
    });
    const rows = getRequestViewBySession(db, 's1');
    expect(rows.length).toBe(2);
    // ORDER BY timestamp DESC
    expect(rows[0].id).toBe('r2');
    expect(rows[1].id).toBe('r1');
  });

  it('같은 id 재upsert 시 REPLACE', () => {
    upsertRequestView(db, {
      id: 'r1', session_id: 's1', timestamp: 1000, type: 'tool_call',
      status: 'running', source_event_id: 1,
    });
    upsertRequestView(db, {
      id: 'r1', session_id: 's1', timestamp: 1000, type: 'tool_call',
      status: 'ok', tokens_total: 999, source_event_id: 5,
    });
    expect(countRequestView(db)).toBe(1);
    const rows = getRequestViewBySession(db, 's1');
    expect(rows[0].status).toBe('ok');
    expect(rows[0].tokens_total).toBe(999);
  });
});

describe('turn_view upsert / read', () => {
  let db: Database;
  beforeEach(() => { db = fresh(); });
  afterEach(() => { db.close(); });

  it('upsert + getTurnViewBySession ORDER BY turn_index ASC', () => {
    upsertTurnView(db, {
      session_id: 's1', turn_id: 't2', turn_index: 2,
      started_at: 2000, source_event_id: 10,
    });
    upsertTurnView(db, {
      session_id: 's1', turn_id: 't1', turn_index: 1,
      started_at: 1000, source_event_id: 5,
    });
    const rows = getTurnViewBySession(db, 's1');
    expect(rows.length).toBe(2);
    expect(rows[0].turn_id).toBe('t1');
    expect(rows[1].turn_id).toBe('t2');
  });

  it('payload_json 보존', () => {
    upsertTurnView(db, {
      session_id: 's1', turn_id: 't1', started_at: 1000, source_event_id: 1,
      payload_json: '{"foo":42}',
    });
    const [row] = getTurnViewBySession(db, 's1');
    expect(row.payload_json).toBe('{"foo":42}');
  });

  it('countTurnView', () => {
    expect(countTurnView(db)).toBe(0);
    upsertTurnView(db, { session_id: 's1', turn_id: 't1', started_at: 1, source_event_id: 1 });
    upsertTurnView(db, { session_id: 's1', turn_id: 't2', started_at: 2, source_event_id: 2 });
    expect(countTurnView(db)).toBe(2);
  });
});

describe('agent_chain_view upsert / read', () => {
  let db: Database;
  beforeEach(() => { db = fresh(); });
  afterEach(() => { db.close(); });

  it('sumDescendantTokens 는 depth>0 만 합산 (root 제외)', () => {
    // root 자기 자신 (depth=0) 토큰은 합산되면 안 됨
    upsertAgentChainEdge(db, {
      root_tool_use_id: 'A', descendant_tool_use_id: 'A', session_id: 's1',
      depth: 0, tokens_total: 100, source_event_id: 1,
    });
    upsertAgentChainEdge(db, {
      root_tool_use_id: 'A', descendant_tool_use_id: 'B', session_id: 's1',
      depth: 1, tokens_total: 50, source_event_id: 2,
    });
    upsertAgentChainEdge(db, {
      root_tool_use_id: 'A', descendant_tool_use_id: 'C', session_id: 's1',
      depth: 2, tokens_total: 30, source_event_id: 3,
    });

    const sum = sumDescendantTokens(db, 'A');
    expect(sum.tokens_total).toBe(80);                 // 50 + 30 (root 100 제외)
    expect(sum.row_count).toBe(2);
  });

  it('getDescendantsForRoot 가 depth ASC 정렬', () => {
    upsertAgentChainEdge(db, {
      root_tool_use_id: 'R', descendant_tool_use_id: 'D2', session_id: 's',
      depth: 2, source_event_id: 1,
    });
    upsertAgentChainEdge(db, {
      root_tool_use_id: 'R', descendant_tool_use_id: 'D1', session_id: 's',
      depth: 1, source_event_id: 2,
    });
    const rows = getDescendantsForRoot(db, 'R');
    expect(rows.map((r) => r.descendant_tool_use_id)).toEqual(['D1', 'D2']);
  });

  it('countAgentChainView', () => {
    expect(countAgentChainView(db)).toBe(0);
    upsertAgentChainEdge(db, {
      root_tool_use_id: 'X', descendant_tool_use_id: 'Y', session_id: 's',
      depth: 1, source_event_id: 1,
    });
    expect(countAgentChainView(db)).toBe(1);
  });
});
