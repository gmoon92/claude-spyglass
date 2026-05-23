/**
 * /api/projection-lag 회귀 테스트.
 *
 * 보호:
 *  - 빈 DB → projections 3개 (seed), lag_ms=0, pending=0
 *  - events_v3 추가 후 worker tick 전 → pending > 0
 *  - worker tick 후 → pending=0, lag_ms 작음
 *  - 응답 shape SSoT (name, pending, lag_ms, last_error 등)
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  runMigrations,
  appendEventV3,
  enqueueOutboxEvent,
} from '@spyglass/storage';
import { projectionLagRouter } from '../projection-lag';
import { runProjectionTick } from '../../runtime/projection-worker';

function fresh(): Database {
  const db = new Database(':memory:');
  runMigrations(db, false);
  return db;
}

interface ProjectionLagData {
  now_ms: number;
  max_event_id: number;
  outbox: { available: number; claimed: number; total: number };
  projections: Array<{
    name: string;
    last_event_id: number;
    pending: number;
    lag_ms: number;
    total_processed: number;
    last_error: string | null;
    last_error_at: number | null;
  }>;
}

async function callAsync(db: Database): Promise<{ status: number; body: { success: boolean; data: ProjectionLagData } }> {
  const req = new Request('http://test/api/projection-lag', { method: 'GET' });
  const url = new URL(req.url);
  const res = projectionLagRouter(req, db, url, url.pathname, req.method);
  if (!res) throw new Error('router returned null');
  const body = (await res.json()) as { success: boolean; data: ProjectionLagData };
  return { status: res.status, body };
}

describe('/api/projection-lag', () => {
  let db: Database;
  beforeEach(() => { db = fresh(); });
  afterEach(() => { db.close(); });

  it('빈 DB 에서 seed 3개 projection 반환, pending=0', async () => {
    const { status, body } = await callAsync(db);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.max_event_id).toBe(0);
    expect(body.data.outbox.total).toBe(0);
    expect(body.data.projections.length).toBe(3);
    const names = body.data.projections.map((p) => p.name).sort();
    expect(names).toEqual(['agent_chain_view', 'request_view', 'turn_view']);
    for (const p of body.data.projections) {
      expect(p.pending).toBe(0);
      expect(p.lag_ms).toBe(0);                    // last_advanced_at=0 → fresh
      expect(p.last_error).toBeNull();
    }
  });

  it('events_v3 추가 후 (worker 실행 전): pending > 0', async () => {
    appendEventV3(db, {
      event_id: 'e1', session_id: 's1', timestamp: 1000,
      event_kind: 'hook_prompt', payload_json: '{}',
    });
    appendEventV3(db, {
      event_id: 'e2', session_id: 's1', timestamp: 2000,
      event_kind: 'hook_prompt', payload_json: '{}',
    });
    enqueueOutboxEvent(db, 'e1', 1500);
    enqueueOutboxEvent(db, 'e2', 2500);

    const { body } = await callAsync(db);
    expect(body.data.max_event_id).toBe(2);
    expect(body.data.outbox.total).toBe(2);
    expect(body.data.outbox.available).toBe(2);
    for (const p of body.data.projections) {
      expect(p.pending).toBe(2);
    }
  });

  it('worker tick 후: pending=0', async () => {
    appendEventV3(db, {
      event_id: 'e1', session_id: 's1', timestamp: 1000,
      event_kind: 'hook_prompt', payload_json: '{}',
    });
    runProjectionTick(db, 100);

    const { body } = await callAsync(db);
    const rv = body.data.projections.find((p) => p.name === 'request_view')!;
    expect(rv.pending).toBe(0);
    expect(rv.last_event_id).toBe(1);
    expect(rv.last_error).toBeNull();
  });

  it('GET 외 method 는 매칭되지 않음', () => {
    const req = new Request('http://test/api/projection-lag', { method: 'POST' });
    const url = new URL(req.url);
    const res = projectionLagRouter(req, db, url, url.pathname, req.method);
    expect(res).toBeNull();
  });

  it('다른 path 는 매칭되지 않음', () => {
    const req = new Request('http://test/api/other', { method: 'GET' });
    const url = new URL(req.url);
    const res = projectionLagRouter(req, db, url, url.pathname, req.method);
    expect(res).toBeNull();
  });
});
