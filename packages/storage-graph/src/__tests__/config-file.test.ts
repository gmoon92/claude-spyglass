/**
 * config-file.test.ts — `~/.spyglass/server-config.json` SSoT 단위 테스트
 *
 * 검증 대상:
 *   1) loadServerConfig 의 *안전한 폴백* — 파일 없음 / 깨진 JSON / 비정상 root
 *   2) saveServerConfig 의 *atomic write* — tmp 디렉토리 격리 + 잔여 파일 0
 *   3) 부분 업데이트 — 기존 필드 보존 + version/updatedAt 자동 갱신
 *   4) flag.ts 우선순위 — env > file > default 시나리오
 *   5) getGraphModeSource — 각 경로 분기에서 정확한 source 반환
 *
 * 환경 격리:
 *   `process.env.SPYGLASS_HOME` 을 임시 디렉토리로 redirect 하여 사용자 실제
 *   `~/.spyglass/` 을 건드리지 않음. config-file.ts 의 getUserHome 헬퍼가 본 변수를 우선.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm, readdir } from 'node:fs/promises';
import {
  loadServerConfig,
  saveServerConfig,
  getServerConfigPath,
  getServerConfigTmpDir,
  SERVER_CONFIG_VERSION,
} from '../runtime/config-file';
import {
  getGraphMode,
  getGraphModeSource,
  refreshGraphModeFromFile,
  resetGraphModeCache,
} from '../runtime/flag';

let tmpHome: string;
let originalHome: string | undefined;
let originalEnv: string | undefined;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'spyglass-config-test-'));
  originalHome = process.env.SPYGLASS_HOME;
  originalEnv = process.env.SPYGLASS_GRAPH_MODE;
  process.env.SPYGLASS_HOME = tmpHome;
  delete process.env.SPYGLASS_GRAPH_MODE;
  resetGraphModeCache();
});

afterEach(async () => {
  if (originalHome !== undefined) process.env.SPYGLASS_HOME = originalHome;
  else delete process.env.SPYGLASS_HOME;
  if (originalEnv !== undefined) process.env.SPYGLASS_GRAPH_MODE = originalEnv;
  else delete process.env.SPYGLASS_GRAPH_MODE;
  resetGraphModeCache();
  await rm(tmpHome, { recursive: true, force: true });
});

// =============================================================================
// loadServerConfig — 안전 폴백
// =============================================================================

describe('loadServerConfig — 안전 폴백', () => {
  it('파일 없으면 default 객체 반환 (version=1, graphMode=undefined)', async () => {
    const cfg = await loadServerConfig();
    expect(cfg.version).toBe(SERVER_CONFIG_VERSION);
    expect(cfg.graphMode).toBeUndefined();
  });

  it('깨진 JSON 위에서도 throw 없이 default 폴백', async () => {
    const cfgPath = getServerConfigPath();
    mkdirSync(join(tmpHome, '.spyglass'), { recursive: true });
    writeFileSync(cfgPath, '{ broken json');
    const cfg = await loadServerConfig();
    expect(cfg.graphMode).toBeUndefined();
  });

  it('Array root 같은 비정상 JSON 도 default 폴백', async () => {
    const cfgPath = getServerConfigPath();
    mkdirSync(join(tmpHome, '.spyglass'), { recursive: true });
    writeFileSync(cfgPath, JSON.stringify([1, 2, 3]));
    const cfg = await loadServerConfig();
    expect(cfg.graphMode).toBeUndefined();
  });

  it('graphMode 가 알 수 없는 문자열이면 undefined 로 폴백 (다른 필드는 보존)', async () => {
    const cfgPath = getServerConfigPath();
    mkdirSync(join(tmpHome, '.spyglass'), { recursive: true });
    writeFileSync(cfgPath, JSON.stringify({ version: 1, graphMode: 'invalid', updatedAt: 123 }));
    const cfg = await loadServerConfig();
    expect(cfg.graphMode).toBeUndefined();
    expect(cfg.updatedAt).toBe(123);
  });

  it('정상 파일은 graphMode + updatedAt 그대로 반환', async () => {
    const cfgPath = getServerConfigPath();
    mkdirSync(join(tmpHome, '.spyglass'), { recursive: true });
    writeFileSync(cfgPath, JSON.stringify({ version: 1, graphMode: 'primary', updatedAt: 1234567890 }));
    const cfg = await loadServerConfig();
    expect(cfg.graphMode).toBe('primary');
    expect(cfg.updatedAt).toBe(1234567890);
  });
});

// =============================================================================
// saveServerConfig — Atomic write via ~/.spyglass/tmp/
// =============================================================================

describe('saveServerConfig — atomic write', () => {
  it('첫 저장 — 파일 생성 + tmp 디렉토리 격리 사용', async () => {
    const next = await saveServerConfig({ graphMode: 'primary' });
    expect(next.graphMode).toBe('primary');
    expect(next.version).toBe(SERVER_CONFIG_VERSION);
    expect(next.updatedAt).toBeGreaterThan(0);
    // 파일 실제 존재.
    expect(existsSync(getServerConfigPath())).toBe(true);
    // tmp 디렉토리는 생성됐지만 잔여 파일 없음.
    const tmpDir = getServerConfigTmpDir();
    expect(existsSync(tmpDir)).toBe(true);
    const leftovers = await readdir(tmpDir);
    expect(leftovers).toEqual([]);
  });

  it('부분 업데이트 — 기존 필드 보존', async () => {
    await saveServerConfig({ graphMode: 'shadow' });
    const ts1 = Date.now();
    await new Promise((r) => setTimeout(r, 10)); // updatedAt 변화 보장
    const next = await saveServerConfig({ graphMode: 'primary' });
    expect(next.graphMode).toBe('primary');
    expect(next.updatedAt).toBeGreaterThanOrEqual(ts1);
  });

  it('연속 저장 — tmp 파일이 누적되지 않는다', async () => {
    for (const m of ['off', 'shadow', 'primary', 'shadow', 'off'] as const) {
      await saveServerConfig({ graphMode: m });
    }
    const tmpDir = getServerConfigTmpDir();
    const leftovers = await readdir(tmpDir);
    expect(leftovers).toEqual([]);
  });

  it('저장된 파일은 indent 2 + 끝 개행 + 파싱 가능', async () => {
    await saveServerConfig({ graphMode: 'primary' });
    const text = readFileSync(getServerConfigPath(), 'utf-8');
    expect(text.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(text);
    expect(parsed.graphMode).toBe('primary');
    expect(parsed.version).toBe(SERVER_CONFIG_VERSION);
  });

  it('tmp 파일이 settings 디렉토리가 아닌 ~/.spyglass/tmp/ 에 만들어진다 (격리)', async () => {
    // 동시성 X — 직렬 save 가 끝나면 tmp 가 비어있어야 한다는 케이스는 위에서 검증.
    // 본 케이스는 *tmp 디렉토리 경로 자체* 가 ~/.spyglass/tmp/ 인지 직접 검증.
    const expectedTmp = join(tmpHome, '.spyglass', 'tmp');
    expect(getServerConfigTmpDir()).toBe(expectedTmp);
  });
});

// =============================================================================
// flag.ts 우선순위 — env > file > default
// =============================================================================

describe('flag.ts 우선순위 (env > file > default)', () => {
  it('env / file 모두 없으면 default = primary / source = default', async () => {
    await refreshGraphModeFromFile();
    expect(getGraphMode()).toBe('primary');
    expect(getGraphModeSource()).toBe('default');
  });

  it('file 만 있고 env 없으면 file 값 적용 / source = file', async () => {
    await saveServerConfig({ graphMode: 'primary' });
    resetGraphModeCache();
    await refreshGraphModeFromFile();
    expect(getGraphMode()).toBe('primary');
    expect(getGraphModeSource()).toBe('file');
  });

  it('env 가 있으면 file 무시 / source = env', async () => {
    await saveServerConfig({ graphMode: 'primary' }); // file = primary
    process.env.SPYGLASS_GRAPH_MODE = 'off';          // env = off
    resetGraphModeCache();
    await refreshGraphModeFromFile();
    expect(getGraphMode()).toBe('off');
    expect(getGraphModeSource()).toBe('env');
  });

  it('env 가 알 수 없는 값이면 무시되고 file 평가로 진행', async () => {
    await saveServerConfig({ graphMode: 'shadow' });
    process.env.SPYGLASS_GRAPH_MODE = 'garbage';
    resetGraphModeCache();
    await refreshGraphModeFromFile();
    expect(getGraphMode()).toBe('shadow'); // file 의 값 그대로 반영 — DEFAULT 와 무관
    expect(getGraphModeSource()).toBe('file');
  });

  it('file 의 graphMode 가 undefined 이고 env 도 없으면 default', async () => {
    // graphMode 필드 자체가 누락된 file.
    mkdirSync(join(tmpHome, '.spyglass'), { recursive: true });
    writeFileSync(
      getServerConfigPath(),
      JSON.stringify({ version: 1, updatedAt: Date.now() }),
    );
    resetGraphModeCache();
    await refreshGraphModeFromFile();
    expect(getGraphMode()).toBe('primary');
    expect(getGraphModeSource()).toBe('default');
  });

  it('초기 getGraphMode() 동기 호출은 env 만 평가 + file 미반영', () => {
    // refreshGraphModeFromFile 호출 *전* 의 동기 분기 검증.
    // env 없음 → default.
    expect(getGraphMode()).toBe('primary');
    expect(getGraphModeSource()).toBe('default');
  });

  it('setGraphMode 호출 시 source 가 file 로 표시 (env override 가 아닌 경우)', async () => {
    resetGraphModeCache();
    await refreshGraphModeFromFile(); // default 상태로 시작.
    expect(getGraphModeSource()).toBe('default');

    // setGraphMode 직접 호출 — GUI 가 사용했다고 가정.
    const { setGraphMode } = await import('../runtime/flag');
    setGraphMode('primary');
    expect(getGraphMode()).toBe('primary');
    expect(getGraphModeSource()).toBe('file');
  });

  it('env override 상태에서 setGraphMode 가 호출되어도 source 는 env 유지', async () => {
    process.env.SPYGLASS_GRAPH_MODE = 'shadow';
    resetGraphModeCache();
    await refreshGraphModeFromFile();
    expect(getGraphModeSource()).toBe('env');

    const { setGraphMode } = await import('../runtime/flag');
    setGraphMode('primary');
    // env override 의미 보존 — source 는 env. mode 자체는 setGraphMode 가 캐시 갱신.
    expect(getGraphModeSource()).toBe('env');
  });
});
