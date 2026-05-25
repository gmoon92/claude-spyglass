/**
 * claude-hooks.test.ts — Hook 자동 병합 핵심 로직 단위 테스트
 *
 * 검증 대상:
 *   1) `mergeSettings` 의 *불변식 2* — 사용자 top-level 키 보존 (model, statusLine 등)
 *   2) `mergeSettings` 의 env.SPYGLASS_DIR 덮어쓰기 + 다른 env 키 보존
 *   3) `mergeSettings` 의 hooks 병합 + applied/modified/preserved 분류
 *   4) `backupSettings` 의 unique suffix (1초 안에 2번 호출 시 충돌 X)
 *   5) `applySettings` 의 atomic write (tmp → rename)
 *   6) `loadHookProfile` 의 SPYGLASS_DIR 치환
 *
 *   `loadCurrentSettings` / `loadHookProfile` 는 실제 파일을 읽으므로 임시 디렉토리에서
 *   `HOME` 환경변수를 redirect 한 채로 테스트. 본 PR 범위에선 SPYGLASS_HOME 류 override 가
 *   `claude-hooks.ts` 에 없어 직접 HOME 을 바꾼다.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import {
  mergeSettings,
  backupSettings,
  applySettings,
  loadCurrentSettings,
  restoreFromBackup,
  type SettingsObject,
} from '../claude-hooks';

let tmpHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'spyglass-hooks-test-'));
  mkdirSync(join(tmpHome, '.claude'), { recursive: true });
  originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
});

afterEach(async () => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  await rm(tmpHome, { recursive: true, force: true });
});

// =============================================================================
// mergeSettings
// =============================================================================

describe('mergeSettings — 사용자 top-level 키 보존', () => {
  it('model / enabledPlugins / autoMemoryEnabled 같은 사용자 키는 그대로 유지된다', () => {
    const current: SettingsObject = {
      model: 'claude-sonnet-4-6',
      enabledPlugins: ['foo', 'bar'],
      autoMemoryEnabled: true,
      statusLine: { type: 'command', command: 'my-statusline' },
      env: { OTHER_VAR: 'preserve-me' },
    };
    const profile: SettingsObject = {
      env: { SPYGLASS_DIR: '/tmp/spyglass' },
      hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'bash $SPYGLASS_DIR/h.sh' }] }] },
    };

    const { merged } = mergeSettings(current, profile);

    expect(merged.model).toBe('claude-sonnet-4-6');
    expect(merged.enabledPlugins).toEqual(['foo', 'bar']);
    expect(merged.autoMemoryEnabled).toBe(true);
    expect(merged.statusLine).toEqual({ type: 'command', command: 'my-statusline' });
  });

  it('env.SPYGLASS_DIR 은 주입되고 다른 env 키는 보존된다', () => {
    const current: SettingsObject = {
      env: { OTHER_VAR: 'keep', SPYGLASS_DIR: '/old/path' },
    };
    const profile: SettingsObject = {
      env: { SPYGLASS_DIR: '/new/path' },
      hooks: {},
    };
    const { merged, diff } = mergeSettings(current, profile);

    const mergedEnv = merged.env as Record<string, string>;
    expect(mergedEnv.SPYGLASS_DIR).toBe('/new/path');
    expect(mergedEnv.OTHER_VAR).toBe('keep');
    expect(diff.spyglassDir).toBe('changed');
    expect(diff.spyglassDirBefore).toBe('/old/path');
    expect(diff.spyglassDirAfter).toBe('/new/path');
  });

  it('현재 env 에 SPYGLASS_DIR 이 없으면 spyglassDir.created 로 분류된다', () => {
    const { diff } = mergeSettings(
      { env: { OTHER: 'x' } },
      { env: { SPYGLASS_DIR: '/p' }, hooks: {} },
    );
    expect(diff.spyglassDir).toBe('created');
    expect(diff.spyglassDirBefore).toBe(null);
  });

  it('hooks 병합 결과 — applied / modified / preserved 분류가 정확하다', () => {
    const current: SettingsObject = {
      hooks: {
        // 기존 spyglass 등록
        PreToolUse: [{ hooks: [{ type: 'command', command: 'old-spyglass' }] }],
        // 사용자가 직접 단 외부 도구 hook — 본 PR 정책상 *유지* (다른 event 라면)
        CustomEvent: [{ hooks: [{ type: 'command', command: 'my-tool' }] }],
      },
    };
    const profile: SettingsObject = {
      hooks: {
        PreToolUse: [{ hooks: [{ type: 'command', command: 'new-spyglass' }] }], // modified
        PostToolUse: [{ hooks: [{ type: 'command', command: 'new-spyglass' }] }], // applied
      },
    };

    const { merged, diff } = mergeSettings(current, profile);

    expect(diff.applied).toContain('PostToolUse');
    expect(diff.modified).toContain('PreToolUse');
    expect(diff.preserved).toContain('CustomEvent');

    const mergedHooks = merged.hooks as Record<string, unknown>;
    expect(mergedHooks.CustomEvent).toBeDefined(); // 보존
    // PreToolUse 는 profile 값으로 덮어쓰여야 함
    const pre = mergedHooks.PreToolUse as Array<{ hooks: Array<{ command: string }> }>;
    expect(pre[0].hooks[0].command).toBe('new-spyglass');
  });

  it('입력 객체를 mutate 하지 않는다 (immutability)', () => {
    const current: SettingsObject = { model: 'x', env: { A: 'a' } };
    const profile: SettingsObject = { env: { SPYGLASS_DIR: '/p' }, hooks: { X: [] } };
    const beforeJson = JSON.stringify(current);

    mergeSettings(current, profile);
    expect(JSON.stringify(current)).toBe(beforeJson);
  });
});

// =============================================================================
// hardening #2 — env / hooks 가 null 또는 비정상 타입일 때
// =============================================================================

describe('mergeSettings — 비정상 env/hooks 타입 방어 (hardening #2)', () => {
  it('env 가 null 이어도 크래시 없이 객체로 복구되어 SPYGLASS_DIR 주입', () => {
    const current = { model: 'x', env: null } as unknown as SettingsObject;
    const profile: SettingsObject = { env: { SPYGLASS_DIR: '/p' }, hooks: {} };
    const { merged } = mergeSettings(current, profile);
    expect(merged.env).toBeDefined();
    expect(typeof merged.env).toBe('object');
    expect((merged.env as Record<string, string>).SPYGLASS_DIR).toBe('/p');
  });

  it('env 가 array 여도 빈 객체로 폴백 (사용자 키는 소실되지만 크래시 X)', () => {
    const current = { env: ['oops'] } as unknown as SettingsObject;
    const profile: SettingsObject = { env: { SPYGLASS_DIR: '/p' }, hooks: {} };
    const { merged } = mergeSettings(current, profile);
    expect(Array.isArray(merged.env)).toBe(false);
    expect((merged.env as Record<string, string>).SPYGLASS_DIR).toBe('/p');
  });

  it('hooks 가 null 일 때 빈 객체로 시작 + profile.hooks 정상 주입', () => {
    const current = { hooks: null } as unknown as SettingsObject;
    const profile: SettingsObject = {
      env: { SPYGLASS_DIR: '/p' },
      hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'x' }] }] },
    };
    const { merged, diff } = mergeSettings(current, profile);
    expect(merged.hooks).toBeDefined();
    expect(diff.applied).toContain('PreToolUse');
  });

  it('env / hooks 모두 primitive (number) 여도 크래시 없이 작동', () => {
    const current = { env: 42, hooks: 'broken' } as unknown as SettingsObject;
    const profile: SettingsObject = { env: { SPYGLASS_DIR: '/p' }, hooks: {} };
    const { merged } = mergeSettings(current, profile);
    expect(typeof merged.env).toBe('object');
    expect(typeof merged.hooks).toBe('object');
  });

  it('top-level 사용자 키는 비정상 env/hooks 폴백에도 그대로 보존', () => {
    const current = { model: 'm', enabledPlugins: ['p1'], env: null } as unknown as SettingsObject;
    const profile: SettingsObject = { env: { SPYGLASS_DIR: '/p' }, hooks: {} };
    const { merged } = mergeSettings(current, profile);
    expect(merged.model).toBe('m');
    expect(merged.enabledPlugins).toEqual(['p1']);
  });
});

// =============================================================================
// hardening #1 — applySettings cross-platform 검증
// =============================================================================

describe('applySettings — cross-platform atomic replace (hardening #1)', () => {
  it('기존 settings.json 위에 덮어쓰기 가능 (POSIX/Windows 공통)', async () => {
    // 첫 적용 — 파일 생성.
    await applySettings({ x: 1 });
    expect(existsSync(join(tmpHome, '.claude', 'settings.json'))).toBe(true);

    // 두 번째 적용 — 기존 파일 위에 atomic replace. Windows rename 호환 분기가
    // 발동되더라도 throw 없이 통과해야 함.
    await applySettings({ x: 2, y: 'updated' });
    const txt = readFileSync(join(tmpHome, '.claude', 'settings.json'), 'utf-8');
    const parsed = JSON.parse(txt);
    expect(parsed).toEqual({ x: 2, y: 'updated' });
  });

  it('연속 적용 후 tmp 잔여 파일이 누적되지 않는다', async () => {
    for (let i = 0; i < 5; i++) {
      await applySettings({ x: i });
    }
    const fs = await import('node:fs/promises');
    const names = await fs.readdir(join(tmpHome, '.claude'));
    const tmp = names.filter((n) => n.includes('.tmp-'));
    expect(tmp).toEqual([]);
  });
});

// =============================================================================
// restoreFromBackup — 백업본 복구 (Undo)
// =============================================================================

describe('restoreFromBackup — Undo 흐름', () => {
  it('정상 백업본으로부터 settings.json 을 복원', async () => {
    // 1) 초기 상태 작성 + 백업.
    writeFileSync(
      join(tmpHome, '.claude', 'settings.json'),
      JSON.stringify({ model: 'original' }),
    );
    const backup = await backupSettings();
    expect(backup).not.toBe(null);

    // 2) 사용자가 잘못 적용해서 settings.json 변경.
    await applySettings({ model: 'changed', oops: true });

    // 3) 복원.
    const result = await restoreFromBackup(backup!);
    expect(result.restoredFrom).toBe(backup!);
    expect(result.preRestoreBackup).not.toBe(null);

    // 4) 내용 검증 — 원본 복원.
    const restored = JSON.parse(
      readFileSync(join(tmpHome, '.claude', 'settings.json'), 'utf-8'),
    );
    expect(restored).toEqual({ model: 'original' });
  });

  it('path traversal 시도는 거부된다 (.bak- prefix 가드)', async () => {
    await expect(restoreFromBackup('/etc/passwd')).rejects.toThrow(/backup/);
    await expect(restoreFromBackup(`${tmpHome}/.claude/random.json`)).rejects.toThrow(/backup/);
  });

  it('존재하지 않는 백업 경로는 명확한 에러', async () => {
    const settingsPath = join(tmpHome, '.claude', 'settings.json');
    await expect(restoreFromBackup(`${settingsPath}.bak-19990101-000000`))
      .rejects.toThrow(/failed to read backup/);
  });

  it('백업 파일이 깨진 JSON 이면 거부', async () => {
    const settingsPath = join(tmpHome, '.claude', 'settings.json');
    const fakeBak = `${settingsPath}.bak-20990101-000000`;
    writeFileSync(fakeBak, '{ broken json');
    await expect(restoreFromBackup(fakeBak)).rejects.toThrow(/failed to read backup/);
  });
});

// =============================================================================
// backupSettings — unique suffix
// =============================================================================

describe('backupSettings — 충돌 회피', () => {
  it('원본이 없으면 null 반환 (백업할 게 없음)', async () => {
    const result = await backupSettings();
    expect(result).toBe(null);
  });

  it('원본이 있으면 settings.json.bak-YYYYMMDD-HHMMSS 형식으로 백업', async () => {
    writeFileSync(join(tmpHome, '.claude', 'settings.json'), JSON.stringify({ model: 'x' }));
    const result = await backupSettings();
    expect(result).not.toBe(null);
    expect(result).toMatch(/settings\.json\.bak-\d{8}-\d{6}(-[a-z0-9]+)?$/);
    expect(existsSync(result!)).toBe(true);
  });

  it('1초 안에 두 번 백업해도 두 파일이 모두 보존된다 (충돌 회피)', async () => {
    writeFileSync(join(tmpHome, '.claude', 'settings.json'), JSON.stringify({ model: 'x' }));
    const r1 = await backupSettings();
    const r2 = await backupSettings();
    expect(r1).not.toBe(null);
    expect(r2).not.toBe(null);
    expect(r1).not.toBe(r2); // 서로 다른 경로
    expect(existsSync(r1!)).toBe(true);
    expect(existsSync(r2!)).toBe(true);
  });
});

// =============================================================================
// applySettings — atomic write
// =============================================================================

describe('applySettings — atomic write', () => {
  it('settings.json 에 JSON 이 정확히 쓰여진다 (indent 2 + 끝 개행)', async () => {
    const obj: SettingsObject = { model: 'x', hooks: { A: [] } };
    await applySettings(obj);

    const path = join(tmpHome, '.claude', 'settings.json');
    expect(existsSync(path)).toBe(true);
    const written = readFileSync(path, 'utf-8');
    expect(written.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(written);
    expect(parsed).toEqual(obj);
  });

  it('쓰기 도중 tmp 파일이 남지 않는다 (성공 시)', async () => {
    await applySettings({ x: 1 });
    // .tmp- 로 시작하는 파일이 없어야 함.
    const fs = await import('node:fs/promises');
    const names = await fs.readdir(join(tmpHome, '.claude'));
    const leftovers = names.filter((n) => n.includes('.tmp-'));
    expect(leftovers).toEqual([]);
  });

  it('~/.claude 디렉토리가 없어도 자동 생성', async () => {
    await rm(join(tmpHome, '.claude'), { recursive: true, force: true });
    await applySettings({ x: 1 });
    expect(existsSync(join(tmpHome, '.claude', 'settings.json'))).toBe(true);
  });
});

// =============================================================================
// loadCurrentSettings — 폴백 동작
// =============================================================================

describe('loadCurrentSettings — 안전한 폴백', () => {
  it('파일이 없으면 빈 객체 반환', async () => {
    const result = await loadCurrentSettings();
    expect(result).toEqual({});
  });

  it('JSON 이 깨졌으면 빈 객체 반환 (throw X)', async () => {
    writeFileSync(join(tmpHome, '.claude', 'settings.json'), '{ broken json');
    const result = await loadCurrentSettings();
    expect(result).toEqual({});
  });

  it('정상 JSON 은 파싱 결과 반환', async () => {
    writeFileSync(
      join(tmpHome, '.claude', 'settings.json'),
      JSON.stringify({ model: 'y', env: { A: 1 } }),
    );
    const result = await loadCurrentSettings();
    expect(result).toEqual({ model: 'y', env: { A: 1 } });
  });

  it('Array root 같은 비정상 JSON 도 빈 객체로 폴백', async () => {
    writeFileSync(join(tmpHome, '.claude', 'settings.json'), JSON.stringify([1, 2, 3]));
    const result = await loadCurrentSettings();
    expect(result).toEqual({});
  });
});
