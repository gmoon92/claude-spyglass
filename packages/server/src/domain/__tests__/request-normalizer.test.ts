/**
 * request-normalizer 단위 테스트
 *
 * @description
 *   normalizeRequest / normalizeRequests의 모델 폴백, sub_type, trust_level 결정을 검증.
 *   모든 케이스는 ADR-001/002/005 기준.
 */

import { describe, expect, test } from 'bun:test';
import type { Request, TurnItem } from '@spyglass/storage';
import { normalizeRequest, normalizeRequests, normalizeTurns } from '../request-normalizer';

// =============================================================================
// fixture
// =============================================================================

function baseRequest(overrides: Partial<Request> = {}): Request {
  return {
    id: 'test-1',
    session_id: 'sess-1',
    timestamp: 1_000_000_000_000,
    type: 'tool_call',
    tokens_input: 0,
    tokens_output: 0,
    tokens_total: 0,
    duration_ms: 0,
    ...overrides,
  };
}

// =============================================================================
// model 폴백
// =============================================================================

describe('normalizeRequest — model 폴백', () => {
  test('raw.model이 있으면 그대로 사용, fallback 미적용', () => {
    const r = normalizeRequest(baseRequest({ model: 'claude-opus-4-7' }));
    expect(r.model).toBe('claude-opus-4-7');
    expect(r.model_fallback_applied).toBe(false);
  });

  test('raw.model NULL + turn 컨텍스트 → 폴백 적용', () => {
    const r = normalizeRequest(
      baseRequest({ model: undefined }),
      { turnPromptModel: 'claude-sonnet-4-6' },
    );
    expect(r.model).toBe('claude-sonnet-4-6');
    expect(r.model_fallback_applied).toBe(true);
  });

  test('raw.model NULL + turn 컨텍스트 없음 → null + fallback 미적용', () => {
    const r = normalizeRequest(baseRequest({ model: undefined }));
    expect(r.model).toBeNull();
    expect(r.model_fallback_applied).toBe(false);
  });

  test('raw.model 빈 문자열도 NULL과 동일 처리', () => {
    const r = normalizeRequest(
      baseRequest({ model: '' }),
      { turnPromptModel: 'claude-opus-4-7' },
    );
    expect(r.model).toBe('claude-opus-4-7');
    expect(r.model_fallback_applied).toBe(true);
  });
});

describe('normalizeRequests — turn 단위 일괄 폴백', () => {
  test('같은 turn_id의 prompt model이 tool_call/response의 폴백으로 적용됨', () => {
    const rows: Request[] = [
      baseRequest({ id: 'p-1', type: 'prompt', turn_id: 't-1', model: 'claude-opus-4-7' }),
      baseRequest({ id: 't-1-tool', type: 'tool_call', turn_id: 't-1', model: undefined }),
      baseRequest({ id: 't-1-resp', type: 'response', turn_id: 't-1', model: undefined }),
    ];
    const out = normalizeRequests(rows);
    expect(out[0].model).toBe('claude-opus-4-7');
    expect(out[0].model_fallback_applied).toBe(false); // prompt 자체엔 fallback 미적용
    expect(out[1].model).toBe('claude-opus-4-7');
    expect(out[1].model_fallback_applied).toBe(true);
    expect(out[2].model).toBe('claude-opus-4-7');
    expect(out[2].model_fallback_applied).toBe(true);
  });

  test('다른 turn의 prompt model은 폴백 후보가 되지 않음', () => {
    const rows: Request[] = [
      baseRequest({ id: 'p-1', type: 'prompt', turn_id: 't-1', model: 'claude-opus-4-7' }),
      baseRequest({ id: 't-2-tool', type: 'tool_call', turn_id: 't-2', model: undefined }),
    ];
    const out = normalizeRequests(rows);
    expect(out[1].model).toBeNull();
  });

  test('turn_id 없는 행은 폴백 대상 아님', () => {
    const rows: Request[] = [
      baseRequest({ id: 't-orphan', type: 'tool_call', turn_id: undefined, model: undefined }),
    ];
    const out = normalizeRequests(rows);
    expect(out[0].model).toBeNull();
  });
});

// =============================================================================
// sub_type
// =============================================================================

describe('normalizeRequest — sub_type 분류', () => {
  test.each([
    ['Agent', 'agent'],
    ['Skill', 'skill'],
    ['Task', 'task'],
    ['mcp__playwright__browser_click', 'mcp'],
    ['mcp__server__tool_x', 'mcp'],
    ['Bash', null],
    ['Read', null],
    [undefined, null],
  ] as const)('tool_name=%p → sub_type=%p', (toolName, expected) => {
    const r = normalizeRequest(baseRequest({ tool_name: toolName as string | undefined }));
    expect(r.sub_type).toBe(expected);
  });
});

// =============================================================================
// trust_level
// =============================================================================

