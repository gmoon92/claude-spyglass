/**
 * spyglass_project_root — git 저장소 루트 기준 project_name.
 *
 * 검증 범위:
 *  - takeProjectRoot: 절대 경로 형식만 통과, 제어문자·상대 경로·비문자열은 버림, payload 에서 지움
 *  - projectNameFromCwd: 루트가 있으면 루트의 마지막 세그먼트, 없으면 cwd(기존 동작)
 *  - /collect·/events 두 경로가 루트로 세션 이름을 정함(하위 폴더·워크트리 cwd 여도 같은 프로젝트),
 *    값이 없는 기존 훅 payload 는 지금처럼 cwd 로 정함, claude_events.payload 에는 필드가 남지 않음
 *  - 이미 있는 세션의 project_name 은 바뀌지 않는다
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { SpyglassDatabase, getSessionById, createSession } from '@spyglass/storage';
import { takeProjectRoot } from '../project-root';
import { projectNameFromCwd } from '../session';
import { handleHookHttpRequest } from '../http-entry';
import { eventsCollectHandler } from '../../events';

const TEST_DB_PATH = join(tmpdir(), `spyglass-project-root-${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}.db`);
let db: SpyglassDatabase;

beforeEach(() => { db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true }); });
afterEach(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { unlinkSync(TEST_DB_PATH + suffix); } catch { /* noop */ }
  }
});

const post = (path: string, body: Record<string, unknown>) =>
  new Request(`http://localhost${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const sid = () => `proj-root-${crypto.randomUUID()}`;

describe('takeProjectRoot', () => {
  it('절대 경로를 돌려주고 payload 에서 필드를 지운다', () => {
    const payload: Record<string, unknown> = { hook_event_name: 'Stop', spyglass_project_root: '/work/claude-hub' };
    expect(takeProjectRoot(payload)).toBe('/work/claude-hub');
    expect('spyglass_project_root' in payload).toBe(false);
    expect(payload.hook_event_name).toBe('Stop');
  });

  it('필드가 없으면 null (payload 무변경)', () => {
    const payload: Record<string, unknown> = { hook_event_name: 'Stop' };
    expect(takeProjectRoot(payload)).toBeNull();
    expect(payload).toEqual({ hook_event_name: 'Stop' });
  });

  it.each([
    ['상대 경로', 'work/hub'],
    ['빈 문자열', ''],
    ['개행 포함', '/work/hub\n/etc'],
    ['제어문자 포함', '/work/\u0007hub'],
    ['너무 긺', '/' + 'a'.repeat(1030)],
    ['비문자열(숫자)', 5],
    ['비문자열(객체)', { a: 1 }],
  ])('형식 위반(%s)은 버리고 payload 에서 지운다', (_name, bad) => {
    const payload: Record<string, unknown> = { spyglass_project_root: bad };
    expect(takeProjectRoot(payload)).toBeNull();
    expect('spyglass_project_root' in payload).toBe(false);
  });
});

describe('projectNameFromCwd', () => {
  it('루트가 있으면 루트의 마지막 세그먼트', () => {
    expect(projectNameFromCwd('/work/claude-hub/.claude/.tmp/evidence', '/work/claude-hub')).toBe('claude-hub');
    expect(projectNameFromCwd('/work/x.worktrees/feat-a', '/work/x')).toBe('x');
  });
  it('루트 끝에 / 가 있어도 같다', () => {
    expect(projectNameFromCwd('/a/b', '/work/claude-hub/')).toBe('claude-hub');
  });
  it('루트가 없으면 기존 동작 — cwd 의 마지막 세그먼트, 둘 다 없으면 unknown', () => {
    expect(projectNameFromCwd('/work/claude-hub/sub')).toBe('sub');
    expect(projectNameFromCwd('/work/claude-hub/sub', null)).toBe('sub');
    expect(projectNameFromCwd(undefined)).toBe('unknown');
  });
  it('루트가 "/" 뿐이라 이름이 비면 cwd 로 폴백', () => {
    expect(projectNameFromCwd('/work/app', '/')).toBe('app');
  });
});

describe('수신 경로 통합', () => {
  it('/collect — 하위 폴더 cwd 여도 루트 이름으로 세션이 생기고 payload 필드는 저장되지 않는다', async () => {
    const id = sid();
    const res = await handleHookHttpRequest(post('/collect', {
      hook_event_name: 'UserPromptSubmit', session_id: id, prompt: 'hi',
      cwd: '/work/claude-hub/.claude/.tmp/extensions/evidence',
      spyglass_project_root: '/work/claude-hub',
    }), db);
    expect(res.status).toBe(200);
    expect(getSessionById(db.instance, id)?.project_name).toBe('claude-hub');
  });

  it('/collect — 루트 없는 기존 훅 payload 는 cwd 로 (기존 동작)', async () => {
    const id = sid();
    await handleHookHttpRequest(post('/collect', {
      hook_event_name: 'UserPromptSubmit', session_id: id, prompt: 'hi', cwd: '/work/claude-hub/evidence',
    }), db);
    expect(getSessionById(db.instance, id)?.project_name).toBe('evidence');
  });

  it('/events Stop — 세션이 없으면 루트 이름으로 생성되고 claude_events.payload 에 필드가 없다', async () => {
    const id = sid();
    const res = await eventsCollectHandler(post('/events', {
      hook_event_name: 'Stop', session_id: id, last_assistant_message: '완료',
      cwd: '/work/hub.worktrees/feat-x', spyglass_project_root: '/work/hub',
    }), db.instance);
    expect(res.status).toBe(200);
    expect(getSessionById(db.instance, id)?.project_name).toBe('hub');
    const row = db.instance.query('SELECT payload FROM claude_events WHERE session_id = ?').get(id) as { payload: string };
    expect(row.payload).not.toContain('spyglass_project_root');
    expect(JSON.parse(row.payload)).toMatchObject({ hook_event_name: 'Stop', cwd: '/work/hub.worktrees/feat-x' });
  });

  it('이미 있는 세션의 project_name 은 바뀌지 않는다 (기존 행 보존)', async () => {
    const id = sid();
    createSession(db.instance, { id, project_name: 'old-name', started_at: Date.now() });
    await handleHookHttpRequest(post('/collect', {
      hook_event_name: 'UserPromptSubmit', session_id: id, prompt: 'hi', cwd: '/work/claude-hub',
      spyglass_project_root: '/work/claude-hub',
    }), db);
    expect(getSessionById(db.instance, id)?.project_name).toBe('old-name');
  });

  it('형식 위반 루트는 무시하고 cwd 로 폴백', async () => {
    const id = sid();
    await handleHookHttpRequest(post('/collect', {
      hook_event_name: 'UserPromptSubmit', session_id: id, prompt: 'hi', cwd: '/work/app', spyglass_project_root: 'relative/path',
    }), db);
    expect(getSessionById(db.instance, id)?.project_name).toBe('app');
  });
});
