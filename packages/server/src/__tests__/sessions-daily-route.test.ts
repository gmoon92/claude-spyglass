/**
 * GET /api/stats/sessions/daily — 파라미터 해석(400)과 응답 모양.
 * 집계 정확성은 storage session-hourly-summary.test.ts 가 맡는다.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { SpyglassDatabase } from '@spyglass/storage';
import { apiRouter } from '../api';

const TEST_DB_PATH = join(tmpdir(), `spyglass-sessions-daily-${Date.now()}-${process.pid}.db`);
let db: SpyglassDatabase;
const TS = Date.UTC(2026, 10, 23, 15, 10); // KST 11-24 00:10

beforeAll(() => {
  db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
  db.instance.run("INSERT INTO sessions (id, project_name, started_at) VALUES ('s1', 'hub', 0)");
  db.instance.run(
    `INSERT INTO proxy_requests (id, timestamp, method, path, model, tokens_input, tokens_output, cache_read_tokens, session_id)
     VALUES ('p1', ?, 'POST', '/v1/messages', 'claude-opus-5-5', 10, 5, 90, 's1')`, [TS]);
});
afterAll(() => {
  try { db.close(); } catch {}
  for (const ext of ['', '-wal', '-shm']) { try { unlinkSync(TEST_DB_PATH + ext); } catch {} }
});

const call = (q: string) => apiRouter(new Request(`http://x/api/stats/sessions/daily${q}`), db.instance);

describe('GET /api/stats/sessions/daily', () => {
  it('tz=Asia/Seoul 로 일자를 자르고 캐시 적중률을 준다', async () => {
    const res = await call('?tz=Asia/Seoul');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<Record<string, unknown>>; meta: { total: number } };
    expect(body.meta.total).toBe(1);
    expect(body.data[0]).toMatchObject({ date: '2026-11-24', session_id: 's1', project_name: 'hub', requests: 1, cache_hit_rate: 0.9 });
  });

  it('잘못된 tz·from 은 400', async () => {
    expect((await call('?tz=Mars/Base')).status).toBe(400);
    expect((await call('?from=yesterday')).status).toBe(400);
  });
});
