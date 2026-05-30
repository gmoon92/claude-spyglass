/**
 * 암호화 키 런타임 리졸버 단위 테스트 (R3)
 *
 * @see packages/storage/src/runtime/encryption.ts
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import { generateKey } from '../crypto';
import { getActiveKey, shouldEncrypt, resetEncryptionRuntime } from '../runtime/encryption';

const homes: string[] = [];

function tmpHome(): string {
  const h = `${os.tmpdir()}/spyglass-home-${Math.floor(performance.now() * 1000)}-${homes.length}`;
  fs.mkdirSync(`${h}/.spyglass`, { recursive: true });
  homes.push(h);
  return h;
}

beforeEach(() => resetEncryptionRuntime());
afterEach(() => {
  resetEncryptionRuntime();
  for (const h of homes.splice(0)) {
    try { fs.rmSync(h, { recursive: true, force: true }); } catch { /* noop */ }
  }
});

describe('getActiveKey / shouldEncrypt', () => {
  test('플래그 OFF + 키 자료 없음 → null, 암호화 안 함', () => {
    const env = { HOME: tmpHome() } as NodeJS.ProcessEnv;
    expect(getActiveKey(env)).toBeNull();
    expect(shouldEncrypt(env)).toBe(false);
  });

  test('플래그 ON + env 키 → 키 반환, 암호화함', () => {
    const b64 = generateKey().toString('base64');
    const env = { HOME: tmpHome(), SPYGLASS_ENCRYPTION: '1', SPYGLASS_ENCRYPTION_KEY: b64 } as NodeJS.ProcessEnv;
    expect(getActiveKey(env)?.toString('base64')).toBe(b64);
    expect(shouldEncrypt(env)).toBe(true);
  });

  test('플래그 OFF + 키파일 존재 → 키 로드(복호 보장), 단 쓰기 암호화는 안 함', () => {
    const home = tmpHome();
    const k = generateKey();
    fs.writeFileSync(`${home}/.spyglass/encryption.key`, k.toString('base64'), { mode: 0o600 });
    const env = { HOME: home } as NodeJS.ProcessEnv; // SPYGLASS_ENCRYPTION 미설정(OFF)
    expect(getActiveKey(env)?.toString('base64')).toBe(k.toString('base64')); // 끈 뒤에도 읽기용 키 로드
    expect(shouldEncrypt(env)).toBe(false); // 쓰기는 평문
  });

  test('플래그 ON + 키 부재 → 자동 생성(파일 0600), 암호화함', () => {
    const home = tmpHome();
    const env = { HOME: home, SPYGLASS_ENCRYPTION: 'true' } as NodeJS.ProcessEnv;
    const key = getActiveKey(env);
    expect(key?.length).toBe(32);
    const path = `${home}/.spyglass/encryption.key`;
    expect(fs.existsSync(path)).toBe(true);
    expect(fs.statSync(path).mode & 0o777).toBe(0o600);
    expect(shouldEncrypt(env)).toBe(true);
  });

  test('캐시: 첫 해석 후 동일 키 반환', () => {
    const b64 = generateKey().toString('base64');
    const env = { HOME: tmpHome(), SPYGLASS_ENCRYPTION: '1', SPYGLASS_ENCRYPTION_KEY: b64 } as NodeJS.ProcessEnv;
    const a = getActiveKey(env);
    const b = getActiveKey({ HOME: tmpHome() } as NodeJS.ProcessEnv); // 캐시되어 env 무시
    expect(b?.toString('base64')).toBe(a?.toString('base64'));
  });
});
