/**
 * system-hash.ts 단위 테스트.
 *
 * fixture는 inline string으로 박제 — `.claude/.tmp/logs/proxy-payload.jsonl`(git 미추적)에서
 * 추출한 실제 형태를 단순화하여 hash 안정성·dedup 의미를 검증한다.
 *
 * 검증 케이스 (T-02 verification.checklist 매핑):
 *  1. 같은 페르소나 = 동일 hash
 *  2. cache_control TTL 변동(5m ↔ 1h)에도 동일 hash
 *  3. billing-header `cch=` 변동 무시
 *  4. string vs array 형태(단일 본문) 동일 hash
 *  5. 다른 페르소나 = 다른 hash (메인 어시스턴트 vs subagent)
 *  6. system 미존재(null/undefined/빈배열) → null
 *  7. BOM/CRLF 정규화 → 동일 hash
 *  8. cache_control 외 메타 객체 무시
 */

import { describe, expect, it } from 'bun:test';
import { normalizeSystem } from '../system-hash';

const MAIN_BLOCK_1 = "You are Claude Code, Anthropic's official CLI for Claude.";
const MAIN_BLOCK_2 = '\nYou are an interactive agent that helps users with software engineering tasks.';
const SUBAGENT_BLOCK = '# designer\n\nclaude-spyglass UI/UX 전담 디자이너 에이전트입니다.';
const BILLING_HEADER_A = 'x-anthropic-billing-header: cc_version=2.1.126.a42; cc_entrypoint=cli; cch=a00ce';
const BILLING_HEADER_B = 'x-anthropic-billing-header: cc_version=2.1.126.a42; cc_entrypoint=cli; cch=fbea9';

describe('normalizeSystem', () => {
  it('1. 같은 페르소나 = 동일 hash (cache_control 메타 동일, idx[1]+idx[2] 본문 동일)', () => {
    const a = normalizeSystem([
      { type: 'text', text: BILLING_HEADER_A },
      { type: 'text', text: MAIN_BLOCK_1, cache_control: { type: 'ephemeral', ttl: '1h' } },
      { type: 'text', text: MAIN_BLOCK_2, cache_control: { type: 'ephemeral', ttl: '1h' } },
    ]);
    const b = normalizeSystem([
      { type: 'text', text: BILLING_HEADER_B },
      { type: 'text', text: MAIN_BLOCK_1, cache_control: { type: 'ephemeral', ttl: '1h' } },
      { type: 'text', text: MAIN_BLOCK_2, cache_control: { type: 'ephemeral', ttl: '1h' } },
    ]);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.hash).toBe(b!.hash);
    expect(a!.segmentCount).toBe(2); // billing-header 제외, idx[1]+idx[2]만 카운트
  });

  it('2. cache_control TTL 변동(5m ↔ 1h)에도 동일 hash', () => {
    const a = normalizeSystem([
      { type: 'text', text: MAIN_BLOCK_1, cache_control: { type: 'ephemeral', ttl: '5m' } },
    ]);
    const b = normalizeSystem([
      { type: 'text', text: MAIN_BLOCK_1, cache_control: { type: 'ephemeral', ttl: '1h' } },
    ]);
    expect(a!.hash).toBe(b!.hash);
  });

  it('3. billing-header cch 변동 무시 (prefix 매칭으로 제거)', () => {
    const a = normalizeSystem([
      { type: 'text', text: BILLING_HEADER_A },
      { type: 'text', text: MAIN_BLOCK_1 },
    ]);
    const b = normalizeSystem([
      { type: 'text', text: BILLING_HEADER_B },
      { type: 'text', text: MAIN_BLOCK_1 },
    ]);
    expect(a!.hash).toBe(b!.hash);
    expect(a!.segmentCount).toBe(1);
  });

  it('4. string vs single-element array 형태 동일 hash', () => {
    const fromString = normalizeSystem(MAIN_BLOCK_1);
    const fromArray = normalizeSystem([{ type: 'text', text: MAIN_BLOCK_1 }]);
    expect(fromString!.hash).toBe(fromArray!.hash);
    expect(fromString!.segmentCount).toBe(1);
    expect(fromArray!.segmentCount).toBe(1);
  });

  it('5. 다른 페르소나 = 다른 hash (메인 vs subagent)', () => {
    const main = normalizeSystem([
      { type: 'text', text: MAIN_BLOCK_1 },
      { type: 'text', text: MAIN_BLOCK_2 },
    ]);
    const sub = normalizeSystem([{ type: 'text', text: SUBAGENT_BLOCK }]);
    expect(main!.hash).not.toBe(sub!.hash);
  });

  it('6. system 미존재(null/undefined/빈배열/billing-header만) → null', () => {
    expect(normalizeSystem(null)).toBeNull();
    expect(normalizeSystem(undefined)).toBeNull();
    expect(normalizeSystem([])).toBeNull();
    expect(normalizeSystem([{ type: 'text', text: BILLING_HEADER_A }])).toBeNull();
    expect(normalizeSystem(123)).toBeNull(); // 잘못된 타입
  });

  it('7. BOM/CRLF 정규화 → 동일 hash', () => {
    const plain = normalizeSystem(MAIN_BLOCK_1);
    const withBom = normalizeSystem('﻿' + MAIN_BLOCK_1);
    const withCrlf = normalizeSystem(MAIN_BLOCK_1.replace(/\n/g, '\r\n'));
    expect(plain!.hash).toBe(withBom!.hash);
    expect(plain!.hash).toBe(withCrlf!.hash);
  });

  it('8. cache_control 외 메타 객체·잘못된 type 무시', () => {
    const a = normalizeSystem([
      { type: 'text', text: MAIN_BLOCK_1 },
    ]);
    const b = normalizeSystem([
      { type: 'image', source: { type: 'url', url: 'http://x' } } as never, // 다른 type
      { type: 'text', text: MAIN_BLOCK_1, cache_control: { type: 'ephemeral' } },
      { type: 'text' } as never, // text 누락
      null as never, // null 항목
    ]);
    expect(a!.hash).toBe(b!.hash);
    expect(a!.segmentCount).toBe(1);
    expect(b!.segmentCount).toBe(1);
  });

  it('byteSize는 정규화된 본문의 UTF-8 byte 길이', () => {
    const ascii = normalizeSystem('hello');
    expect(ascii!.byteSize).toBe(5);
    const korean = normalizeSystem('안녕'); // UTF-8 6 bytes (2 chars × 3)
    expect(korean!.byteSize).toBe(6);
  });

  it('hash는 SHA-256 hex 64자', () => {
    const r = normalizeSystem(MAIN_BLOCK_1);
    expect(r!.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
