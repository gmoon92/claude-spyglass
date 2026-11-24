/**
 * 허브 API 함정 2·4 응답 옵션 회귀 가드.
 *
 *  - /api/meta-docs?group=name: (type,name) 당 1행, 호출 수를 더하지 않는다(행마다 복사된 값), source_roots[] 로 접기
 *  - /api/conversations?from=&to=(ms): start·end 대신 쓰고, 섞으면 400
 *  - /api/conversations?fields=summary: 원문 없이 첫 줄 프롬프트·수·토큰·스킬
 *  - 기본 응답은 그대로
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { SpyglassDatabase, createSession, createRequest } from '@spyglass/storage';
import { apiRouter } from '../api';
import { groupMetaDocsByName } from '../routes/meta-docs';

const TEST_DB_PATH = join(tmpdir(), `spyglass-hub-options-${Date.now()}-${process.pid}.db`);
let db: SpyglassDatabase;
const T = Date.UTC(2026, 10, 24, 1, 0);

beforeAll(() => {
  db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
  const d = db.instance;
  createSession(d, { id: 's1', project_name: 'hub', started_at: T });
  createRequest(d, { id: 'p1', session_id: 's1', timestamp: T + 1000, type: 'prompt', tokens_input: 0, tokens_output: 0, tokens_total: 0, duration_ms: 0,
    payload: JSON.stringify({ prompt: '첫 줄 요청\n둘째 줄 상세' }) });
  createRequest(d, { id: 'r1', session_id: 's1', timestamp: T + 2000, type: 'response', tokens_input: 0, tokens_output: 0, tokens_total: 0, duration_ms: 0,
    payload: JSON.stringify({ last_assistant_message: '긴 응답 본문'.repeat(50) }) });
  createRequest(d, { id: 'k1', session_id: 's1', timestamp: T + 1500, type: 'tool_call', tool_name: 'Skill', tool_detail: 'commit', tokens_input: 0, tokens_output: 0, tokens_total: 0, duration_ms: 0 });
  d.run(`INSERT INTO proxy_requests (id, timestamp, method, path, model, tokens_input, tokens_output, session_id)
         VALUES ('x1', ?, 'POST', '/v1/messages', 'claude-opus-5-5', 30, 7, 's1')`, [T + 1800]);
});
afterAll(() => {
  try { db.close(); } catch {}
  for (const ext of ['', '-wal', '-shm']) { try { unlinkSync(TEST_DB_PATH + ext); } catch {} }
});

const call = (p: string) => apiRouter(new Request(`http://x${p}`), db.instance);

describe('groupMetaDocsByName', () => {
  const base = {
    type: 'skill' as const, name: 'commit', source: 'projectSettings' as const, description: 'd', user_invocable: 1,
    invocations: 20, total_tokens: 100, total_duration_ms: 5, last_used_at: 50, first_used_at: 10, first_seen_at: 1, deleted_at: null,
  };
  it('같은 이름의 행을 하나로 접고 호출 수는 더하지 않는다', () => {
    const out = groupMetaDocsByName([
      { ...base, id: 2, source_root: '/toy', file_path: '/toy/x', source_root_exists: false },
      { ...base, id: 1, source_root: '/hub', file_path: '/hub/x', source_root_exists: true },
      { ...base, id: 3, name: 'push', source_root: '/hub', file_path: '/hub/p', invocations: 3, source_root_exists: true },
    ]);
    expect(out).toHaveLength(2);
    const commit = out.find((r) => r.name === 'commit')!;
    expect(commit).toMatchObject({ id: 1, invocations: 20, file_path: '/hub/x', source_roots: ['/toy', '/hub'], deleted_at: null });
    expect(commit.sources).toHaveLength(2);
  });
  it('모든 행이 삭제됐으면 deleted_at 은 가장 늦은 값', () => {
    const [r] = groupMetaDocsByName([
      { ...base, id: 1, source_root: '/a', file_path: null, deleted_at: 5, source_root_exists: true },
      { ...base, id: 2, source_root: '/b', file_path: null, deleted_at: 9, source_root_exists: true },
    ]);
    expect(r.deleted_at).toBe(9);
  });
});

describe('GET /api/meta-docs?group', () => {
  it('group 은 name 만 허용', async () => {
    expect((await call('/api/meta-docs?group=path')).status).toBe(400);
    expect((await call('/api/meta-docs?group=name')).status).toBe(200);
  });
});

describe('GET /api/conversations — from/to·fields=summary', () => {
  it('from·to(ms) 로 조회하면 start·end 와 같은 원문 응답', async () => {
    const res = await call(`/api/conversations?from=${T}&to=${T + 10_000}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ id: string; messages: unknown[] }> };
    expect(body.data[0].id).toBe('s1');
    expect(body.data[0].messages).toHaveLength(2);
  });

  it('start·end 와 from·to 를 섞거나 ms 가 아니면 400', async () => {
    expect((await call(`/api/conversations?from=${T}&to=${T + 1}&start=2026-11-24&end=2026-11-24`)).status).toBe(400);
    expect((await call('/api/conversations?from=2026-11-24&to=2026-11-25')).status).toBe(400);
    expect((await call(`/api/conversations?from=${T}`)).status).toBe(400);
    expect((await call(`/api/conversations?from=${T}&to=${T + 1}&fields=all`)).status).toBe(400);
  });

  it('fields=summary 는 원문 대신 첫 줄 프롬프트·수·토큰·스킬을 준다', async () => {
    const res = await call(`/api/conversations?from=${T}&to=${T + 10_000}&fields=summary`);
    const body = await res.json() as { data: Array<Record<string, any>> };
    const s = body.data[0];
    expect(s).toMatchObject({ id: 's1', project: 'hub', prompt_count: 1, response_count: 1, first_at: T + 1000, last_at: T + 2000 });
    expect(s.prompts).toEqual([{ ts: T + 1000, text: '첫 줄 요청' }]);
    expect(s.tokens).toMatchObject({ requests: 1, input: 30, output: 7, total: 37 });
    expect(s.skills).toEqual([{ name: 'commit', calls: 1 }]);
    expect(s).not.toHaveProperty('messages');
  });
});
