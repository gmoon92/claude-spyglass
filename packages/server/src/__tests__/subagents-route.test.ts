/**
 * GET /api/stats/subagents — 라우트 파라미터 해석과 응답 모양.
 * 집계 정확성은 storage subagent-usage.test.ts 가 맡고, 여기서는 400 처리·meta·over_cap 노출만 본다.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { SpyglassDatabase } from '@spyglass/storage';
import { apiRouter } from '../api';

const TEST_DB_PATH = join(tmpdir(), `spyglass-subagents-${Date.now()}-${process.pid}.db`);
let db: SpyglassDatabase;

beforeAll(() => {
  db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
  const d = db.instance;
  d.run("INSERT INTO sessions (id, project_name, started_at) VALUES ('s1', 'hub', 1000)");
  d.run(`INSERT INTO requests (id, session_id, timestamp, type, model, agent_id, agent_type)
         VALUES ('r1', 's1', 2000, 'tool_call', 'claude-fable-5-2', 'a1', 'Plan'),
                ('r2', 's1', 3000, 'tool_call', 'claude-haiku-5-5', 'a2', 'Explore')`);
});

afterAll(() => {
  try { db.close(); } catch {}
  for (const ext of ['', '-wal', '-shm']) { try { unlinkSync(TEST_DB_PATH + ext); } catch {} }
});

async function call(query: string): Promise<Response> {
  return apiRouter(new Request(`http://x/api/stats/subagents${query}`), db.instance);
}

describe('GET /api/stats/subagents', () => {
  it('max_tier=opus 면 fable 행에 over_cap=true, meta 에 초과 수', async () => {
    const res = await call('?max_tier=opus');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ agent_type: string; over_cap: boolean | null }>; meta: { over_cap_count: number; max_tier: string } };
    expect(body.meta).toMatchObject({ total: 2, max_tier: 'opus', over_cap_count: 1 });
    expect(body.data.find((r) => r.agent_type === 'Plan')!.over_cap).toBe(true);
    expect(body.data.find((r) => r.agent_type === 'Explore')!.over_cap).toBe(false);
  });

  it('max_tier 없으면 over_cap 은 null', async () => {
    const body = await (await call('')).json() as { data: Array<{ over_cap: boolean | null }> };
    expect(body.data.every((r) => r.over_cap === null)).toBe(true);
  });

  it('from 으로 기간을 거른다', async () => {
    const body = await (await call('?from=2500')).json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it('잘못된 max_tier·from 은 400', async () => {
    expect((await call('?max_tier=gpt')).status).toBe(400);
    expect((await call('?from=2026-11-24')).status).toBe(400);
  });
});
