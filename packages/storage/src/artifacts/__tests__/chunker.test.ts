/**
 * chunker — conversation payload split/join round-trip 테스트 (CAS Phase 2)
 *
 * @description
 *   CAS의 정확성은 전적으로 "쪼갠 걸 다시 붙이면 원본과 같은가"에 달려 있다.
 *   이 테스트는 splitConversation → joinConversation 왕복이 JSON semantic 동일함을
 *   회귀 가드로 못박는다. 하나라도 깨지면 /messages 조회가 손상되므로 최우선 안전망이다.
 *
 * @see packages/storage/src/artifacts/chunker.ts
 * @see packages/storage/src/profiler/collectors/chunk-dedup.ts (측정용 원본 청킹 로직)
 */

import { describe, expect, test } from 'bun:test';
import {
  splitConversation,
  joinConversation,
  sha256HexBytes,
} from '../chunker';

/** split → join 후 JSON semantic 동일성 검증 (키 순서 무관, 값 구조 비교). */
function expectRoundTrip(original: unknown): void {
  const text = JSON.stringify(original);
  const split = splitConversation(text);
  expect(split).not.toBeNull();
  const rebuilt = joinConversation(split!.chunks);
  expect(JSON.parse(rebuilt)).toEqual(original);
}

describe('splitConversation / joinConversation round-trip', () => {
  test('system(string) + messages + tools 전체 왕복', () => {
    expectRoundTrip({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      system: '너는 유능한 조수다.',
      messages: [
        { role: 'user', content: '안녕' },
        { role: 'assistant', content: [{ type: 'text', text: '반가워 🙂' }] },
      ],
      tools: [
        { name: 'Read', description: '파일 읽기' },
        { name: 'Bash', description: '쉘 실행' },
      ],
    });
  });

  test('system이 array(content blocks)인 경우', () => {
    expectRoundTrip({
      system: [
        { type: 'text', text: '시스템 A' },
        { type: 'text', text: '시스템 B', cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: 'hi' }],
    });
  });

  test('message content가 string / object 혼재', () => {
    expectRoundTrip({
      messages: [
        { role: 'user', content: 'plain string' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'X', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
      ],
    });
  });

  test('tools 없음', () => {
    expectRoundTrip({
      system: 'no tools here',
      messages: [{ role: 'user', content: 'q' }],
    });
  });

  test('빈 messages 배열', () => {
    expectRoundTrip({ model: 'm', messages: [] });
  });

  test('system 없음 (messages만)', () => {
    expectRoundTrip({ messages: [{ role: 'user', content: 'only' }] });
  });

  test('추가 top-level 키(metadata, temperature, stop_sequences) 보존', () => {
    expectRoundTrip({
      model: 'claude',
      max_tokens: 200,
      temperature: 0.7,
      stop_sequences: ['\n\n'],
      metadata: { user_id: 'abc' },
      system: 'sys',
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ name: 'T' }],
    });
  });

  test('유니코드/이모지/중첩 구조 바이트 보존', () => {
    expectRoundTrip({
      system: '한글 🐣 \n줄바꿈\t탭',
      messages: [
        { role: 'user', content: [{ type: 'text', text: '깊은 { 중괄호 } 와 "따옴표"' }] },
      ],
    });
  });
});

describe('splitConversation — 비대상 입력은 null (통짜 fallback 신호)', () => {
  test('JSON 파싱 불가 → null', () => {
    expect(splitConversation('not json at all')).toBeNull();
    expect(splitConversation('{broken')).toBeNull();
  });

  test('JSON이지만 객체가 아님(배열/스칼라) → null', () => {
    expect(splitConversation('[1,2,3]')).toBeNull();
    expect(splitConversation('42')).toBeNull();
    expect(splitConversation('"str"')).toBeNull();
    expect(splitConversation('null')).toBeNull();
  });
});

describe('청크 구성 — dedup 안정성', () => {
  test('seq0은 envelope, 이후 system/messages/tools 순서로 분해', () => {
    const text = JSON.stringify({
      system: 'S',
      messages: [{ role: 'user', content: 'A' }, { role: 'user', content: 'B' }],
      tools: [{ name: 'T1' }],
    });
    const split = splitConversation(text)!;
    // envelope(1) + system(1) + messages(2) + tools(1) = 5 청크
    expect(split.chunks.length).toBe(5);
  });

  test('동일 블록은 동일 청크 문자열 산출 (해시 안정 → dedup 성립)', () => {
    const msg = { role: 'user', content: '반복되는 턴' };
    const a = splitConversation(JSON.stringify({ messages: [msg, { role: 'assistant', content: 'r' }] }))!;
    const b = splitConversation(JSON.stringify({ messages: [msg, { role: 'user', content: '다른 후속' }] }))!;
    // 두 payload의 첫 message 청크가 동일 문자열 → 동일 해시 → CAS dedup
    const msgChunkA = a.chunks[1]; // envelope=0, 첫 message=1 (system 없음)
    const msgChunkB = b.chunks[1];
    expect(msgChunkA).toBe(msgChunkB);
    expect(sha256HexBytes(new TextEncoder().encode(msgChunkA))).toBe(
      sha256HexBytes(new TextEncoder().encode(msgChunkB)),
    );
  });
});

describe('sha256HexBytes — 평문 기준 결정성', () => {
  test('동일 입력 동일 해시, 64자 hex', () => {
    const bytes = new TextEncoder().encode('hello');
    const h1 = sha256HexBytes(bytes);
    const h2 = sha256HexBytes(new TextEncoder().encode('hello'));
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  test('다른 입력 다른 해시', () => {
    expect(sha256HexBytes(new TextEncoder().encode('a'))).not.toBe(
      sha256HexBytes(new TextEncoder().encode('b')),
    );
  });
});
