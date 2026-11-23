/**
 * hub_env — 허브 환경 태그 수신·검증·세션 기록 (Migration 069).
 *
 * 검증 범위:
 *  - takeHubEnv: 허용 목록(ORCA_TERMINAL_HANDLE·CLAUDE_HUB_SESSION_ROLE)만 통과, 형식 위반·목록 밖 키는 버림,
 *    꺼낸 뒤 payload 에서 hub_env 를 지움(원본 payload 만 저장되게)
 *  - /collect(handleHookHttpRequest)·/events(eventsCollectHandler) 두 경로가 sessions 에 기록
 *  - 기록은 마지막 값이 이긴다(--resume 으로 다른 터미널에서 이어 열기), 값 없는 이벤트는 기존 값을 지우지 않는다
 *  - 세션 행이 아직 없을 때(SessionStart)는 건너뛰고 다음 이벤트에서 기록
 *  - /api/sessions/:id·/api/sessions/active 응답에 필드가 실린다
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { SpyglassDatabase, getSessionById, createSession, createRequest } from '@spyglass/storage';
import { takeHubEnv, recordSessionHubEnv, resetHubEnvCacheForTest } from '../hub-env';
import { handleHookHttpRequest } from '../http-entry';
import { eventsCollectHandler } from '../../events';
import { apiRouter } from '../../api';

const TEST_DB_PATH = join(tmpdir(), `spyglass-hub-env-${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}.db`);
const HANDLE = 'term_190e1123-557c-42de-9ddd-3b6f0230b190';

let db: SpyglassDatabase;

beforeEach(() => {
  resetHubEnvCacheForTest();
  db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
});
afterEach(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { unlinkSync(TEST_DB_PATH + suffix); } catch { /* noop */ }
  }
});

