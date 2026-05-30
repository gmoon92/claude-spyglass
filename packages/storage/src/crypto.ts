/**
 * At-rest 컬럼 암호화 — AES-256-GCM (R3)
 *
 * @description
 *   민감 본문 컬럼(payload/content)을 디스크 저장 직전 인증 암호화한다.
 *   프레이밍: [version(1) | nonce(12) | tag(16) | ciphertext]. nonce는 레코드 단위
 *   randomBytes(12)로 내부 생성만 한다(외부 주입 금지 — nonce 재사용 차단).
 *   GCM auth tag로 변조를 검출한다(복호 시 final()에서 예외).
 *
 *   키는 파일 밖(OS/배포) 분리: env > 키파일(0600) > 최초 자동 생성. KDF 없음
 *   (고엔트로피 랜덤 32B 키). 암호화는 옵트인(SPYGLASS_ENCRYPTION) — 기본 OFF=평문.
 *
 * @see docs/architecture/stabilization/adr-r3-at-rest-encryption.md (D1, D4, D5)
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import fs from 'node:fs';

const ALGO = 'aes-256-gcm';
const NONCE_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const VERSION = 1;

const ENABLE_VALUES = new Set(['1', 'true', 'yes', 'on']);

/** 암호화 옵트인 여부 (SPYGLASS_ENCRYPTION ∈ {1,true,yes,on}). 기본 OFF. */
export function isEncryptionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.SPYGLASS_ENCRYPTION ?? '').toString().toLowerCase().trim();
  return ENABLE_VALUES.has(v);
}

/** 새 256-bit 키 생성. */
export function generateKey(): Buffer {
  return randomBytes(KEY_LEN);
}

/** base64 문자열 → 32바이트 키 (길이 검증). */
export function parseKeyBase64(b64: string): Buffer {
  const key = Buffer.from((b64 ?? '').trim(), 'base64');
  if (key.length !== KEY_LEN) {
    throw new Error(`encryption key must be ${KEY_LEN} bytes (got ${key.length})`);
  }
  return key;
}

/**
 * 평문 바이트 → 프레이밍된 암호문 [version|nonce|tag|ciphertext].
 * nonce는 매 호출 새로 생성된다(외부 주입 불가).
 */
export function encryptBytes(plain: Uint8Array, key: Buffer): Uint8Array {
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv(ALGO, key, nonce);
  const ct = Buffer.concat([cipher.update(Buffer.from(plain)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), nonce, tag, ct]);
}

/**
 * 프레이밍된 암호문 → 평문 바이트. 변조/잘못된 키면 예외(GCM 무결성).
 */
export function decryptBytes(framed: Uint8Array, key: Buffer): Uint8Array {
  const buf = Buffer.from(framed);
  if (buf.length < 1 + NONCE_LEN + TAG_LEN) {
    throw new Error('decryptBytes: framed payload too short');
  }
  const version = buf[0];
  if (version !== VERSION) {
    throw new Error(`decryptBytes: unsupported payload version ${version}`);
  }
  const nonce = buf.subarray(1, 1 + NONCE_LEN);
  const tag = buf.subarray(1 + NONCE_LEN, 1 + NONCE_LEN + TAG_LEN);
  const ct = buf.subarray(1 + NONCE_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

// =============================================================================
// 키 해석 (env > 키파일 > 자동 생성)
// =============================================================================

export interface ResolveKeyOptions {
  /** 환경변수 소스 (테스트 주입용). 기본 process.env */
  env?: NodeJS.ProcessEnv;
  /** 키파일 경로. 기본 ~/.spyglass/encryption.key */
  keyFilePath?: string;
  /** 키 부재 시 자동 생성 여부. 기본 true */
  autoCreate?: boolean;
}

/** 기본 키파일 경로 — DB와 같은 디렉토리(통째 유출 시 무력, ADR D4에 문서화). */
export function defaultKeyFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME || env.USERPROFILE || '.';
  return `${home}/.spyglass/encryption.key`;
}

function writeKeyFile(keyPath: string, key: Buffer): void {
  const dir = keyPath.substring(0, keyPath.lastIndexOf('/'));
  if (dir) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyPath, key.toString('base64'), { mode: 0o600 });
  try {
    fs.chmodSync(keyPath, 0o600);
  } catch {
    // best-effort (예: readonly fs)
  }
}

/**
 * 활성 암호화 키를 해석한다.
 * - 암호화 비활성(OFF)이면 null (평문 경로).
 * - env SPYGLASS_ENCRYPTION_KEY(base64 32B) 우선.
 * - 없으면 키파일. 없으면 autoCreate 시 생성(0600). 기동 실패 없음.
 */
export function resolveEncryptionKey(opts: ResolveKeyOptions = {}): Buffer | null {
  const env = opts.env ?? process.env;
  if (!isEncryptionEnabled(env)) return null;

  const envKey = env.SPYGLASS_ENCRYPTION_KEY;
  if (envKey && envKey.trim()) return parseKeyBase64(envKey);

  const keyPath = opts.keyFilePath ?? defaultKeyFilePath(env);
  if (fs.existsSync(keyPath)) {
    return parseKeyBase64(fs.readFileSync(keyPath, 'utf8'));
  }
  if (opts.autoCreate !== false) {
    const key = generateKey();
    writeKeyFile(keyPath, key);
    return key;
  }
  return null;
}
