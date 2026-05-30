/**
 * diag-log 파일 권한 — R10 하드닝 (평문 .jsonl 0o600 강제)
 *
 * @description
 *   diag-log의 ENABLED는 모듈 로드 시점 const라, env를 미리 세팅한 fresh 프로세스에서 검증한다.
 *   R10은 암호화하지 않고(기본 OFF·휘발성 디버그 산출물) 파일 권한 0o600 + 경고로 하드닝한다.
 *
 * @see packages/server/src/diag-log.ts
 */

import { afterEach, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';

const diagPath = join(import.meta.dir, '..', 'diag-log.ts');
const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* noop */ }
  }
});

test('diag가 활성일 때 .jsonl 파일이 0o600으로 생성된다', () => {
  const dir = join(os.tmpdir(), `diag-perm-${Math.floor(performance.now() * 1000)}`);
  dirs.push(dir);
  const code = `const { diagJson } = await import(${JSON.stringify(diagPath)});`
    + ` diagJson('hook-payload', { raw: 'secret 대화 본문' });`;
  const r = Bun.spawnSync(['bun', '-e', code], {
    env: { ...process.env, SPYGLASS_DIAG_ENABLED: '1', SPYGLASS_DIAG_LOG_DIR: dir },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(r.exitCode).toBe(0);
  const file = join(dir, 'hook-payload.jsonl');
  expect(fs.existsSync(file)).toBe(true);
  const mode = fs.statSync(file).mode & 0o777;
  expect(mode).toBe(0o600);
});

test('diag가 비활성(기본)이면 파일을 만들지 않는다(no-op)', () => {
  const dir = join(os.tmpdir(), `diag-off-${Math.floor(performance.now() * 1000)}`);
  dirs.push(dir);
  const code = `const { diagJson } = await import(${JSON.stringify(diagPath)});`
    + ` diagJson('hook-payload', { raw: 'x' });`;
  const env: Record<string, string | undefined> = { ...process.env, SPYGLASS_DIAG_LOG_DIR: dir };
  delete env.SPYGLASS_DIAG_ENABLED;
  const r = Bun.spawnSync(['bun', '-e', code], { env, stdout: 'pipe', stderr: 'pipe' });
  expect(r.exitCode).toBe(0);
  expect(fs.existsSync(join(dir, 'hook-payload.jsonl'))).toBe(false);
});
