/**
 * SSE `new_request` 페이로드 contract 단위 테스트 (ADR-002 검증)
 *
 * @description
 *   `buildNewRequestEvent` pure function이 페이로드 구조를 보장하는지 검증.
 *   broadcastNewRequest는 연결 Set에 의존(외부 effect)이라, 페이로드 contract만 분리 테스트.
 *
 * 검증 포인트:
 *   1. type === 'new_request' (단일 채널, ADR-002)
 *   2. data에 NormalizedRequest 모든 필드 포함 (cache_*, event_type, tokens_source 등)
 *   3. data.event_phase 기본값 'created'
 *   4. data.event_phase: 'updated' 명시 시 그대로 송출
 *   5. data.session_total_tokens 포함
 *   6. data.sub_type / trust_level / model_fallback_applied 포함 (정규화 결과 보존)
 */

import { describe, expect, test } from 'bun:test';
import { buildNewRequestEvent } from '../sse';
import type { NormalizedRequest } from '../domain/request-normalizer';

function fakeNormalized(overrides: Partial<NormalizedRequest> = {}): NormalizedRequest {
  return {
    id: 'r-1',
    session_id: 'sess-1',
    timestamp: 1_000_000_000_000,
    type: 'tool_call',
    tokens_input: 10,
    tokens_output: 20,
    tokens_total: 30,
    duration_ms: 50,
    sub_type: null,
    trust_level: 'trusted',
    model: 'claude-opus-4-7',
    model_fallback_applied: false,
    ...overrides,
  };
}

describe('buildNewRequestEvent — 채널/타입', () => {
  test('이벤트 type은 항상 "new_request" (별도 request_updated 신설 안 함, ADR-002)', () => {
    const evt = buildNewRequestEvent(fakeNormalized(), { session_total_tokens: 100 });
    expect(evt.type).toBe('new_request');
  });
});

describe('buildNewRequestEvent — event_phase discriminator', () => {
  test('event_phase 미지정 시 기본값 "created"', () => {
    const evt = buildNewRequestEvent(fakeNormalized(), { session_total_tokens: 100 });
    expect(evt.data?.event_phase).toBe('created');
  });

  test('event_phase: "created" 명시 시 그대로', () => {
    const evt = buildNewRequestEvent(fakeNormalized(), {
      session_total_tokens: 100,
      event_phase: 'created',
    });
    expect(evt.data?.event_phase).toBe('created');
  });

  test('event_phase: "updated" 명시 시 그대로 (backfill 흐름)', () => {
    const evt = buildNewRequestEvent(fakeNormalized(), {
      session_total_tokens: 100,
      event_phase: 'updated',
    });
    expect(evt.data?.event_phase).toBe('updated');
  });
});

describe('buildNewRequestEvent — NormalizedRequest 필드 보존', () => {
  test('정규화 파생 필드(sub_type, trust_level, model_fallback_applied) 포함', () => {
    const evt = buildNewRequestEvent(
      fakeNormalized({
        sub_type: 'agent',
        trust_level: 'unknown',
        model_fallback_applied: true,
      }),
      { session_total_tokens: 0 },
    );
    expect(evt.data?.sub_type).toBe('agent');
    expect(evt.data?.trust_level).toBe('unknown');
    expect(evt.data?.model_fallback_applied).toBe(true);
  });

  test('이전 SSE 페이로드에서 누락됐던 필드(cache_*, event_type, tokens_source, api_request_id) 포함', () => {
    const evt = buildNewRequestEvent(
      fakeNormalized({
        cache_creation_tokens: 100,
        cache_read_tokens: 200,
        event_type: 'tool',
        tokens_source: 'transcript',
        tokens_confidence: 'high',
        api_request_id: 'api-001',
        parent_tool_use_id: 'parent-tool-x',
      }),
      { session_total_tokens: 500 },
    );
    expect(evt.data?.cache_creation_tokens).toBe(100);
    expect(evt.data?.cache_read_tokens).toBe(200);
    expect(evt.data?.event_type).toBe('tool');
    expect(evt.data?.tokens_source).toBe('transcript');
    expect(evt.data?.tokens_confidence).toBe('high');
    expect(evt.data?.api_request_id).toBe('api-001');
    expect(evt.data?.parent_tool_use_id).toBe('parent-tool-x');
  });

  test('id, session_id, type 등 필수 필드 모두 동봉', () => {
    const evt = buildNewRequestEvent(
      fakeNormalized({ id: 'r-99', session_id: 'sess-9', type: 'response' }),
      { session_total_tokens: 0 },
    );
    expect(evt.data?.id).toBe('r-99');
    expect(evt.data?.session_id).toBe('sess-9');
    expect(evt.data?.type).toBe('response');
  });

  test('session_total_tokens 포함 (사이드바 갱신용)', () => {
    const evt = buildNewRequestEvent(fakeNormalized(), { session_total_tokens: 12345 });
    expect(evt.data?.session_total_tokens).toBe(12345);
  });
});

describe('buildNewRequestEvent — JSON 직렬화', () => {
  test('페이로드 전체가 JSON.stringify 가능 (SSE wire format 호환)', () => {
    const evt = buildNewRequestEvent(
      fakeNormalized({ sub_type: 'mcp' }),
      { session_total_tokens: 1000, event_phase: 'updated' },
    );
    expect(() => JSON.stringify(evt)).not.toThrow();
    const json = JSON.stringify(evt);
    const round = JSON.parse(json);
    expect(round.type).toBe('new_request');
    expect(round.data.event_phase).toBe('updated');
    expect(round.data.sub_type).toBe('mcp');
  });
});
