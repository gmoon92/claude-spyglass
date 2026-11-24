/**
 * hooks/spyglass-collect.sh — spyglass_project_root 부착 (git 저장소 루트).
 *
 * 실제 스크립트를 bash 로 실행하고, 로컬 임시 HTTP 서버가 받은 요청을 검사한다.
 * 임시 git 저장소를 만들어 확인한다: 일반 저장소의 하위 폴더, 워크트리(원본 저장소 루트가 나와야 한다),
 * git 이 아닌 폴더, 존재하지 않는 cwd.
 *
 * 격리: HOME·저장소 모두 임시 디렉토리. 실제 ~/.spyglass 나 이 저장소에는 아무것도 쓰지 않는다.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dir, '../../../../../hooks/spyglass-collect.sh');

const received: Array<{ path: string; body: string }> = [];
let waiters: Array<() => void> = [];
let server: ReturnType<typeof Bun.serve>;
let base: string;          // 임시 작업 디렉토리(심볼릭 링크 해석 완료 — macOS /var → /private/var)
let repoRoot: string;      // 일반 저장소 루트  (<base>/my-repo)
let worktreeDir: string;   // 그 저장소의 워크트리 (<base>/my-repo.worktrees/feat-x)
let plainDir: string;      // git 이 아닌 폴더

const git = (cwd: string, ...args: string[]) => {
  const r = Bun.spawnSync(['git', '-C', cwd, ...args], {
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.toString()}`);
};

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'spyglass-hook-root-')));
  repoRoot = join(base, 'my-repo');
  mkdirSync(join(repoRoot, 'sub', 'deeper'), { recursive: true });
  git(repoRoot, 'init', '-q');
  writeFileSync(join(repoRoot, 'a.txt'), 'x');
  git(repoRoot, 'add', 'a.txt');
  git(repoRoot, 'commit', '-q', '-m', 'init');
  worktreeDir = join(base, 'my-repo.worktrees', 'feat-x');
  mkdirSync(join(base, 'my-repo.worktrees'), { recursive: true });
  git(repoRoot, 'worktree', 'add', '-q', '-b', 'feat/x', worktreeDir);
  plainDir = join(base, 'plain');
  mkdirSync(plainDir);

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
  rmSync(base, { recursive: true, force: true });
});

/** payload 를 스크립트에 넣고 서버가 받은 본문을 JSON 으로 돌려준다. */
async function send(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const before = received.length;
  const proc = Bun.spawn(['bash', SCRIPT], {
    stdin: new TextEncoder().encode(JSON.stringify(payload)),
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: base,
      SPYGLASS_HOST: '127.0.0.1',
      SPYGLASS_PORT: String(server.port),
      SPYGLASS_TIMEOUT: '3',
    },
  });
  await proc.exited;
  const deadline = Date.now() + 5000;
  while (received.length <= before) {
    if (Date.now() > deadline) throw new Error('hook 요청이 도착하지 않았다');
    await new Promise<void>((r) => { waiters.push(r); setTimeout(r, 100); });
  }
  return JSON.parse(received[before].body);
}

const base_payload = { hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: 'hi' };

describe('spyglass-collect.sh — spyglass_project_root', () => {
  it('저장소 루트에서 열면 그 루트', async () => {
    expect((await send({ ...base_payload, cwd: repoRoot })).spyglass_project_root).toBe(repoRoot);
  });

  it('하위 폴더에서 열어도 저장소 루트', async () => {
    expect((await send({ ...base_payload, cwd: join(repoRoot, 'sub', 'deeper') })).spyglass_project_root).toBe(repoRoot);
  });

  it('워크트리에서 열면 워크트리 폴더가 아니라 원본 저장소 루트', async () => {
    expect((await send({ ...base_payload, cwd: worktreeDir })).spyglass_project_root).toBe(repoRoot);
  });

  it('git 저장소가 아니면 필드를 붙이지 않고 payload 원문 그대로', async () => {
    const body = await send({ ...base_payload, cwd: plainDir });
    expect('spyglass_project_root' in body).toBe(false);
    expect(body).toEqual({ ...base_payload, cwd: plainDir });
  });

  it('존재하지 않는 cwd·상대 경로·cwd 없음도 필드 없이 정상 전송', async () => {
    for (const cwd of [join(base, 'nope'), 'relative/dir', undefined]) {
      const body = await send(cwd === undefined ? { ...base_payload } : { ...base_payload, cwd });
      expect('spyglass_project_root' in body).toBe(false);
      expect(body.prompt).toBe('hi');
    }
  });

  it('기존 필드는 그대로이고 SessionStart 는 /events 로 간다', async () => {
    const before = received.length;
    const body = await send({ hook_event_name: 'SessionStart', session_id: 's2', cwd: repoRoot, extra: '한글' });
    expect(body).toMatchObject({ hook_event_name: 'SessionStart', cwd: repoRoot, extra: '한글', spyglass_project_root: repoRoot });
    expect(received[before].path).toBe('/events');
  });
});