describe('normalizeRequest — trust_level 분류', () => {
  test('정상 model + tokens_confidence=high → trusted', () => {
    const r = normalizeRequest(baseRequest({
      model: 'claude-opus-4-7',
      tokens_confidence: 'high',
      tokens_source: 'transcript',
    }));
    expect(r.trust_level).toBe('trusted');
  });

  test('model이 <synthetic>로 시작 → synthetic', () => {
    const r = normalizeRequest(baseRequest({ model: '<synthetic>' }));
    expect(r.trust_level).toBe('synthetic');
  });

  test('tokens_source=proxy → estimated', () => {
    const r = normalizeRequest(baseRequest({
      model: 'claude-opus-4-7',
      tokens_source: 'proxy',
    }));
    expect(r.trust_level).toBe('estimated');
  });

  test('tokens_source=unavailable → unknown', () => {
    const r = normalizeRequest(baseRequest({
      model: 'claude-opus-4-7',
      tokens_source: 'unavailable',
    }));
    expect(r.trust_level).toBe('unknown');
  });

  test('model 없고 폴백도 없음 → unknown', () => {
    const r = normalizeRequest(baseRequest({ model: undefined }));
    expect(r.trust_level).toBe('unknown');
  });

  test('tokens_confidence가 high가 아니면 unknown', () => {
    const r = normalizeRequest(baseRequest({
      model: 'claude-opus-4-7',
      tokens_confidence: 'error',
    }));
    expect(r.trust_level).toBe('unknown');
  });
});

// =============================================================================
// raw 보존
// =============================================================================

describe('normalizeRequest — raw 필드 보존', () => {
  test('cache_*, event_type, tokens_source, parent_tool_use_id 등 모두 그대로 보존', () => {
    const raw = baseRequest({
      cache_creation_tokens: 100,
      cache_read_tokens: 200,
      event_type: 'tool',
      tokens_source: 'transcript',
      parent_tool_use_id: 'parent-1',
      api_request_id: 'api-1',
    });
    const r = normalizeRequest(raw);
    expect(r.cache_creation_tokens).toBe(100);
    expect(r.cache_read_tokens).toBe(200);
    expect(r.event_type).toBe('tool');
    expect(r.tokens_source).toBe('transcript');
    expect(r.parent_tool_use_id).toBe('parent-1');
    expect(r.api_request_id).toBe('api-1');
  });
});

// =============================================================================
// normalizeTurns (ADR-006: 인터리빙 책임 서버 이관)
// =============================================================================

function makeTurnItem(overrides: Partial<TurnItem> = {}): TurnItem {
  return {
    turn_id: 't-1',
    turn_index: 1,
    started_at: 1_000_000_000_000,
    prompt: null,
    tool_calls: [],
    responses: [],
    system_hash: null,
    system_byte_size: null,
    summary: {
      tool_call_count: 0,
      tokens_input: 0,
      tokens_output: 0,
      total_tokens: 0,
      duration_ms: 0,
    },
    ...overrides,
  };
}

