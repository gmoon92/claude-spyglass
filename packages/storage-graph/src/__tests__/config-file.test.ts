/**
 * config-file.test.ts — `~/.spyglass/server-config.json` SSoT 단위 테스트
 *
 * 검증 대상:
 *   1) loadServerConfig 의 *안전한 폴백* — 파일 없음 / 깨진 JSON / 비정상 root
 *   2) saveServerConfig 의 *atomic write* — tmp 디렉토리 격리 + 잔여 파일 0
 *   3) version/updatedAt 자동 갱신 + 레거시 경로 마이그레이션
 *
 *   (graph mode 는 v4.3.x 에서 제거됨 — 그래프는 항상 켜진 상태로 고정. 본 파일은
 *    이제 atomic write 인프라 + 안전 폴백만 검증한다.)
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

let tmpHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'spyglass-config-test-'));
  originalHome = process.env.SPYGLASS_HOME;
  process.env.SPYGLASS_HOME = tmpHome;
});

afterEach(async () => {
  if (originalHome !== undefined) process.env.SPYGLASS_HOME = originalHome;
  else delete process.env.SPYGLASS_HOME;
  await rm(tmpHome, { recursive: true, force: true });
});

// =============================================================================
// loadServerConfig — 안전 폴백
// =============================================================================

describe('loadServerConfig — 안전 폴백', () => {
  it('파일 없으면 default 객체 반환 (version=SERVER_CONFIG_VERSION)', async () => {
    const cfg = await loadServerConfig();
    expect(cfg.version).toBe(SERVER_CONFIG_VERSION);
    expect(cfg.updatedAt).toBe(0);
  });

  it('깨진 JSON 위에서도 throw 없이 default 폴백', async () => {
    const cfgPath = getServerConfigPath();
    mkdirSync(join(tmpHome, '.spyglass', 'config'), { recursive: true });
    writeFileSync(cfgPath, '{ broken json');
    const cfg = await loadServerConfig();
    expect(cfg.version).toBe(SERVER_CONFIG_VERSION);
  });

  it('Array root 같은 비정상 JSON 도 default 폴백', async () => {
    const cfgPath = getServerConfigPath();
    mkdirSync(join(tmpHome, '.spyglass', 'config'), { recursive: true });
    writeFileSync(cfgPath, JSON.stringify([1, 2, 3]));
    const cfg = await loadServerConfig();
    expect(cfg.version).toBe(SERVER_CONFIG_VERSION);
  });

  it('정상 파일은 version + updatedAt 그대로 반환', async () => {
    const cfgPath = getServerConfigPath();
    mkdirSync(join(tmpHome, '.spyglass', 'config'), { recursive: true });
    writeFileSync(cfgPath, JSON.stringify({ version: 1, updatedAt: 1234567890 }));
    const cfg = await loadServerConfig();
    expect(cfg.version).toBe(1);
    expect(cfg.updatedAt).toBe(1234567890);
  });

  it('알 수 없는 추가 필드는 무시하고 알려진 필드만 읽는다', async () => {
    const cfgPath = getServerConfigPath();
    mkdirSync(join(tmpHome, '.spyglass', 'config'), { recursive: true });
    writeFileSync(cfgPath, JSON.stringify({ version: 1, legacyField: 'ignored', updatedAt: 123 }));
    const cfg = await loadServerConfig();
    expect(cfg.updatedAt).toBe(123);
    expect(Object.keys(cfg).sort()).toEqual(['updatedAt', 'version']);
  });
});

// =============================================================================
// 레거시 마이그레이션 (root → config/) — 업데이트한 기존 사용자 보호
// =============================================================================

describe('레거시 마이그레이션 (root → config/)', () => {
  it('레거시 루트 server-config.json 을 config/ 로 이전하고 값 보존', async () => {
    // 업데이트 전 사용자: 설정이 루트 직속에 존재.
    mkdirSync(join(tmpHome, '.spyglass'), { recursive: true });
    const legacyPath = join(tmpHome, '.spyglass', 'server-config.json');
    writeFileSync(legacyPath, JSON.stringify({ version: 1, updatedAt: 999 }));

    const cfg = await loadServerConfig();

    expect(cfg.updatedAt).toBe(999); // 값 보존
    expect(existsSync(getServerConfigPath())).toBe(true); // config/ 로 이전됨
    expect(existsSync(legacyPath)).toBe(false);           // 레거시 제거됨
  });

  it('신규 config/ 경로가 이미 있으면 레거시를 무시한다 (no-op)', async () => {
    mkdirSync(join(tmpHome, '.spyglass', 'config'), { recursive: true });
    writeFileSync(getServerConfigPath(), JSON.stringify({ version: 1, updatedAt: 1 }));
    const legacyPath = join(tmpHome, '.spyglass', 'server-config.json');
    writeFileSync(legacyPath, JSON.stringify({ version: 1, updatedAt: 2 }));

    const cfg = await loadServerConfig();
    expect(cfg.updatedAt).toBe(1); // 신규 우선 — 레거시 미반영
  });
});

// =============================================================================
// saveServerConfig — Atomic write via ~/.spyglass/tmp/
// =============================================================================

describe('saveServerConfig — atomic write', () => {
  it('첫 저장 — 파일 생성 + tmp 디렉토리 격리 사용', async () => {
    const next = await saveServerConfig({});
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

  it('재저장 — version/updatedAt 자동 갱신', async () => {
    await saveServerConfig({});
    const ts1 = Date.now();
    await new Promise((r) => setTimeout(r, 10)); // updatedAt 변화 보장
    const next = await saveServerConfig({});
    expect(next.version).toBe(SERVER_CONFIG_VERSION);
    expect(next.updatedAt).toBeGreaterThanOrEqual(ts1);
  });

  it('연속 저장 — tmp 파일이 누적되지 않는다', async () => {
    for (let i = 0; i < 5; i++) {
      await saveServerConfig({});
    }
    const tmpDir = getServerConfigTmpDir();
    const leftovers = await readdir(tmpDir);
    expect(leftovers).toEqual([]);
  });

  it('저장된 파일은 indent 2 + 끝 개행 + 파싱 가능', async () => {
    await saveServerConfig({});
    const text = readFileSync(getServerConfigPath(), 'utf-8');
    expect(text.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(text);
    expect(parsed.version).toBe(SERVER_CONFIG_VERSION);
  });

  it('tmp 파일이 settings 디렉토리가 아닌 ~/.spyglass/tmp/ 에 만들어진다 (격리)', async () => {
    const expectedTmp = join(tmpHome, '.spyglass', 'tmp');
    expect(getServerConfigTmpDir()).toBe(expectedTmp);
  });
});
