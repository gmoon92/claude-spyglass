/**
 * Projection worker 단위 테스트.
 *
 * 보호:
 *  - runProjectionTick 가 events_v3 → request_view 멱등 upsert.
 *  - watermark advance (last_event_id 가 늘어남).
 *  - R5 격리: 한 projection 실패가 다른 projection 진행을 막지 않음.
 *  - turn_view / agent_chain_view minimal projection.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  runMigrations,
  appendEventV3,
  getProjectionState,
  countRequestView,
  countTurnView,
  countAgentChainView,
} from '@spyglass/storage';
import { runProjectionTick } from '../projection-worker';

function fresh(): Database {
  const db = new Database(':memory:');
  runMigrations(db, false);
  return db;
}

describe('runProjectionTick', () => {
  let db: Database;
  beforeEach(() => { db = fresh(); });
  afterEach(() => { db.close(); });

  it('빈 events_v3 → 처리 0건, watermark 변경 없음', () => {
    const result = runProjectionTick(db, 100);
    expect(result.request_view).toBe(0);
    expect(result.turn_view).toBe(0);
    expect(result.agent_chain_view).toBe(0);

    const state = getProjectionState(db, 'request_view');
    expect(state?.last_event_id).toBe(0);
  });

  it('events_v3 → request_view materialize', () => {
    appendEventV3(db, {
      event_id: 'e1', session_id: 's1', timestamp: 1000,
      event_kind: 'hook_pre_tool', tool_use_id: 'use-1',
      tool_name: 'Bash', payload_json: '{}',
    });
    appendEventV3(db, {
      event_id: 'e2', session_id: 's1', timestamp: 2000,
      event_kind: 'hook_post_tool', tool_use_id: 'use-1',
      tool_name: 'Bash', payload_json: '{}',
    });
    appendEventV3(db, {
      event_id: 'e3', session_id: 's1', timestamp: 3000,
      event_kind: 'hook_prompt', payload_json: '{}',
    });

    const result = runProjectionTick(db, 100);
    expect(result.request_view).toBe(3);
    expect(countRequestView(db)).toBe(3);

    // watermark = 마지막 events_v3.id
    const state = getProjectionState(db, 'request_view');
    expect(state?.last_event_id).toBe(3);
    expect(state?.total_processed).toBe(3);
  });

  it('두 번째 tick 은 새 event 만 처리 (idempotent)', () => {
    appendEventV3(db, {
      event_id: 'e1', session_id: 's1', timestamp: 1000,
      event_kind: 'hook_prompt', payload_json: '{}',
    });
    runProjectionTick(db, 100);
    expect(countRequestView(db)).toBe(1);

    // 새 event 추가
    appendEventV3(db, {
      event_id: 'e2', session_id: 's1', timestamp: 2000,
      event_kind: 'hook_prompt', payload_json: '{}',
    });
    runProjectionTick(db, 100);
    expect(countRequestView(db)).toBe(2);

    const state = getProjectionState(db, 'request_view');
    expect(state?.last_event_id).toBe(2);
  });

  it('hook_system / hook_session_start 등은 request_view 에 들어가지 않음', () => {
    appendEventV3(db, {
      event_id: 'e1', session_id: 's1', timestamp: 1000,
      event_kind: 'hook_system', payload_json: '{}',
    });
    appendEventV3(db, {
      event_id: 'e2', session_id: 's1', timestamp: 2000,
      event_kind: 'hook_session_start', payload_json: '{}',
    });

    const result = runProjectionTick(db, 100);
    expect(result.request_view).toBe(0);   // request_view 변환 0건
    expect(countRequestView(db)).toBe(0);

    // 그래도 watermark 는 advance 했음 (전체 events 본 후)
    const state = getProjectionState(db, 'request_view');
    expect(state?.last_event_id).toBe(2);
  });

  it('turn_id 가 있는 event 는 turn_view 에 등록', () => {
    appendEventV3(db, {
      event_id: 'e1', session_id: 's1', turn_id: 't1', timestamp: 1000,
      event_kind: 'hook_prompt', payload_json: '{}',
    });
    appendEventV3(db, {
      event_id: 'e2', session_id: 's1', turn_id: 't1', timestamp: 2000,
      event_kind: 'hook_post_tool', tool_use_id: 'u1', tool_name: 'Bash',
      payload_json: '{}',
    });

    const result = runProjectionTick(db, 100);
    expect(result.turn_view).toBe(2);
    expect(countTurnView(db)).toBe(1);   // 같은 turn_id 라 1 row 로 합쳐짐
  });

  it('parent_tool_use_id 가 있는 event 는 agent_chain_view 에 edge 등록', () => {
    appendEventV3(db, {
      event_id: 'e1', session_id: 's1', timestamp: 1000,
      event_kind: 'hook_post_tool',
      tool_use_id: 'child-1', parent_tool_use_id: 'agent-1',
      tool_name: 'Read', payload_json: '{}',
    });

    const result = runProjectionTick(db, 100);
    expect(result.agent_chain_view).toBe(1);
    expect(countAgentChainView(db)).toBe(1);
  });
});
