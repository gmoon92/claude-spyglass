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

export type PayloadAlgo =
  | 'zstd'
  | 'aes256gcm'
  | 'zstd+aes256gcm'
  // Phase 4 — TEXT 컬럼 압축: zstd(평문)→base64. +aes는 zstd→AES→base64.
  // BLOB의 'zstd'/'zstd+aes256gcm'과 이름을 구분(-b64)해 decodeText/decodeBlob 분기 혼동을 막는다.
  | 'zstd-b64'
  | 'zstd-b64+aes256gcm'
  | null
  | undefined;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * TEXT 압축 임계값(byte). 이 미만은 압축하지 않는다 — 짧은 payload는 zstd 프레임 오버헤드로
 * 오히려 커지고, dedup/조회 이득도 없다. dev 실측상 request_payloads의 상당수가 256B 미만이라
 * 여유를 둬 512B로 잡는다.
 */
const TEXT_COMPRESS_MIN_BYTES = 512;

// =============================================================================
// TEXT 컬럼 (requests.payload, claude_events.payload, system_prompts.content)
// =============================================================================

/**
 * 평문 string → 저장값+algo.
 *  - 512B 이상이고 압축 이득이 있으면 zstd(→base64), key 있으면 zstd→AES(→base64).
 *  - 그 외에는 기존 동작: key 없으면 평문 그대로(algo null), 있으면 AES(algo 'aes256gcm').
 * 해시(dedup)는 호출자가 '평문' 기준으로 계산하므로 압축 여부와 무관하다.
 */
export function encodeText(
  plain: string,
  key: Buffer | null,
): { value: string; algo: PayloadAlgo } {
  const raw = encoder.encode(plain);
  if (raw.byteLength >= TEXT_COMPRESS_MIN_BYTES) {
    const compressed = Bun.zstdCompressSync(raw);
    // 압축 이득이 있을 때만 압축 경로 채택(랜덤/이미 압축된 데이터는 커질 수 있음).
    if (compressed.byteLength < raw.byteLength) {
      if (!key) {
        return { value: Buffer.from(compressed).toString('base64'), algo: 'zstd-b64' };
      }
      const framed = encryptBytes(compressed, key);
      return { value: Buffer.from(framed).toString('base64'), algo: 'zstd-b64+aes256gcm' };
    }
  }
  if (!key) return { value: plain, algo: null };
  const framed = encryptBytes(raw, key);
  return { value: Buffer.from(framed).toString('base64'), algo: 'aes256gcm' };
}

/**
 * 저장값+algo → 평문 string. 평문/암호문/압축 혼재 모두 처리.
 * algo는 DB 컬럼(string|null)에서 직접 와도 되도록 넓게 받고, 미지원 값은 throw로 검증한다.
 */
export function decodeText(
  value: string | null,
  algo: string | null | undefined,
  key: Buffer | null,
): string | null {
  if (value == null) return value;
  // 'aes256gcm': base64 → AES 복호. 'zstd-b64': base64 → unzstd. 'zstd-b64+aes256gcm': base64 → AES → unzstd.
  // 그 외 값(NULL, 그리고 requests.payload_algo의 죽은 DEFAULT 'zstd' — 평문 TEXT)은 평문 passthrough.
  // 암호화 마커 + 키부재만 throw(암호문을 못 읽는 진짜 위험).
  if (algo === 'aes256gcm') {
    if (!key) throw new Error('decodeText: encrypted value but no key available');
    return decoder.decode(decryptBytes(Buffer.from(value, 'base64'), key));
  }
  if (algo === 'zstd-b64') {
    return decoder.decode(Bun.zstdDecompressSync(Buffer.from(value, 'base64')));
  }
  if (algo === 'zstd-b64+aes256gcm') {
    if (!key) throw new Error('decodeText: encrypted value but no key available');
    return decoder.decode(Bun.zstdDecompressSync(decryptBytes(Buffer.from(value, 'base64'), key)));
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
