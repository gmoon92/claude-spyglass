/**
 * hooks/spyglass-collect.sh — 허브 환경 태그(hub_env) 부착.
 *
 * 실제 스크립트를 bash 로 실행하고, 로컬 임시 HTTP 서버가 받은 요청을 검사한다.
 * 검증 범위:
 *  - ORCA_TERMINAL_HANDLE·CLAUDE_HUB_SESSION_ROLE 이 payload 의 hub_env 로 실려 간다
 *  - 허용 목록 밖 환경변수(토큰류 포함)는 읽지도 보내지도 않는다
 *  - 두 변수가 없으면 payload 를 원문 그대로 보낸다(재직렬화 없음)
 *  - 이벤트 라우팅(/collect ↔ /events)은 기존과 같다
 *  - JSON 이 아닌 입력도 기존처럼 /collect 로 원문 전달
 *
 * 격리: HOME 을 임시 디렉토리로 바꿔 실제 ~/.spyglass 에 아무것도 쓰지 않는다.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dir, '../../../../../hooks/spyglass-collect.sh');

interface Captured { path: string; body: string }
const received: Captured[] = [];
let waiters: Array<() => void> = [];
let server: ReturnType<typeof Bun.serve>;
let fakeHome: string;

beforeAll(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'spyglass-hook-home-'));
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      received.push({ path: new URL(req.url).pathname, body: await req.text() });
      waiters.splice(0).forEach((w) => w());
      return new Response('{}', { status: 200 });
    },
  });
});
afterAll(() => {
  server.stop(true);
  rmSync(fakeHome, { recursive: true, force: true });
});

/** 스크립트에 stdin 을 넣고 실행한 뒤, 서버가 요청 1건을 받을 때까지 기다린다(전송이 백그라운드라서). */
async function runHook(stdin: string, extraEnv: Record<string, string>): Promise<Captured> {
  const before = received.length;
  const proc = Bun.spawn(['bash', SCRIPT], {
    stdin: new TextEncoder().encode(stdin),
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: fakeHome,
      SPYGLASS_HOST: '127.0.0.1',
      SPYGLASS_PORT: String(server.port),
      SPYGLASS_TIMEOUT: '3',
      ...extraEnv,
    },
  });
  await proc.exited;
  const deadline = Date.now() + 5000;
  while (received.length <= before) {
    if (Date.now() > deadline) throw new Error('hook 요청이 도착하지 않았다');
    await new Promise<void>((resolve) => { waiters.push(resolve); setTimeout(resolve, 100); });
  }
  return received[before];
}

describe('spyglass-collect.sh — hub_env', () => {
  it('허용 목록 두 변수를 hub_env 로 싣고, 목록 밖 변수는 싣지 않는다', async () => {
    const original = { hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: '/work/hub', prompt: '한글 프롬프트' };
    const got = await runHook(JSON.stringify(original), {
      ORCA_TERMINAL_HANDLE: 'term_abc-123',
      CLAUDE_HUB_SESSION_ROLE: 'worker',
      ORCA_AGENT_HOOK_TOKEN: 'super-secret-token',
      ORCA_TAB_ID: 'tab-9',
    });
    expect(got.path).toBe('/collect');
    const body = JSON.parse(got.body);
    expect(body).toMatchObject(original);
    expect(body.hub_env).toEqual({ ORCA_TERMINAL_HANDLE: 'term_abc-123', CLAUDE_HUB_SESSION_ROLE: 'worker' });
    expect(got.body).not.toContain('super-secret-token');
    expect(got.body).not.toContain('tab-9');
  });

  it('한쪽 변수만 있으면 그것만 싣는다', async () => {
    const got = await runHook(
      JSON.stringify({ hook_event_name: 'PostToolUse', session_id: 's2', tool_name: 'Bash' }),
      { CLAUDE_HUB_SESSION_ROLE: 'main' },
    );
    expect(JSON.parse(got.body).hub_env).toEqual({ CLAUDE_HUB_SESSION_ROLE: 'main' });
  });

  it('빈 문자열 변수는 싣지 않는다', async () => {
    const got = await runHook(
      JSON.stringify({ hook_event_name: 'PostToolUse', session_id: 's3' }),
      { ORCA_TERMINAL_HANDLE: '', CLAUDE_HUB_SESSION_ROLE: 'worker' },
    );
    expect(JSON.parse(got.body).hub_env).toEqual({ CLAUDE_HUB_SESSION_ROLE: 'worker' });
  });

  it('두 변수가 모두 없으면 payload 원문을 그대로 보낸다 (hub_env 없음, 재직렬화 없음)', async () => {
    const raw = '{"hook_event_name":"UserPromptSubmit",  "session_id":"s4",\n "prompt":"x"}';
    const got = await runHook(raw, {});
    expect(got.path).toBe('/collect');
    expect(got.body.trim()).toBe(raw);
    expect(got.body).not.toContain('hub_env');
  });

  it('SessionStart 등은 기존처럼 /events 로 가고 hub_env 가 실린다', async () => {
    const got = await runHook(
      JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's5', cwd: '/work/hub' }),
      { ORCA_TERMINAL_HANDLE: 'term_zzz', CLAUDE_HUB_SESSION_ROLE: 'worker' },
    );
    expect(got.path).toBe('/events');
    expect(JSON.parse(got.body).hub_env.ORCA_TERMINAL_HANDLE).toBe('term_zzz');
  });

  it('JSON 이 아닌 입력은 원문 그대로 /collect 로 (기존 동작 유지)', async () => {
    const got = await runHook('not json at all', { ORCA_TERMINAL_HANDLE: 'term_q', CLAUDE_HUB_SESSION_ROLE: 'worker' });
    expect(got.path).toBe('/collect');
    expect(got.body.trim()).toBe('not json at all');
  });
});
