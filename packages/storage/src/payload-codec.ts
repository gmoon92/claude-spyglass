/**
 * Payload codec — payload_algo 분기 단일 진실 소스 (R3)
 *
 * @description
 *   본문 컬럼의 인코드/디코드 분기를 한 곳에 모은다. 분기가 분산되면(현 proxy 디코드
 *   3곳이 payload_algo를 무시하고 무조건 zstd) 한 곳만 빠뜨려도 silent corruption이
 *   발생하므로, 모든 쓰기/읽기는 이 모듈만 경유한다.
 *
 *   두 저장 형태:
 *   - TEXT 컬럼(requests.payload·claude_events.payload·system_prompts.content):
 *     평문은 string 그대로(algo NULL), 암호문은 base64([ver|nonce|tag|ct]) string(algo 'aes256gcm').
 *     → string→BLOB 타입 변경 없음(R7 비해당).
 *   - BLOB 컬럼(proxy_requests.payload): zstd(raw)(algo 'zstd') 또는 encrypt(zstd(raw))(algo 'zstd+aes256gcm').
 *
 * @see docs/architecture/stabilization/adr-r3-at-rest-encryption.md (D2, D3)
 * @see ./crypto.ts
 */

import { encryptBytes, decryptBytes } from './crypto';

export type PayloadAlgo = 'zstd' | 'aes256gcm' | 'zstd+aes256gcm' | null | undefined;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// =============================================================================
// TEXT 컬럼 (requests.payload, claude_events.payload, system_prompts.content)
// =============================================================================

/** 평문 string → 저장값+algo. key 없으면 평문 그대로(기존 동작). */
export function encodeText(
  plain: string,
  key: Buffer | null,
): { value: string; algo: PayloadAlgo } {
  if (!key) return { value: plain, algo: null };
  const framed = encryptBytes(encoder.encode(plain), key);
  return { value: Buffer.from(framed).toString('base64'), algo: 'aes256gcm' };
}

/**
 * 저장값+algo → 평문 string. 평문/암호문 혼재 모두 처리.
 * algo는 DB 컬럼(string|null)에서 직접 와도 되도록 넓게 받고, 미지원 값은 throw로 검증한다.
 */
export function decodeText(
  value: string | null,
  algo: string | null | undefined,
  key: Buffer | null,
): string | null {
  if (value == null) return value;
  // TEXT 컬럼의 암호화 마커는 'aes256gcm' 하나뿐. 그 외 값(NULL, 그리고 requests.payload_algo의
  // 죽은 DEFAULT 'zstd' — 021이 넣었으나 requests.payload는 실제 압축된 적 없는 평문 TEXT)은
  // 모두 평문으로 간주해 passthrough한다. 'aes256gcm'+키부재만 throw(암호문을 못 읽는 진짜 위험).
  if (algo === 'aes256gcm') {
    if (!key) throw new Error('decodeText: encrypted value but no key available');
    const framed = Buffer.from(value, 'base64');
    return decoder.decode(decryptBytes(framed, key));
  }
  return value;
}

// =============================================================================
// BLOB 컬럼 (proxy_requests.payload — zstd 압축 기반)
// =============================================================================

/** raw 바이트 → 저장 BLOB+algo. key 없으면 zstd만(기존 동작). */
export function encodeBlob(
  raw: Uint8Array,
  key: Buffer | null,
): { value: Uint8Array; algo: PayloadAlgo } {
  const compressed = Bun.zstdCompressSync(raw);
  if (!key) return { value: compressed, algo: 'zstd' };
  return { value: encryptBytes(compressed, key), algo: 'zstd+aes256gcm' };
}

/**
 * 저장 BLOB+algo → raw(decompressed) 바이트. 호출자가 TextDecoder/JSON.parse.
 * algo 누락은 'zstd'로 간주(proxy는 항상 zstd였음 — 레거시 호환).
 */
export function decodeBlob(
  value: Uint8Array | null,
  algo: string | null | undefined,
  key: Buffer | null,
): Uint8Array | null {
  if (value == null) return value;
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBufferLike);
  const a = algo ?? 'zstd';
  if (a === 'zstd') return Bun.zstdDecompressSync(bytes);
  if (a === 'aes256gcm') {
    if (!key) throw new Error('decodeBlob: encrypted value but no key available');
    return decryptBytes(bytes, key);
  }
  if (a === 'zstd+aes256gcm') {
    if (!key) throw new Error('decodeBlob: encrypted value but no key available');
    return Bun.zstdDecompressSync(decryptBytes(bytes, key));
  }
  throw new Error(`decodeBlob: unsupported algo '${a}' for BLOB column`);
}
