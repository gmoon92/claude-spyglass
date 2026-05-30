/**
 * crypto — AES-256-GCM + 키 해석 단위 테스트 (R3)
 *
 * @see packages/storage/src/crypto.ts
 * @see docs/architecture/stabilization/adr-r3-at-rest-encryption.md
 */

import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import {
  encryptBytes,
  decryptBytes,
  generateKey,
  parseKeyBase64,
  isEncryptionEnabled,
  resolveEncryptionKey,
  defaultKeyFilePath,
} from '../crypto';

const enc = new TextEncoder();
const dec = new TextDecoder();
const tmpFiles: string[] = [];

function tmpKeyPath(): string {
  const p = `${os.tmpdir()}/spyglass-key-${Math.floor(performance.now() * 1000)}-${tmpFiles.length}.key`;
  tmpFiles.push(p);
  return p;
}

afterEach(() => {
  for (const f of tmpFiles.splice(0)) {
    try { fs.rmSync(f, { force: true }); } catch { /* noop */ }
  }
});

describe('encryptBytes/decryptBytes', () => {
  test('round-trip은 원문을 복원한다', () => {
    const key = generateKey();
    const plain = enc.encode('대화 본문 — secret 🙂');
    const framed = encryptBytes(plain, key);
    expect(dec.decode(decryptBytes(framed, key))).toBe('대화 본문 — secret 🙂');
  });

  test('동일 평문도 매번 다른 암호문(nonce 랜덤)', () => {
    const key = generateKey();
    const plain = enc.encode('same plaintext');
    const a = Buffer.from(encryptBytes(plain, key)).toString('hex');
    const b = Buffer.from(encryptBytes(plain, key)).toString('hex');
    expect(a).not.toBe(b);
  });

  test('변조된 암호문은 복호 시 예외(GCM 무결성)', () => {
    const key = generateKey();
    const framed = Buffer.from(encryptBytes(enc.encode('x'), key));
    framed[framed.length - 1] ^= 0xff; // ciphertext 마지막 바이트 변조
    expect(() => decryptBytes(framed, key)).toThrow();
  });

  test('잘못된 키는 복호 실패', () => {
    const framed = encryptBytes(enc.encode('x'), generateKey());
    expect(() => decryptBytes(framed, generateKey())).toThrow();
  });

  test('너무 짧은 프레이밍은 예외', () => {
    expect(() => decryptBytes(new Uint8Array([1, 2, 3]), generateKey())).toThrow();
  });
});

describe('parseKeyBase64', () => {
  test('32바이트 키를 파싱한다', () => {
    const b64 = generateKey().toString('base64');
    expect(parseKeyBase64(b64).length).toBe(32);
  });
  test('길이가 틀리면 예외', () => {
    expect(() => parseKeyBase64(Buffer.from('short').toString('base64'))).toThrow();
  });
});

describe('isEncryptionEnabled', () => {
  test('1/true/yes/on은 true, 그 외는 false', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on']) {
      expect(isEncryptionEnabled({ SPYGLASS_ENCRYPTION: v } as NodeJS.ProcessEnv)).toBe(true);
    }
    for (const v of ['', '0', 'false', 'off', undefined as unknown as string]) {
      expect(isEncryptionEnabled({ SPYGLASS_ENCRYPTION: v } as NodeJS.ProcessEnv)).toBe(false);
    }
    expect(isEncryptionEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('resolveEncryptionKey', () => {
  test('비활성(OFF)이면 null', () => {
    expect(resolveEncryptionKey({ env: {} as NodeJS.ProcessEnv })).toBeNull();
  });

  test('env 키 우선', () => {
    const b64 = generateKey().toString('base64');
    const key = resolveEncryptionKey({
      env: { SPYGLASS_ENCRYPTION: '1', SPYGLASS_ENCRYPTION_KEY: b64 } as NodeJS.ProcessEnv,
      autoCreate: false,
    });
    expect(key?.toString('base64')).toBe(b64);
  });

  test('키파일이 있으면 파일에서 로드', () => {
    const path = tmpKeyPath();
    const k = generateKey();
    fs.writeFileSync(path, k.toString('base64'), { mode: 0o600 });
    const key = resolveEncryptionKey({
      env: { SPYGLASS_ENCRYPTION: '1' } as NodeJS.ProcessEnv,
      keyFilePath: path,
      autoCreate: false,
    });
    expect(key?.toString('base64')).toBe(k.toString('base64'));
  });

  test('키 부재 + autoCreate이면 0600 키파일 생성', () => {
    const path = tmpKeyPath();
    const key = resolveEncryptionKey({
      env: { SPYGLASS_ENCRYPTION: '1' } as NodeJS.ProcessEnv,
      keyFilePath: path,
    });
    expect(key?.length).toBe(32);
    expect(fs.existsSync(path)).toBe(true);
    const mode = fs.statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
    // 재해석 시 같은 키
    const again = resolveEncryptionKey({
      env: { SPYGLASS_ENCRYPTION: '1' } as NodeJS.ProcessEnv,
      keyFilePath: path,
    });
    expect(again?.toString('base64')).toBe(key?.toString('base64'));
  });

  test('autoCreate=false + 키 부재면 null', () => {
    const key = resolveEncryptionKey({
      env: { SPYGLASS_ENCRYPTION: '1' } as NodeJS.ProcessEnv,
      keyFilePath: tmpKeyPath(),
      autoCreate: false,
    });
    expect(key).toBeNull();
  });
});

describe('defaultKeyFilePath', () => {
  test('HOME 하위 .spyglass/encryption.key', () => {
    expect(defaultKeyFilePath({ HOME: '/home/u' } as NodeJS.ProcessEnv)).toBe('/home/u/.spyglass/encryption.key');
  });
});