describe('normalizeTurns — items[] 인터리빙', () => {
  test('tool_calls와 responses를 timestamp 오름차순으로 머지', () => {
    const turn = makeTurnItem({
      tool_calls: [
        { id: 't-tool-1', type: 'tool_call', timestamp: 1000, tool_name: 'Bash',
          tool_detail: null, tokens_input: 0, tokens_output: 0, tokens_total: 0,
          duration_ms: 0, payload: null, event_type: 'tool', model: 'claude-opus-4-7',
          parent_tool_use_id: null, tokens_confidence: 'high' },
        { id: 't-tool-2', type: 'tool_call', timestamp: 3000, tool_name: 'Read',
          tool_detail: null, tokens_input: 0, tokens_output: 0, tokens_total: 0,
          duration_ms: 0, payload: null, event_type: 'tool', model: 'claude-opus-4-7',
          parent_tool_use_id: null, tokens_confidence: 'high' },
      ],
      responses: [
        { id: 't-resp-1', timestamp: 2000, preview: 'mid', payload: null,
          tokens_input: 0, tokens_output: 0, tokens_total: 0,
          model: 'claude-opus-4-7', tokens_confidence: 'high' },
      ],
    });
    const [out] = normalizeTurns([turn], 'sess-1');
    expect(out.items.length).toBe(3);
    expect(out.items[0].kind).toBe('tool');
    expect(out.items[0].request.id).toBe('t-tool-1');
    expect(out.items[1].kind).toBe('response');
    expect(out.items[1].request.id).toBe('t-resp-1');
    expect(out.items[2].kind).toBe('tool');
    expect(out.items[2].request.id).toBe('t-tool-2');
  });

  test('items에 prompt는 포함되지 않음 (헤더 책임 분리, ADR-005)', () => {
    const turn = makeTurnItem({
      prompt: {
        id: 'p-1', timestamp: 500, tokens_input: 100, tokens_output: 0, tokens_total: 100,
        duration_ms: 0, model: 'claude-opus-4-7', payload: null,
        cache_read_tokens: 0, cache_creation_tokens: 0, context_tokens: 100,
        tokens_confidence: 'high',
      },
      tool_calls: [
        { id: 't-1', type: 'tool_call', timestamp: 1000, tool_name: 'Bash',
          tool_detail: null, tokens_input: 0, tokens_output: 0, tokens_total: 0,
          duration_ms: 0, payload: null, event_type: 'tool', model: null,
          parent_tool_use_id: null, tokens_confidence: 'high' },
      ],
    });
    const [out] = normalizeTurns([turn], 'sess-1');
    expect(out.items.length).toBe(1);
    expect(out.items.every((i) => i.kind !== 'response' || i.request.type === 'response')).toBe(true);
    // items에는 tool/response만, prompt는 별도 turn.prompt에 그대로 보존
    expect(out.prompt?.id).toBe('p-1');
  });

  test('turn 안 tool_call의 model NULL이 같은 turn의 prompt model로 폴백됨', () => {
    const turn = makeTurnItem({
      prompt: {
        id: 'p-1', timestamp: 500, tokens_input: 0, tokens_output: 0, tokens_total: 0,
        duration_ms: 0, model: 'claude-opus-4-7', payload: null,
        cache_read_tokens: 0, cache_creation_tokens: 0, context_tokens: 0,
        tokens_confidence: 'high',
      },
      tool_calls: [
        { id: 't-1', type: 'tool_call', timestamp: 1000, tool_name: 'Bash',
          tool_detail: null, tokens_input: 0, tokens_output: 0, tokens_total: 0,
          duration_ms: 0, payload: null, event_type: 'tool', model: null,
          parent_tool_use_id: null, tokens_confidence: 'high' },
      ],
      responses: [
        { id: 'r-1', timestamp: 2000, preview: null, payload: null,
          tokens_input: 0, tokens_output: 0, tokens_total: 0,
          model: null, tokens_confidence: 'high' },
      ],
    });
    const [out] = normalizeTurns([turn], 'sess-1');
    const tool = out.items.find((i) => i.kind === 'tool');
    const resp = out.items.find((i) => i.kind === 'response');
    expect(tool?.request.model).toBe('claude-opus-4-7');
    expect(tool?.request.model_fallback_applied).toBe(true);
    expect(resp?.request.model).toBe('claude-opus-4-7');
    expect(resp?.request.model_fallback_applied).toBe(true);
  });

  test('prompt model 없으면 폴백 안 됨 — model: null 유지', () => {
    const turn = makeTurnItem({
      prompt: null,
      tool_calls: [
        { id: 't-1', type: 'tool_call', timestamp: 1000, tool_name: 'Bash',
          tool_detail: null, tokens_input: 0, tokens_output: 0, tokens_total: 0,
          duration_ms: 0, payload: null, event_type: 'tool', model: null,
          parent_tool_use_id: null, tokens_confidence: 'high' },
      ],
    });
    const [out] = normalizeTurns([turn], 'sess-1');
    expect(out.items[0].request.model).toBeNull();
    expect(out.items[0].request.model_fallback_applied).toBe(false);
  });

  test('동일 timestamp는 입력 순서 유지 (안정 정렬)', () => {
    const turn = makeTurnItem({
      tool_calls: [
        { id: 't-1', type: 'tool_call', timestamp: 1000, tool_name: 'A',
          tool_detail: null, tokens_input: 0, tokens_output: 0, tokens_total: 0,
          duration_ms: 0, payload: null, event_type: 'tool', model: null,
          parent_tool_use_id: null, tokens_confidence: 'high' },
      ],
      responses: [
        { id: 'r-same', timestamp: 1000, preview: null, payload: null,
          tokens_input: 0, tokens_output: 0, tokens_total: 0,
          model: null, tokens_confidence: 'high' },
      ],
    });
    const [out] = normalizeTurns([turn], 'sess-1');
    expect(out.items[0].request.id).toBe('t-1');
    expect(out.items[1].request.id).toBe('r-same');
  });

  test('빈 turn은 items=[] 반환', () => {
    const turn = makeTurnItem();
    const [out] = normalizeTurns([turn], 'sess-1');
    expect(out.items).toEqual([]);
  });

  test('turn_id가 NormalizedRequest에 주입됨 (turn 컨텍스트 유지)', () => {
    const turn = makeTurnItem({
      turn_id: 't-99',
      tool_calls: [
        { id: 't-1', type: 'tool_call', timestamp: 1000, tool_name: 'Bash',
          tool_detail: null, tokens_input: 0, tokens_output: 0, tokens_total: 0,
          duration_ms: 0, payload: null, event_type: 'tool', model: 'claude-opus-4-7',
          parent_tool_use_id: null, tokens_confidence: 'high' },
      ],
    });
    const [out] = normalizeTurns([turn], 'sess-1');
    expect(out.items[0].request.turn_id).toBe('t-99');
    expect(out.items[0].request.session_id).toBe('sess-1');
  });
});
