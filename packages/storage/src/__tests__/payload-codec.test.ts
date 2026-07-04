/**
 * payload-codec — algo 분기 인코드/디코드 + 혼재 행 단위 테스트 (R3)
 *
 * @see packages/storage/src/payload-codec.ts
 * @see docs/architecture/stabilization/adr-r3-at-rest-encryption.md
 */

import { describe, expect, test } from 'bun:test';
import { generateKey } from '../crypto';
import {
  encodeText,
  decodeText,
  encodeBlob,
  decodeBlob,
  type PayloadAlgo,
} from '../payload-codec';

const dec = new TextDecoder();
const enc = new TextEncoder();
const SAMPLE = JSON.stringify({ role: 'user', content: '민감 대화 본문 🙂', n: 42 });

describe('TEXT codec (requests/claude_events/system_prompts)', () => {
  test('key 없으면 평문 그대로(algo null)', () => {
    const { value, algo } = encodeText(SAMPLE, null);
    expect(value).toBe(SAMPLE);
    expect(algo).toBeNull();
    expect(decodeText(value, algo, null)).toBe(SAMPLE);
  });

  test('key 있으면 base64 암호문 + round-trip', () => {
    const key = generateKey();
    const { value, algo } = encodeText(SAMPLE, key);
    expect(algo).toBe('aes256gcm');
    expect(value).not.toContain('민감'); // 평문 노출 없음
    expect(decodeText(value, algo, key)).toBe(SAMPLE);
  });

  test('평문/암호문 혼재 동시 디코드', () => {
    const key = generateKey();
    const plainRow = encodeText(SAMPLE, null);          // 기존 평문 행
    const encRow = encodeText(SAMPLE, key);             // 신규 암호문 행
    expect(decodeText(plainRow.value, plainRow.algo, key)).toBe(SAMPLE);
    expect(decodeText(encRow.value, encRow.algo, key)).toBe(SAMPLE);
  });

  test('null 값은 null 반환', () => {
    expect(decodeText(null, null, null)).toBeNull();
    expect(decodeText(null, 'aes256gcm', generateKey())).toBeNull();
  });

  test('암호문인데 키 없으면 예외(silent corruption 방지)', () => {
    const { value, algo } = encodeText(SAMPLE, generateKey());
    expect(() => decodeText(value, algo, null)).toThrow();
  });

  test("legacy/죽은 마커('zstd')는 평문으로 passthrough (requests.payload_algo DEFAULT 대응)", () => {
    // requests.payload는 TEXT 평문인데 payload_algo DEFAULT가 'zstd'인 기존 행 시나리오
    expect(decodeText(SAMPLE, 'zstd', null)).toBe(SAMPLE);
    expect(decodeText(SAMPLE, 'unknown-future', null)).toBe(SAMPLE);
  });
});

describe('TEXT codec — zstd 압축 (Phase 4)', () => {
  // 512B 임계값 이상 + 압축 이득 있는 평문(반복 JSON류).
  const BIG = JSON.stringify({ log: 'tool output line 반복 '.repeat(80), n: 1 });

  test('큰 평문(key 없음) → zstd-b64 압축 + round-trip', () => {
    const { value, algo } = encodeText(BIG, null);
    expect(algo).toBe('zstd-b64');
    expect(value.length).toBeLessThan(BIG.length); // 실제 압축됨
    expect(decodeText(value, algo, null)).toBe(BIG);
  });

  test('큰 평문(key 있음) → zstd-b64+aes256gcm + round-trip + 평문 비노출', () => {
    const key = generateKey();
    const { value, algo } = encodeText(BIG, key);
    expect(algo).toBe('zstd-b64+aes256gcm');
    expect(value).not.toContain('tool output'); // 평문 노출 없음
    expect(decodeText(value, algo, key)).toBe(BIG);
  });

  test('작은 평문(임계값 미만)은 압축 안 함 — 기존 동작 유지', () => {
    expect(encodeText(SAMPLE, null).algo).toBeNull();            // 평문
    expect(encodeText(SAMPLE, generateKey()).algo).toBe('aes256gcm'); // AES만
  });

  test('평문/aes/zstd-b64/zstd-b64+aes 4종 혼재 동시 디코드', () => {
    const key = generateKey();
    const rows = [
      encodeText(SAMPLE, null),   // 평문
      encodeText(SAMPLE, key),    // aes256gcm
      encodeText(BIG, null),      // zstd-b64
      encodeText(BIG, key),       // zstd-b64+aes256gcm
    ];
    expect(decodeText(rows[0].value, rows[0].algo, key)).toBe(SAMPLE);
    expect(decodeText(rows[1].value, rows[1].algo, key)).toBe(SAMPLE);
    expect(decodeText(rows[2].value, rows[2].algo, key)).toBe(BIG);
    expect(decodeText(rows[3].value, rows[3].algo, key)).toBe(BIG);
  });

  test('zstd-b64(암호화 아님)은 key 없이도 복원', () => {
    const { value, algo } = encodeText(BIG, null);
    expect(decodeText(value, algo, null)).toBe(BIG);
  });

  test('zstd-b64+aes256gcm을 key 없이 디코드하면 예외(silent corruption 방지)', () => {
    const { value, algo } = encodeText(BIG, generateKey());
    expect(() => decodeText(value, algo, null)).toThrow();
  });
});

describe('BLOB codec (proxy_requests.payload)', () => {
  const raw = enc.encode(SAMPLE);

  test('key 없으면 zstd만(기존 동작) + round-trip', () => {
    const { value, algo } = encodeBlob(raw, null);
    expect(algo).toBe('zstd');
    expect(dec.decode(decodeBlob(value, algo, null)!)).toBe(SAMPLE);
  });

  test('key 있으면 zstd+aes256gcm + round-trip', () => {
    const key = generateKey();
    const { value, algo } = encodeBlob(raw, key);
    expect(algo).toBe('zstd+aes256gcm');
    expect(dec.decode(decodeBlob(value, algo, key)!)).toBe(SAMPLE);
  });

  test('algo 누락은 zstd로 간주(레거시 호환)', () => {
    const { value } = encodeBlob(raw, null);
    expect(dec.decode(decodeBlob(value, null, null)!)).toBe(SAMPLE);
    expect(dec.decode(decodeBlob(value, undefined, null)!)).toBe(SAMPLE);
  });

  test('zstd/암호문 혼재 동시 디코드', () => {
    const key = generateKey();
    const zstdRow = encodeBlob(raw, null);
    const encRow = encodeBlob(raw, key);
    expect(dec.decode(decodeBlob(zstdRow.value, zstdRow.algo, key)!)).toBe(SAMPLE);
    expect(dec.decode(decodeBlob(encRow.value, encRow.algo, key)!)).toBe(SAMPLE);
  });

  test('암호문인데 키 없으면 예외', () => {
    const { value, algo } = encodeBlob(raw, generateKey());
    expect(() => decodeBlob(value, algo, null)).toThrow();
  });

  test('지원하지 않는 algo는 예외', () => {
    expect(() => decodeBlob(enc.encode('x'), 'bogus' as PayloadAlgo, null)).toThrow();
  });
});
