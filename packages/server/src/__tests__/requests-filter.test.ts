/**
 * Requests Date Range Filter Tests
 *
 * @description /api/requests fromTs/toTs 날짜 범위 필터 경계값 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SpyglassDatabase, createSession, createRequest } from '@spyglass/storage';
import { apiRouter } from '../api';

const BASE_TS = 1_000_000_000_000;

let testCounter = 0;
function testDbPath() {
  return `/tmp/spyglass-requests-filter-test-${Date.now()}-${++testCounter}.db`;
}

function makeSession(db: SpyglassDatabase, id: string, startedAt: number) {
  createSession(db.instance, { id, project_name: 'test', started_at: startedAt });
}

function makeRequest(db: SpyglassDatabase, id: string, sessionId: string, ts: number) {
  createRequest(db.instance, {
    id,
    session_id: sessionId,
    timestamp: ts,
    type: 'prompt',
    tokens_input: 10,
    tokens_output: 5,
    tokens_total: 15,
    duration_ms: 100,
  });
}

describe('GET /api/requests — date range filter', () => {
  let db: SpyglassDatabase;
  let dbPath: string;

  beforeEach(() => {
    dbPath = testDbPath();
    db = new SpyglassDatabase({ dbPath, autoInit: true });
    makeSession(db, 's1', BASE_TS);
    makeRequest(db, 'r1', 's1', BASE_TS + 1000);
    makeRequest(db, 'r2', 's1', BASE_TS + 2000);
    makeRequest(db, 'r3', 's1', BASE_TS + 3000);
  });

  afterEach(() => {
    try { db.instance.close(); } catch {}
    try { require('fs').unlinkSync(dbPath); } catch {}
  });

  it('파라미터 없음 — 전체 반환', async () => {
    const res = await apiRouter(new Request('http://localhost/api/requests'), db.instance);
    const body = await res.json() as { success: boolean; data: unknown[] };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.length).toBe(3);
  });

  it('from 파라미터 — 해당 시각 이후만 반환', async () => {
    const url = `http://localhost/api/requests?from=${BASE_TS + 2000}`;
    const res = await apiRouter(new Request(url), db.instance);
    const body = await res.json() as { success: boolean; data: Array<{ id: string }> };
    expect(res.status).toBe(200);
    const ids = body.data.map(r => r.id);
    expect(ids).toContain('r2');
    expect(ids).toContain('r3');
    expect(ids).not.toContain('r1');
  });

  it('to 파라미터 — 해당 시각 이전만 반환', async () => {
    const url = `http://localhost/api/requests?to=${BASE_TS + 2000}`;
    const res = await apiRouter(new Request(url), db.instance);
    const body = await res.json() as { success: boolean; data: Array<{ id: string }> };
    expect(res.status).toBe(200);
    const ids = body.data.map(r => r.id);
    expect(ids).toContain('r1');
    expect(ids).toContain('r2');
    expect(ids).not.toContain('r3');
  });

  it('from+to 범위 내 요청만 반환', async () => {
    const url = `http://localhost/api/requests?from=${BASE_TS + 1500}&to=${BASE_TS + 2500}`;
    const res = await apiRouter(new Request(url), db.instance);
    const body = await res.json() as { success: boolean; data: Array<{ id: string }> };
    expect(res.status).toBe(200);
    const ids = body.data.map(r => r.id);
    expect(ids).toEqual(['r2']);
  });

  it('범위 밖이면 빈 배열 반환', async () => {
    const url = `http://localhost/api/requests?from=${BASE_TS + 9000}`;
    const res = await apiRouter(new Request(url), db.instance);
    const body = await res.json() as { success: boolean; data: unknown[] };
    expect(res.status).toBe(200);
    expect(body.data.length).toBe(0);
  });

  it('limit 파라미터 적용', async () => {
    const url = `http://localhost/api/requests?limit=2`;
    const res = await apiRouter(new Request(url), db.instance);
    const body = await res.json() as { success: boolean; data: unknown[] };
    expect(res.status).toBe(200);
    expect(body.data.length).toBe(2);
  });
});
