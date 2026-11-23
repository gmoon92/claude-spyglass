/**
 * /api/projects/aliases — 라우트 계약 + 이름 변경 시나리오 종단 확인.
 *
 * 검증 범위:
 *  - GET/POST/DELETE 의 상태 코드와 응답 모양, 잘못된 입력 400, 없는 별칭 삭제 404
 *  - 등록 직후 기존 조회 API(`/api/meta-docs?project=`, `/api/projects/:name/sessions`, `/api/stats/projects`)가
 *    옛 이름 이력까지 합쳐 응답하고, 삭제하면 원복된다
 *  - `/api/projects/:name/sessions` 같은 기존 라우트와 경로가 겹치지 않는다
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { SpyglassDatabase, createSession, createRequest } from '@spyglass/storage';
import { apiRouter } from '../api';

const SUFFIX = `${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
const TEST_DB_PATH = join(tmpdir(), `spyglass-aliases-${SUFFIX}.db`);
let db: SpyglassDatabase;
const NOW = Date.now() - 60_000;

beforeAll(() => {
  db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
  createSession(db.instance, { id: 'old-s', project_name: 'old-repo', started_at: NOW });
  createSession(db.instance, { id: 'new-s', project_name: 'new-repo', started_at: NOW + 1000 });
  for (const [sid, ts] of [['old-s', NOW + 10], ['new-s', NOW + 1010]] as const) {
    createRequest(db.instance, {
      id: `p-${sid}`, session_id: sid, timestamp: ts, type: 'prompt', turn_id: `T-${sid}`,
      tokens_input: 1, tokens_output: 0, tokens_total: 1,
    });
    createRequest(db.instance, {
      id: `t-${sid}`, session_id: sid, timestamp: ts + 5, type: 'tool_call', turn_id: `T-${sid}`,
      tool_name: 'Skill', tool_detail: 'commit', event_type: 'tool', tool_use_id: `tu-${sid}`,
      tokens_input: 0, tokens_output: 0, tokens_total: 1,
    });
  }
});
afterAll(() => {
  try { db.close(); } catch {}
  try { unlinkSync(TEST_DB_PATH); } catch {}
});

const call = (path: string, init?: RequestInit) => apiRouter(new Request(`http://x${path}`, init), db.instance);
const json = async (res: Response) => await res.json() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
const register = (alias: string, project_name: string, note?: string) =>
  call('/api/projects/aliases', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alias, project_name, note }),
  });

describe('/api/projects/aliases — 관리', () => {
  it('처음엔 빈 목록', async () => {
    const body = await json(await call('/api/projects/aliases'));
    expect(body).toMatchObject({ success: true, data: [], meta: { total: 0 } });
  });

  it('POST 는 등록 후 전체 목록을 돌려준다', async () => {
    const res = await register('old-repo', 'new-repo', '개명');
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data).toEqual([expect.objectContaining({ alias: 'old-repo', project_name: 'new-repo', note: '개명' })]);
    const listed = await json(await call('/api/projects/aliases'));
    expect(listed.meta.total).toBe(1);
  });

  it('잘못된 입력은 400', async () => {
    expect((await register('same', 'same')).status).toBe(400);
    expect((await register('new-repo', 'x')).status).toBe(400); // new-repo 는 이미 대표 이름
    const bad = await call('/api/projects/aliases', { method: 'POST', body: 'not json' });
    expect(bad.status).toBe(400);
    const wrongType = await call('/api/projects/aliases', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alias: 1, project_name: 2 }),
    });
    expect(wrongType.status).toBe(400);
  });

  it('없는 별칭 삭제는 404', async () => {
    expect((await call('/api/projects/aliases/nope', { method: 'DELETE' })).status).toBe(404);
  });
});

describe('등록·삭제가 기존 조회 API 에 미치는 영향', () => {
  const callsFor = async (project: string) => {
    const body = await json(await call(`/api/meta-docs?project=${project}`));
    return (body.data.find((r: { name: string }) => r.name === 'commit')?.invocations ?? 0) as number;
  };
  const sessionIds = async (project: string) =>
    (await json(await call(`/api/projects/${project}/sessions`))).data.map((s: { id: string }) => s.id).sort();

  it('등록돼 있는 동안 — 어느 이름으로 물어도 합산', async () => {
    expect(await callsFor('new-repo')).toBe(2);
    expect(await callsFor('old-repo')).toBe(2);
    expect(await sessionIds('new-repo')).toEqual(['new-s', 'old-s']);
    const stats = await json(await call('/api/stats/projects'));
    const names = stats.data.map((p: { project_name: string }) => p.project_name);
    expect(names).toContain('new-repo');
    expect(names).not.toContain('old-repo');
    expect(stats.data.find((p: { project_name: string }) => p.project_name === 'new-repo').session_count).toBe(2);
  });

  it('삭제하면 원복', async () => {
    const del = await call('/api/projects/aliases/old-repo', { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect((await json(del)).data).toEqual([]);
    expect(await callsFor('new-repo')).toBe(1);
    expect(await sessionIds('new-repo')).toEqual(['new-s']);
  });

  it('/api/projects/:name/sessions 는 별칭 라우트와 겹치지 않는다', async () => {
    const res = await call('/api/projects/aliases/sessions'); // 이름이 "aliases" 인 프로젝트의 세션 목록
    expect(res.status).toBe(200);
    expect((await json(res)).data).toEqual([]);
  });
});
