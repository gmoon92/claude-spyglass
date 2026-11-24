/**
 * 허브 요약 #1 서버 경로 — /events 의 PostToolUseFailure 실시간 기록과 GET /api/meta-docs/usage/daily.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpyglassDatabase } from '@spyglass/storage';
import { eventsCollectHandler } from '../events';
import { apiRouter } from '../api';

const TEST_DB_PATH = join(tmpdir(), `spyglass-meta-usage-${Date.now()}-${process.pid}.db`);
let db: SpyglassDatabase;

beforeAll(() => {
  db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
  db.instance.run("INSERT INTO sessions (id, project_name, started_at) VALUES ('s1', 'hub', 0)");
});
afterAll(() => {
  try { db.close(); } catch {}
  for (const ext of ['', '-wal', '-shm']) { try { unlinkSync(TEST_DB_PATH + ext); } catch {} }
});

const post = (body: object) => eventsCollectHandler(new Request('http://localhost/events', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}), db.instance);

describe('PostToolUseFailure → stats_meta_usage_hourly', () => {
  it('Skill 실패는 +1, Bash 실패·사용자 중단은 무시', async () => {
    await post({ hook_event_name: 'PostToolUseFailure', session_id: 's1', tool_name: 'Skill', tool_input: { skill: 'commit' }, error: 'boom' });
    await post({ hook_event_name: 'PostToolUseFailure', session_id: 's1', tool_name: 'Bash', tool_input: { command: 'ls' }, error: 'boom' });
    await post({ hook_event_name: 'PostToolUseFailure', session_id: 's1', tool_name: 'Skill', tool_input: { skill: 'commit' }, is_interrupt: true });
    const rows = db.instance.query('SELECT kind, name, failures FROM stats_meta_usage_hourly').all();
    expect(rows).toEqual([{ kind: 'skill', name: 'commit', failures: 1 }]);
  });
});

describe('GET /api/meta-docs/usage/daily', () => {
  const call = (q: string) => apiRouter(new Request(`http://x/api/meta-docs/usage/daily${q}`), db.instance);

  it('실패율을 포함한 일자 행을 준다', async () => {
    const res = await call('?tz=Asia/Seoul');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<Record<string, unknown>> };
    expect(body.data[0]).toMatchObject({ kind: 'skill', name: 'commit', calls: 0, failures: 1, failure_rate: 1 });
  });

  it('잘못된 kind·tz·from 은 400', async () => {
    expect((await call('?kind=hook')).status).toBe(400);
    expect((await call('?tz=Mars/Base')).status).toBe(400);
    expect((await call('?from=today')).status).toBe(400);
  });
});
