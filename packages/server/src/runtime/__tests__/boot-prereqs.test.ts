/**
 * boot-prereqs 게이트 순수함수 테스트.
 *
 * @description spawnSync 부수효과는 테스트하지 않고, "언제 실행/skip 하는가" 판정 로직만 검증한다.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { shouldRunPrereqs, isWebBuildStale } from '../boot-prereqs';

let root: string;

/** source(git clone) 환경 모사 — scripts/ensure-ladybug.ts + packages/web/package.json 배치. */
function makeSourceTree(base: string) {
  mkdirSync(join(base, 'scripts'), { recursive: true });
  mkdirSync(join(base, 'packages', 'web'), { recursive: true });
  writeFileSync(join(base, 'scripts', 'ensure-ladybug.ts'), '// stub');
  writeFileSync(join(base, 'packages', 'web', 'package.json'), '{}');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'spyglass-bootprereq-'));
});
afterEach(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch {}
});

describe('shouldRunPrereqs', () => {
  it('source 트리 + 채널 미설정 → true', () => {
    makeSourceTree(root);
    expect(shouldRunPrereqs(root, {})).toBe(true);
  });

  it('SPYGLASS_SKIP_BOOT_PREREQS 설정 → false', () => {
    makeSourceTree(root);
    expect(shouldRunPrereqs(root, { SPYGLASS_SKIP_BOOT_PREREQS: '1' })).toBe(false);
  });

  it('packaged/brew 채널 → false', () => {
    makeSourceTree(root);
    expect(shouldRunPrereqs(root, { SPYGLASS_UPDATE_CHANNEL: 'packaged' })).toBe(false);
    expect(shouldRunPrereqs(root, { SPYGLASS_UPDATE_CHANNEL: 'brew' })).toBe(false);
  });

  it('git 채널 → true (source 트리 존재 시)', () => {
    makeSourceTree(root);
    expect(shouldRunPrereqs(root, { SPYGLASS_UPDATE_CHANNEL: 'git' })).toBe(true);
  });

  it('source 표지 파일 부재(배포본) → false', () => {
    // scripts/web 미생성 — packaged 산출물에 git/scripts 없는 상황
    expect(shouldRunPrereqs(root, {})).toBe(false);
  });
});

describe('isWebBuildStale', () => {
  it('dist/index.html 부재 → stale(true)', () => {
    expect(isWebBuildStale(root)).toBe(true);
  });

  it('dist/index.html 존재 → fresh(false)', () => {
    mkdirSync(join(root, 'packages', 'web', 'dist'), { recursive: true });
    writeFileSync(join(root, 'packages', 'web', 'dist', 'index.html'), '<html></html>');
    expect(isWebBuildStale(root)).toBe(false);
  });
});