function post(path: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const sid = () => `hub-env-${crypto.randomUUID()}`;
const tag = (handle: string | undefined, role: string | undefined) => ({
  hub_env: {
    ...(handle !== undefined ? { ORCA_TERMINAL_HANDLE: handle } : {}),
    ...(role !== undefined ? { CLAUDE_HUB_SESSION_ROLE: role } : {}),
  },
});

describe('takeHubEnv — 검증', () => {
  it('허용 목록 두 값을 컬럼 이름으로 돌려주고 payload 에서 hub_env 를 지운다', () => {
    const payload: Record<string, unknown> = { hook_event_name: 'Stop', ...tag(HANDLE, 'worker') };
    expect(takeHubEnv(payload)).toEqual({ orca_terminal: HANDLE, hub_role: 'worker' });
    expect('hub_env' in payload).toBe(false);
    expect(payload.hook_event_name).toBe('Stop');
  });

  it('hub_env 가 없으면 null (payload 무변경)', () => {
    const payload: Record<string, unknown> = { hook_event_name: 'Stop' };
    expect(takeHubEnv(payload)).toBeNull();
    expect(payload).toEqual({ hook_event_name: 'Stop' });
  });

  it('목록 밖 키는 버린다 — 토큰류 환경변수가 섞여 와도 통과하지 않는다', () => {
    const payload: Record<string, unknown> = {
      hub_env: { ORCA_AGENT_HOOK_TOKEN: 'secret', ORCA_TERMINAL_HANDLE: HANDLE, HOME: '/x' },
    };
    const env = takeHubEnv(payload);
    expect(env).toEqual({ orca_terminal: HANDLE });
    expect(JSON.stringify(env)).not.toContain('secret');
  });

  it.each([
    ['공백 포함', 'term x'],
    ['따옴표 포함', 'term_"x"'],
    ['개행 포함', 'term_x\nrm'],
    ['너무 김', 'a'.repeat(129)],
    ['빈 문자열', ''],
  ])('핸들 형식 위반(%s)은 버린다', (_name, bad) => {
    expect(takeHubEnv({ hub_env: { ORCA_TERMINAL_HANDLE: bad } })).toBeNull();
  });

  it('역할은 main·worker 만', () => {
    expect(takeHubEnv({ hub_env: { CLAUDE_HUB_SESSION_ROLE: 'main' } })).toEqual({ hub_role: 'main' });
    expect(takeHubEnv({ hub_env: { CLAUDE_HUB_SESSION_ROLE: 'admin' } })).toBeNull();
  });

  it('hub_env 가 객체가 아니면(문자열·배열·null) 버리고 payload 에서 지운다', () => {
    for (const bad of ['x', ['a'], null, 5]) {
      const payload: Record<string, unknown> = { hub_env: bad };
      expect(takeHubEnv(payload)).toBeNull();
      expect('hub_env' in payload).toBe(false);
    }
  });
});

describe('recordSessionHubEnv — 세션 기록', () => {
  it('세션 행이 없으면 아무것도 하지 않고, 행이 생긴 뒤 다시 부르면 기록된다', () => {
    const id = sid();
    recordSessionHubEnv(db.instance, id, { orca_terminal: HANDLE, hub_role: 'worker' });
    expect(getSessionById(db.instance, id)).toBeNull();

    createSession(db.instance, { id, project_name: 'p', started_at: Date.now() });
    recordSessionHubEnv(db.instance, id, { orca_terminal: HANDLE, hub_role: 'worker' });
    expect(getSessionById(db.instance, id)).toMatchObject({ orca_terminal: HANDLE, hub_role: 'worker' });
  });

  it('마지막 값이 이긴다 — 다른 터미널에서 이어 열면 핸들이 바뀐다', () => {
    const id = sid();
    createSession(db.instance, { id, project_name: 'p', started_at: Date.now() });
    recordSessionHubEnv(db.instance, id, { orca_terminal: 'term_old', hub_role: 'worker' });
    recordSessionHubEnv(db.instance, id, { orca_terminal: 'term_new', hub_role: 'worker' });
    expect(getSessionById(db.instance, id)).toMatchObject({ orca_terminal: 'term_new', hub_role: 'worker' });
  });

  it('값이 없는 필드는 기존 값을 지우지 않는다', () => {
    const id = sid();
    createSession(db.instance, { id, project_name: 'p', started_at: Date.now() });
    recordSessionHubEnv(db.instance, id, { orca_terminal: HANDLE, hub_role: 'worker' });
    recordSessionHubEnv(db.instance, id, { hub_role: 'main' });
    expect(getSessionById(db.instance, id)).toMatchObject({ orca_terminal: HANDLE, hub_role: 'main' });
    recordSessionHubEnv(db.instance, id, null);
    expect(getSessionById(db.instance, id)).toMatchObject({ orca_terminal: HANDLE, hub_role: 'main' });
  });
});

describe('수신 경로 통합', () => {
  it('/collect(UserPromptSubmit) — 세션이 생기면서 태그가 기록된다', async () => {
    const id = sid();
    const res = await handleHookHttpRequest(post('/collect', {
      hook_event_name: 'UserPromptSubmit',
      session_id: id,
      cwd: '/work/hub',
      prompt: 'hello',
      ...tag(HANDLE, 'worker'),
    }), db);
    expect(res.status).toBe(200);
    expect(getSessionById(db.instance, id)).toMatchObject({ orca_terminal: HANDLE, hub_role: 'worker' });
  });

  it('/events — claude_events.payload 에는 hub_env 가 남지 않는다', async () => {
    const id = sid();
    createSession(db.instance, { id, project_name: 'p', started_at: Date.now() });
    const res = await eventsCollectHandler(post('/events', {
      hook_event_name: 'Notification',
      session_id: id,
      cwd: '/work/hub',
      message: 'waiting',
      ...tag(HANDLE, 'main'),
    }), db.instance);
    expect(res.status).toBe(200);
    expect(getSessionById(db.instance, id)).toMatchObject({ orca_terminal: HANDLE, hub_role: 'main' });

    const row = db.instance.query('SELECT payload FROM claude_events WHERE session_id = ?').get(id) as { payload: string };
    expect(row.payload).not.toContain('hub_env');
    expect(row.payload).not.toContain(HANDLE);
    expect(JSON.parse(row.payload)).toMatchObject({ hook_event_name: 'Notification', message: 'waiting' });
  });

  it('/events SessionStart — 세션 행이 없으면 건너뛰고, 이후 /collect 에서 기록된다', async () => {
    const id = sid();
    await eventsCollectHandler(post('/events', {
      hook_event_name: 'SessionStart', session_id: id, cwd: '/work/hub', ...tag(HANDLE, 'worker'),
    }), db.instance);
    expect(getSessionById(db.instance, id)).toBeNull(); // SessionStart 는 세션 행을 만들지 않는다

    await handleHookHttpRequest(post('/collect', {
      hook_event_name: 'UserPromptSubmit', session_id: id, cwd: '/work/hub', prompt: 'hi', ...tag(HANDLE, 'worker'),
    }), db);
    expect(getSessionById(db.instance, id)).toMatchObject({ orca_terminal: HANDLE, hub_role: 'worker' });
  });

  it('태그 없는 이벤트(기존 훅)는 그대로 동작하고 컬럼은 null 이다', async () => {
    const id = sid();
    const res = await handleHookHttpRequest(post('/collect', {
      hook_event_name: 'UserPromptSubmit', session_id: id, cwd: '/work/hub', prompt: 'hi',
    }), db);
    expect(res.status).toBe(200);
    expect(getSessionById(db.instance, id)).toMatchObject({ orca_terminal: null, hub_role: null });
  });
});

describe('API 응답 노출 (추가 필드)', () => {
  it('GET /api/sessions/:id 와 /api/sessions/active 에 orca_terminal·hub_role 이 실린다', async () => {
    const id = sid();
    createSession(db.instance, { id, project_name: 'p', started_at: Date.now() });
    createRequest(db.instance, {
      id: `r-${id}`, session_id: id, timestamp: Date.now(), type: 'prompt', turn_id: 'T1',
      tokens_input: 1, tokens_output: 0, tokens_total: 1,
    });
    recordSessionHubEnv(db.instance, id, { orca_terminal: HANDLE, hub_role: 'worker' });

    const one = await (await apiRouter(new Request(`http://x/api/sessions/${id}`), db.instance)).json() as
      { data: { orca_terminal: string; hub_role: string; project_name: string } };
    expect(one.data).toMatchObject({ orca_terminal: HANDLE, hub_role: 'worker', project_name: 'p' });

    const active = await (await apiRouter(new Request('http://x/api/sessions/active'), db.instance)).json() as
      { data: Array<{ id: string; orca_terminal: string | null; hub_role: string | null }> };
    expect(active.data.find((s) => s.id === id)).toMatchObject({ orca_terminal: HANDLE, hub_role: 'worker' });
  });
});
