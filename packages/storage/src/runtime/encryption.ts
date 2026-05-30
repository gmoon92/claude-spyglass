/**
 * 암호화 키 런타임 리졸버 (R3)
 *
 * @description
 *   쓰기·읽기 경로가 공유하는 활성 키 SSoT. 키 자료(env/파일)가 존재하면 옵트인 플래그와
 *   무관하게 로드한다 — 암호화를 끈 뒤에도(SPYGLASS_ENCRYPTION off) 기존 암호문 행 읽기가
 *   깨지지 않도록. 쓰기 암호화 여부는 shouldEncrypt()(플래그 + 키 존재)로 별도 게이트.
 *
 *   키 부재 + 옵트인 ON → 자동 생성(기동 실패 없음). 부재 + OFF → null(평문).
 *
 * @see ../crypto.ts
 * @see docs/architecture/stabilization/adr-r3-at-rest-encryption.md (D4, D5)
 */

import fs from 'node:fs';
import {
  isEncryptionEnabled,
  resolveEncryptionKey,
  parseKeyBase64,
  defaultKeyFilePath,
} from '../crypto';

let cached: Buffer | null | undefined; // undefined=미해석, null=키 없음

function loadKey(env: NodeJS.ProcessEnv): Buffer | null {
  const envKey = env.SPYGLASS_ENCRYPTION_KEY;
  if (envKey && envKey.trim()) return parseKeyBase64(envKey);

  const keyPath = defaultKeyFilePath(env);
  if (fs.existsSync(keyPath)) return parseKeyBase64(fs.readFileSync(keyPath, 'utf8'));

  // 기존 키 자료 없음 — 옵트인 ON일 때만 생성(resolveEncryptionKey가 autoCreate)
  if (isEncryptionEnabled(env)) return resolveEncryptionKey({ env });
  return null;
}

/** 활성 키(읽기·쓰기 공용). 키 자료가 있으면 플래그와 무관하게 반환(복호 보장). */
export function getActiveKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  if (cached === undefined) cached = loadKey(env);
  return cached;
}

/** 신규 쓰기를 암호화할지 — 옵트인 ON + 활성 키 존재 시에만. */
export function shouldEncrypt(env: NodeJS.ProcessEnv = process.env): boolean {
  return isEncryptionEnabled(env) && getActiveKey(env) != null;
}

/** 테스트용 캐시 리셋. */
export function resetEncryptionRuntime(): void {
  cached = undefined;
}
