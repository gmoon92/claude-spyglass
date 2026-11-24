/**
 * 세션 요약 API(#3) + turns 범위 파라미터 회귀 가드.
 *
 *  - GET /api/sessions/:id/summary: 메타·토큰(요약 테이블)·스킬/에이전트/명령·컨텍스트·마찰을 한 장으로
 *  - GET /api/sessions/summary: hub_role 필터·limit 검증
 *  - /api/sessions/:id 의 catch-all 에 먹히지 않는다(라우터 순서)
 *  - GET /api/sessions/:id/turns?limit=&since_turn=: 범위 밖 턴을 빼고, 기본 응답은 그대로
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { SpyglassDatabase, createEvent } from '@spyglass/storage';
import { apiRouter } from '../api';

const TEST_DB_PATH = join(tmpdir(), `spyglass-session-summary-${Date.now()}-${process.pid}.db`);
let db: SpyglassDatabase;
const NOW = Date.now();

beforeAll(() => {
  db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
  const d = db.instance;
  d.run(`INSERT INTO sessions (id, project_name, started_at, orca_terminal, hub_role)
         VALUES ('w1', 'hub', ?, 'term_w1', 'worker'), ('m1', 'hub', ?, NULL, 'main')`, [NOW - 60_000, NOW - 120_000]);
  // 턴 3개(prompt) + 스킬·에이전트 호출
  for (let i = 1; i <= 3; i++) {
    d.run(`INSERT INTO requests (id, session_id, timestamp, type, turn_id, event_type, preview)
           VALUES (?, 'w1', ?, 'prompt', ?, 'prompt', ?)`, [`p${i}`, NOW - 50_000 + i * 1000, `t${i}`, `질문 ${i}`]);
  }
  d.run(`INSERT INTO requests (id, session_id, timestamp, type, tool_name, tool_detail, turn_id, event_type)
         VALUES ('s1', 'w1', ?, 'tool_call', 'Skill', 'commit', 't1', 'tool'),
                ('s2', 'w1', ?, 'tool_call', 'Skill', 'commit', 't2', 'tool'),
                ('s3', 'w1', ?, 'tool_call', 'Skill', 'commit', 't2', 'pre_tool'),
                ('a1', 'w1', ?, 'tool_call', 'Agent', 'Explore', 't3', 'tool')`,
    [NOW - 40_000, NOW - 39_000, NOW - 39_500, NOW - 38_000]);
  d.run(`INSERT INTO proxy_requests (id, timestamp, method, path, model, tokens_input, tokens_output, cache_read_tokens, session_id)
         VALUES ('x1', ?, 'POST', '/v1/messages', 'claude-opus-5-5', 10, 5, 90, 'w1')`, [NOW - 30_000]);
  createEvent(d, {
    event_id: 'f1', event_type: 'PostToolUseFailure', session_id: 'w1', cwd: '/hub',
    timestamp: NOW - 20_000, payload: JSON.stringify({ tool_name: 'Bash', error: 'boom' }),
  });
});

afterAll(() => {
  try { db.close(); } catch {}
  for (const ext of ['', '-wal', '-shm']) { try { unlinkSync(TEST_DB_PATH + ext); } catch {} }
});

const call = (p: string) => apiRouter(new Request(`http://x${p}`), db.instance);

describe('GET /api/sessions/:id/summary', () => {
  it('메타·토큰·스킬/에이전트·마찰을 한 장으로 준다(pre_tool 행은 세지 않는다)', async () => {
    const res = await call('/api/sessions/w1/summary');
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: Record<string, any> };
    expect(data).toMatchObject({ session_id: 'w1', orca_terminal: 'term_w1', hub_role: 'worker' });
    expect(data.tokens).toMatchObject({ requests: 1, input: 10, output: 5, cache_read: 90, total: 105, cache_hit_rate: 0.9 });
    expect(data.skills).toEqual([{ name: 'commit', calls: 2 }]);
    expect(data.agents).toEqual([{ type: 'Explore', calls: 1 }]);
    expect(data.failures.tool_failures).toBe(1);
    expect(data.last_activity_at).toBe(NOW - 20_000);
    expect(data).toHaveProperty('context');
  });

  it('없는 세션은 404', async () => {
    expect((await call('/api/sessions/nope/summary')).status).toBe(404);
  });
});

describe('GET /api/sessions/summary', () => {
  it('hub_role 로 거르고 /api/sessions/:id catch-all 에 먹히지 않는다', async () => {
    const res = await call('/api/sessions/summary?hub_role=worker');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ session_id: string }>; meta: { total: number } };
    expect(body.data.map((s) => s.session_id)).toEqual(['w1']);
  });

  it('limit 은 양의 정수만', async () => {
    expect((await call('/api/sessions/summary?limit=0')).status).toBe(400);
    const body = await (await call('/api/sessions/summary?limit=1')).json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });
});

describe('GET /api/sessions/:id/turns — limit·since_turn', () => {
  const turns = async (q: string) =>
    await (await call(`/api/sessions/w1/turns${q}`)).json() as { data: Array<{ turn_index: number }>; meta: Record<string, number> };

  it('기본 응답은 전 턴이고 meta 모양이 바뀌지 않는다', async () => {
    const b = await turns('?payload=0');
    expect(b.data.map((t) => t.turn_index)).toEqual([3, 2, 1]); // 최신 턴 먼저(기존 계약)
    expect(b.meta).toEqual({ total: 3, prologue_count: 0 });
  });

  it('limit 은 가장 최근 N턴, since_turn 은 그 번호 다음 턴부터', async () => {
    expect((await turns('?payload=0&limit=2')).data.map((t) => t.turn_index)).toEqual([3, 2]);
    const s = await turns('?payload=0&since_turn=1');
    expect(s.data.map((t) => t.turn_index)).toEqual([3, 2]);
    expect(s.meta).toMatchObject({ total: 3, since_turn: 1, returned: 2 });
    expect((await turns('?payload=0&since_turn=1&limit=1')).data.map((t) => t.turn_index)).toEqual([3]);
  });

  it('잘못된 값은 400', async () => {
    expect((await call('/api/sessions/w1/turns?limit=-1')).status).toBe(400);
    expect((await call('/api/sessions/w1/turns?since_turn=x')).status).toBe(400);
  });
});
