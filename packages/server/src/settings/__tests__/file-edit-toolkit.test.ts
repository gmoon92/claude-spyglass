/**
 * file-edit-toolkit.test.ts — 공용 SSoT 단위 테스트
 *
 * 검증:
 *   - backupFile: 미존재 시 null, unique suffix, 동일 초 충돌 회피
 *   - writeAtomic: ~/.spyglass/tmp/ 격리, 잔여 tmp 0, dirname 자동 생성, cross-platform 동작
 *   - restoreFromBackup: 파일 복원 + pre-restore 백업
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm, readdir } from 'node:fs/promises';
import {
  backupFile,
  writeAtomic,
  restoreFromBackup,
  getTmpDir,
} from '../file-edit-toolkit';

let tmpHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'spyglass-toolkit-test-'));
  originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
});

afterEach(async () => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  await rm(tmpHome, { recursive: true, force: true });
});

// =============================================================================
// backupFile
// =============================================================================

describe('backupFile', () => {
  it('대상 파일 미존재 시 null 반환', async () => {
    const r = await backupFile(join(tmpHome, 'nope.txt'));
    expect(r).toBe(null);
  });

  it('대상 파일 존재 시 .bak-YYYYMMDD-HHMMSS 형식 백업 생성', async () => {
    const target = join(tmpHome, 'config.txt');
    writeFileSync(target, 'hello');
    const r = await backupFile(target);
    expect(r).not.toBe(null);
    expect(r).toMatch(/config\.txt\.bak-\d{8}-\d{6}(-[a-z0-9]+)?$/);
    expect(existsSync(r!)).toBe(true);
    expect(readFileSync(r!, 'utf-8')).toBe('hello');
  });

  it('동일 초 안에 두 번 호출해도 두 백업 모두 보존', async () => {
    const target = join(tmpHome, 'cfg.txt');
    writeFileSync(target, 'x');
    const r1 = await backupFile(target);
    const r2 = await backupFile(target);
    expect(r1).not.toBe(r2);
    expect(existsSync(r1!)).toBe(true);
    expect(existsSync(r2!)).toBe(true);
  });
});

// =============================================================================
// writeAtomic
// =============================================================================

describe('writeAtomic', () => {
  it('대상 파일이 없으면 생성', async () => {
    const target = join(tmpHome, 'a.txt');
    const r = await writeAtomic(target, 'hello');
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf-8')).toBe('hello');
    expect(r.bytes).toBe(5);
  });

  it('대상 파일이 있으면 덮어쓰기 (POSIX 와 Windows 분기 둘 다 통과)', async () => {
    const target = join(tmpHome, 'a.txt');
    writeFileSync(target, 'original');
    await writeAtomic(target, 'replaced');
    expect(readFileSync(target, 'utf-8')).toBe('replaced');
  });

  it('dirname 이 없으면 자동 생성', async () => {
    const target = join(tmpHome, 'nested', 'deep', 'a.txt');
    await writeAtomic(target, 'ok');
    expect(existsSync(target)).toBe(true);
  });

  it('tmp 파일은 ~/.spyglass/tmp/ 에 만들어지고 잔여 0', async () => {
    for (let i = 0; i < 5; i++) {
      await writeAtomic(join(tmpHome, 'f.txt'), `v${i}`);
    }
    const tmpDir = getTmpDir();
    expect(existsSync(tmpDir)).toBe(true);
    const left = await readdir(tmpDir);
    expect(left).toEqual([]);
  });

  it('getTmpDir() 가 ~/.spyglass/tmp/ 절대 경로 반환', () => {
    expect(getTmpDir()).toBe(join(tmpHome, '.spyglass', 'tmp'));
  });
});

// =============================================================================
// restoreFromBackup
// =============================================================================

describe('restoreFromBackup', () => {
  it('백업 → 원본 복원 + pre-restore 백업 생성', async () => {
    const target = join(tmpHome, 'cfg.txt');
    writeFileSync(target, 'original');
    const bak = await backupFile(target);
    expect(bak).not.toBe(null);
    // 의도치 않게 변경.
    await writeAtomic(target, 'changed');
    // 복원.
    const r = await restoreFromBackup(bak!, target);
    expect(r.restoredFrom).toBe(bak!);
    expect(r.preRestoreBackup).not.toBe(null);
    expect(readFileSync(target, 'utf-8')).toBe('original');
    expect(readFileSync(r.preRestoreBackup!, 'utf-8')).toBe('changed');
  });

  it('백업 파일이 없으면 명확한 에러', async () => {
    await expect(restoreFromBackup('/nope/file', join(tmpHome, 't.txt')))
      .rejects.toThrow(/failed to read backup/);
  });

  it('원본 미존재 시 pre-restore 백업은 null', async () => {
    const target = join(tmpHome, 'first.txt');
    const bak = join(tmpHome, 'first.txt.bak-fake');
    writeFileSync(bak, 'restored-content');
    const r = await restoreFromBackup(bak, target);
    expect(r.preRestoreBackup).toBe(null);
    expect(readFileSync(target, 'utf-8')).toBe('restored-content');
  });
});
