/**
 * proxy-installer.test.ts — 셸 프로필 자동 설치 단위 테스트
 *
 * 검증:
 *   1) detectShellProfile: SHELL env / 명시 인자 / 파일 존재 우선순위
 *   2) replaceOrAppendMarkerBlock: append / replace / 손상 마커 throw / 역순 throw
 *   3) removeMarkerBlock: idempotent + 한쪽만 손상 throw
 *   4) cleanGraphModeExports: export 줄 주석화 + 카운트
 *   5) buildProxySnippet / buildMarkerBlock: 셸별 문법
 *   6) installProxyHook: 전체 흐름 (백업 + atomic write)
 *   7) restoreProxyHook: backup 복원 모드 + 마커 제거 모드
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import {
  detectShellProfile,
  replaceOrAppendMarkerBlock,
  removeMarkerBlock,
  cleanGraphModeExports,
  buildProxySnippet,
  buildMarkerBlock,
  installProxyHook,
  restoreProxyHook,
  MARKER_OPEN,
  MARKER_CLOSE,
} from '../proxy-installer';

let tmpHome: string;
let originalHome: string | undefined;
let originalShell: string | undefined;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'spyglass-proxy-test-'));
  originalHome = process.env.HOME;
  originalShell = process.env.SHELL;
  process.env.HOME = tmpHome;
});

afterEach(async () => {
  if (originalHome !== undefined) process.env.HOME = originalHome; else delete process.env.HOME;
  if (originalShell !== undefined) process.env.SHELL = originalShell; else delete process.env.SHELL;
  await rm(tmpHome, { recursive: true, force: true });
});

// =============================================================================
// detectShellProfile
// =============================================================================

describe('detectShellProfile', () => {
  it('명시 인자가 우선', async () => {
    process.env.SHELL = '/bin/zsh';
    const r = await detectShellProfile('bash');
    expect(r.shell).toBe('bash');
    expect(r.profilePath).toBe(join(tmpHome, '.bashrc'));
  });

  it('SHELL env basename 으로 2순위 분기', async () => {
    process.env.SHELL = '/usr/local/bin/fish';
    const r = await detectShellProfile('auto');
    expect(r.shell).toBe('fish');
    expect(r.profilePath).toBe(join(tmpHome, '.config', 'fish', 'config.fish'));
  });

  it('SHELL 미지정 + .zshrc 존재 → zsh', async () => {
    delete process.env.SHELL;
    writeFileSync(join(tmpHome, '.zshrc'), '');
    const r = await detectShellProfile('auto');
    expect(r.shell).toBe('zsh');
    expect(r.existed).toBe(true);
  });

  it('SHELL 미지정 + .zshrc 없음 + .bashrc 있음 → bash', async () => {
    delete process.env.SHELL;
    writeFileSync(join(tmpHome, '.bashrc'), '');
    const r = await detectShellProfile('auto');
    expect(r.shell).toBe('bash');
  });

  it('아무 파일도 없으면 default zsh + existed:false', async () => {
    delete process.env.SHELL;
    const r = await detectShellProfile('auto');
    expect(r.shell).toBe('zsh');
    expect(r.existed).toBe(false);
  });
});

// =============================================================================
// replaceOrAppendMarkerBlock — 멱등 정책
// =============================================================================

describe('replaceOrAppendMarkerBlock', () => {
  const block = `${MARKER_OPEN}\nclaude() { :; }\n${MARKER_CLOSE}`;

  it('빈 파일 → append', () => {
    const r = replaceOrAppendMarkerBlock('', block);
    expect(r.action).toBe('appended');
    expect(r.content).toContain(MARKER_OPEN);
    expect(r.content).toContain(MARKER_CLOSE);
  });

  it('마커 없는 사용자 코드 끝에 append + 개행 정규화', () => {
    const r = replaceOrAppendMarkerBlock('export PATH=$PATH:/foo', block);
    expect(r.action).toBe('appended');
    // 사용자 코드 보존.
    expect(r.content.startsWith('export PATH=$PATH:/foo')).toBe(true);
    // append 부분.
    expect(r.content.endsWith(block + '\n')).toBe(true);
  });

  it('마커 페어 존재 → 두 마커 사이 통째로 교체', () => {
    const original = `before\n${MARKER_OPEN}\nold body\n${MARKER_CLOSE}\nafter\n`;
    const newBlock = `${MARKER_OPEN}\nnew body\n${MARKER_CLOSE}`;
    const r = replaceOrAppendMarkerBlock(original, newBlock);
    expect(r.action).toBe('replaced');
    expect(r.content).toContain('new body');
    expect(r.content).not.toContain('old body');
    expect(r.content.startsWith('before')).toBe(true);
    expect(r.content.endsWith('after\n')).toBe(true);
  });

  it('한쪽 마커만 손상 → throw', () => {
    const broken = `prefix\n${MARKER_OPEN}\nsome body\nno close marker\n`;
    expect(() => replaceOrAppendMarkerBlock(broken, block)).toThrow(/corrupted/);
  });

  it('마커 역순 (close 가 open 보다 앞) → throw', () => {
    const inverted = `${MARKER_CLOSE}\nbody\n${MARKER_OPEN}\n`;
    expect(() => replaceOrAppendMarkerBlock(inverted, block)).toThrow(/inverted/);
  });
});

// =============================================================================
// removeMarkerBlock
// =============================================================================

describe('removeMarkerBlock', () => {
  it('마커 없음 → no-op + removed:false', () => {
    const r = removeMarkerBlock('plain content');
    expect(r.removed).toBe(false);
    expect(r.content).toBe('plain content');
  });

  it('마커 페어 제거 — 주변 개행도 1개씩 정리', () => {
    const original = `keep before\n\n${MARKER_OPEN}\nbody\n${MARKER_CLOSE}\nkeep after\n`;
    const r = removeMarkerBlock(original);
    expect(r.removed).toBe(true);
    expect(r.content).not.toContain(MARKER_OPEN);
    expect(r.content).not.toContain(MARKER_CLOSE);
    expect(r.content).toContain('keep before');
    expect(r.content).toContain('keep after');
  });

  it('한쪽만 손상 시 throw', () => {
    expect(() => removeMarkerBlock(`${MARKER_OPEN}\nbody\nno close`)).toThrow(/corrupted/);
  });
});

// =============================================================================
// cleanGraphModeExports
// =============================================================================

describe('cleanGraphModeExports', () => {
  it('export SPYGLASS_GRAPH_MODE 줄을 주석 처리', () => {
    const src = `export PATH=/x\nexport SPYGLASS_GRAPH_MODE=primary\nalias foo=bar\n`;
    const r = cleanGraphModeExports(src);
    expect(r.cleanedCount).toBe(1);
    expect(r.content).toContain('# export SPYGLASS_GRAPH_MODE=primary');
    expect(r.content).toContain('commented by spyglass');
    // 다른 라인 보존.
    expect(r.content).toContain('export PATH=/x');
    expect(r.content).toContain('alias foo=bar');
  });

  it('동일 줄이 여러 개여도 모두 처리', () => {
    const src = `export SPYGLASS_GRAPH_MODE=off\necho ok\nexport SPYGLASS_GRAPH_MODE=primary\n`;
    const r = cleanGraphModeExports(src);
    expect(r.cleanedCount).toBe(2);
  });

  it('이미 주석 처리된 줄은 건드리지 않음', () => {
    const src = `# export SPYGLASS_GRAPH_MODE=shadow\n`;
    const r = cleanGraphModeExports(src);
    expect(r.cleanedCount).toBe(0);
  });
});

// =============================================================================
// buildProxySnippet / buildMarkerBlock
// =============================================================================

describe('buildProxySnippet / buildMarkerBlock', () => {
  it('zsh/bash 는 동일 sh 함수 문법', () => {
    const zsh = buildProxySnippet('zsh', 9999);
    const bash = buildProxySnippet('bash', 9999);
    expect(zsh).toBe(bash);
    expect(zsh).toContain('claude() {');
    expect(zsh).toContain('http://localhost:9999/health');
  });

  it('fish 는 function ... end 문법', () => {
    const fish = buildProxySnippet('fish', 9999);
    expect(fish).toContain('function claude');
    expect(fish).toContain('end');
    expect(fish).toContain('$argv');
  });

  it('buildMarkerBlock 은 마커로 감싼 완전 블록', () => {
    const block = buildMarkerBlock('zsh', 9999);
    expect(block.startsWith(MARKER_OPEN)).toBe(true);
    expect(block.endsWith(MARKER_CLOSE)).toBe(true);
    expect(block).toContain('claude()');
  });
});

// =============================================================================
// installProxyHook — 전체 흐름
// =============================================================================

describe('installProxyHook', () => {
  it('빈 .zshrc 신규 작성 + 백업 null (원본 없음)', async () => {
    process.env.SHELL = '/bin/zsh';
    const r = await installProxyHook({ shell: 'auto', port: 9999 });
    expect(r.shell).toBe('zsh');
    expect(r.installedTo).toBe(join(tmpHome, '.zshrc'));
    expect(r.backupPath).toBe(null); // 원본 없었음.
    expect(r.action).toBe('appended');
    const txt = readFileSync(r.installedTo, 'utf-8');
    expect(txt).toContain(MARKER_OPEN);
    expect(txt).toContain(MARKER_CLOSE);
  });

  it('기존 사용자 코드 보존 + 백업 생성 + 마커 append', async () => {
    process.env.SHELL = '/bin/zsh';
    const rc = join(tmpHome, '.zshrc');
    writeFileSync(rc, 'export FOO=bar\nalias ll="ls -la"\n');
    const r = await installProxyHook({ shell: 'auto', port: 9999 });
    expect(r.backupPath).not.toBe(null);
    const txt = readFileSync(rc, 'utf-8');
    expect(txt).toContain('export FOO=bar');
    expect(txt).toContain('alias ll="ls -la"');
    expect(txt).toContain(MARKER_OPEN);
  });

  it('두 번째 호출은 *교체* (idempotent)', async () => {
    process.env.SHELL = '/bin/zsh';
    const rc = join(tmpHome, '.zshrc');
    writeFileSync(rc, '');
    await installProxyHook({ shell: 'auto', port: 9999 });
    const r2 = await installProxyHook({ shell: 'auto', port: 8888 });
    expect(r2.action).toBe('replaced');
    const txt = readFileSync(rc, 'utf-8');
    // 새 포트 적용 + 옛 포트 사라짐.
    expect(txt).toContain(':8888');
    expect(txt).not.toContain(':9999');
    // 마커 1쌍만.
    const opens = txt.match(new RegExp(MARKER_OPEN, 'g')) ?? [];
    expect(opens.length).toBe(1);
  });

  it('SPYGLASS_GRAPH_MODE export 가 잔존하면 자동 주석화 + cleanedGraphModeExports 카운트', async () => {
    process.env.SHELL = '/bin/zsh';
    const rc = join(tmpHome, '.zshrc');
    writeFileSync(rc, 'export SPYGLASS_GRAPH_MODE=primary\n');
    const r = await installProxyHook({ shell: 'auto', port: 9999 });
    expect(r.cleanedGraphModeExports).toBe(1);
    const txt = readFileSync(rc, 'utf-8');
    expect(txt).toContain('# export SPYGLASS_GRAPH_MODE=primary');
  });

  it('한쪽 마커만 손상된 셸 프로필 → throw', async () => {
    process.env.SHELL = '/bin/zsh';
    const rc = join(tmpHome, '.zshrc');
    writeFileSync(rc, `${MARKER_OPEN}\nsome leftover\n`);
    await expect(installProxyHook({ shell: 'auto', port: 9999 })).rejects.toThrow(/corrupted/);
  });
});

// =============================================================================
// restoreProxyHook — 백업 복원 / 마커 제거
// =============================================================================

describe('restoreProxyHook', () => {
  it('backupPath 주어지면 백업 → 원본 복원 + pre-restore 백업', async () => {
    process.env.SHELL = '/bin/zsh';
    const rc = join(tmpHome, '.zshrc');
    writeFileSync(rc, 'export FOO=bar\n');
    const install = await installProxyHook({ shell: 'auto', port: 9999 });
    expect(install.backupPath).not.toBe(null);
    // 사용자 변경 추가.
    writeFileSync(rc, readFileSync(rc, 'utf-8') + '\nextra=line\n');
    // 복원.
    const r = await restoreProxyHook({ backupPath: install.backupPath!, shell: 'auto' });
    expect(r.mode).toBe('restore-backup');
    expect(r.restoredFrom).toBe(install.backupPath);
    expect(r.preRestoreBackup).not.toBe(null);
    // 원본 내용 복원 — 마커 사라짐 + extra=line 사라짐 + 원래 FOO=bar 만.
    const restored = readFileSync(rc, 'utf-8');
    expect(restored).toBe('export FOO=bar\n');
  });

  it('backupPath 없으면 마커 블록만 제거 (다른 코드 보존)', async () => {
    process.env.SHELL = '/bin/zsh';
    const rc = join(tmpHome, '.zshrc');
    writeFileSync(rc, 'export FOO=bar\n');
    await installProxyHook({ shell: 'auto', port: 9999 });
    const r = await restoreProxyHook({ shell: 'auto' });
    expect(r.mode).toBe('uninstall-block');
    expect(r.removedBlock).toBe(true);
    const restored = readFileSync(rc, 'utf-8');
    expect(restored).toContain('export FOO=bar');
    expect(restored).not.toContain(MARKER_OPEN);
  });

  it('backupPath 가 셸 프로필 prefix 와 매칭 안 되면 throw (traversal 가드)', async () => {
    process.env.SHELL = '/bin/zsh';
    writeFileSync(join(tmpHome, '.zshrc'), '');
    await expect(restoreProxyHook({ backupPath: '/etc/passwd', shell: 'auto' }))
      .rejects.toThrow(/\.bak-/);
  });

  it('마커 없을 때 uninstall-block 호출 → removed:false + 변경 없음', async () => {
    process.env.SHELL = '/bin/zsh';
    const rc = join(tmpHome, '.zshrc');
    writeFileSync(rc, 'plain content\n');
    const r = await restoreProxyHook({ shell: 'auto' });
    expect(r.removedBlock).toBe(false);
    expect(readFileSync(rc, 'utf-8')).toBe('plain content\n');
  });
});
