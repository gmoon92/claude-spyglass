/**
 * sse-schema.test.ts — SSE/API Zod 스키마 런타임 검증 (P1-07, TDD)
 *
 * @description
 *   SSE 3 이벤트(new_request·new_proxy_request·session_update) + 주요 API 응답 envelope를
 *   Zod로 안전 파싱한다. 검증 관점:
 *     1) 유효 페이로드 → 통과 + @spyglass/types 형태로 정규화
 *     2) 무효 페이로드 → 거부 (safeParse.success=false), any 누출 없음
 *     3) JSON 문자열/MessageEvent 래퍼 → 안전 폴백 (throw 금지, 폴백 객체 반환)
 *
 *   본 task(P1-07)는 스키마 "설계·생성"만 검증한다. sse.js/api.js 결선은 P3.
 *   SSoT: 서버 송출 shape = packages/server/src/sse.ts (buildNewRequestEvent / ProxyBroadcastPayload /
 *   broadcastSessionUpdate). 도메인 형태 = packages/types/src/{request,session}.ts.
 *
 * @see packages/web/src/schema/sse-schema.ts
 * @see packages/web/src/schema/api-schema.ts
 */

import { describe, it, expect } from 'vitest';
import {
  NewRequestEventSchema,
  NewProxyRequestEventSchema,
  SessionUpdateEventSchema,
  parseSSEData,
  parseSSEMessage,
} from '../sse-schema';
import {
  ApiListEnvelopeSchema,
  DashboardEnvelopeSchema,
  parseApiEnvelope,
} from '../api-schema';

// ── 유효 픽스처 (서버 송출 shape 1:1) ────────────────────────────────────────

/** buildNewRequestEvent 가 data에 싣는 NormalizedRequest + 메타 (최소 필수 필드). */
function validNewRequestData() {
  return {
    // RequestRow 필수
    id: 'req-1',
    session_id: 'sess-1',
    timestamp: 1_700_000_000_000,
    type: 'prompt' as const,
    tokens_input: 10,
    tokens_output: 0,
    tokens_total: 10,
    duration_ms: 5,
    // NormalizedRequest 파생
    sub_type: null,
    trust_level: 'trusted' as const,
    model: 'claude-x',
    model_fallback_applied: false,
    // SSE 메타
    session_total_tokens: 42,
    event_phase: 'created' as const,
  };
}

/** broadcastNewProxyRequest 가 data에 싣는 ProxyBroadcastPayload + source 마커. */
function validProxyData() {
  return {
    source: 'proxy' as const,
    id: 'proxy-1',
    timestamp: 1_700_000_000_000,
    method: 'POST',
    path: '/v1/messages',
    status_code: 200,
    response_time_ms: 1200,
    model: 'claude-x',
    tokens_input: 100,
    tokens_output: 50,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    tokens_per_second: 41.6,
    is_stream: true,
    messages_count: 3,
    max_tokens: 4096,
    tools_count: 2,
    request_preview: 'hi',
    stop_reason: 'end_turn',
    response_preview: 'hello',
    error_type: null,
    error_message: null,
    first_token_ms: 300,
    api_request_id: 'api-1',
  };
}

/** broadcastSessionUpdate 가 data에 싣는 세션 부분 갱신 payload. */
function validSessionUpdateData() {
  return {
    session_id: 'sess-1',
    total_tokens: 42,
    request_count: 3,
    action: 'token_update' as const,
    started_at: 1_700_000_000_000,
    ended_at: null,
    project_name: 'spyglass',
  };
}

// =============================================================================
// new_request
// =============================================================================
describe('NewRequestEventSchema', () => {
  it('유효 페이로드를 통과시키고 NormalizedRequest 형태로 정규화한다', () => {
    const r = NewRequestEventSchema.safeParse(validNewRequestData());
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.id).toBe('req-1');
      expect(r.data.type).toBe('prompt');
      expect(r.data.event_phase).toBe('created');
      expect(r.data.session_total_tokens).toBe(42);
    }
  });

  it('event_phase 미지정 시 "created"로 기본값을 채운다 (서버 default 1:1)', () => {
    const data = validNewRequestData();
    delete (data as { event_phase?: unknown }).event_phase;
    const r = NewRequestEventSchema.safeParse(data);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.event_phase).toBe('created');
  });

  it('알 수 없는 추가 필드는 passthrough로 보존한다 (서버 필드 증가 후방호환)', () => {
    const data = { ...validNewRequestData(), brand_new_field: 'x' };
    const r = NewRequestEventSchema.safeParse(data);
    expect(r.success).toBe(true);
    if (r.success) {
      expect((r.data as Record<string, unknown>).brand_new_field).toBe('x');
    }
  });

  it('type 열거형 위반을 거부한다', () => {
    const r = NewRequestEventSchema.safeParse({ ...validNewRequestData(), type: 'bogus' });
    expect(r.success).toBe(false);
  });

  it('필수 id 누락을 거부한다', () => {
    const data = validNewRequestData();
    delete (data as { id?: unknown }).id;
    const r = NewRequestEventSchema.safeParse(data);
    expect(r.success).toBe(false);
  });

  it('tokens_input 타입 오류(문자열)를 거부한다', () => {
    const r = NewRequestEventSchema.safeParse({ ...validNewRequestData(), tokens_input: 'NaN' });
    expect(r.success).toBe(false);
  });
});

// =============================================================================
// new_proxy_request
// =============================================================================
describe('NewProxyRequestEventSchema', () => {
  it('유효 proxy 페이로드를 통과시킨다 (source 마커 포함)', () => {
    const r = NewProxyRequestEventSchema.safeParse(validProxyData());
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.source).toBe('proxy');
      expect(r.data.status_code).toBe(200);
    }
  });

  it('nullable 필드(status_code/model/...)에 null을 허용한다', () => {
    const r = NewProxyRequestEventSchema.safeParse({
      ...validProxyData(),
      status_code: null,
      model: null,
      response_time_ms: null,
    });
    expect(r.success).toBe(true);
  });

  it('선택 v22 필드(system_hash/system_byte_size)를 허용한다', () => {
    const r = NewProxyRequestEventSchema.safeParse({
      ...validProxyData(),
      system_hash: 'abc',
      system_byte_size: 1234,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.system_hash).toBe('abc');
  });

  it('필수 id 누락을 거부한다', () => {
    const data = validProxyData();
    delete (data as { id?: unknown }).id;
    expect(NewProxyRequestEventSchema.safeParse(data).success).toBe(false);
  });

  it('is_stream 타입 오류(문자열)를 거부한다', () => {
    const r = NewProxyRequestEventSchema.safeParse({ ...validProxyData(), is_stream: 'yes' });
    expect(r.success).toBe(false);
  });
});

// =============================================================================
// session_update
// =============================================================================
describe('SessionUpdateEventSchema', () => {
  it('유효 세션 갱신 페이로드를 통과시킨다', () => {
    const r = SessionUpdateEventSchema.safeParse(validSessionUpdateData());
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.session_id).toBe('sess-1');
      expect(r.data.action).toBe('token_update');
    }
  });

  it('session_id만 있는 최소 페이로드를 통과시킨다 (나머지는 모두 optional)', () => {
    const r = SessionUpdateEventSchema.safeParse({ session_id: 'sess-1' });
    expect(r.success).toBe(true);
  });

  it('action 열거형 위반을 거부한다', () => {
    const r = SessionUpdateEventSchema.safeParse({ session_id: 'sess-1', action: 'paused' });
    expect(r.success).toBe(false);
  });

  it('필수 session_id 누락을 거부한다', () => {
    const r = SessionUpdateEventSchema.safeParse({ total_tokens: 1 });
    expect(r.success).toBe(false);
  });
});

// =============================================================================
// parseSSEData — 이벤트 타입별 안전 파싱 + 폴백
// =============================================================================
describe('parseSSEData', () => {
  it('new_request 유효 데이터를 ok 결과로 반환한다', () => {
    const res = parseSSEData('new_request', validNewRequestData());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.id).toBe('req-1');
  });

  it('무효 데이터는 ok=false + error를 반환하고 throw하지 않는다', () => {
    const res = parseSSEData('new_request', { id: 123 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(typeof res.error).toBe('string');
  });

  it('알 수 없는 이벤트 타입은 ok=false 폴백', () => {
    // 무효 타입 — 문자열 오버로드로 해석되어 런타임 폴백 경로를 탄다.
    const res = parseSSEData('unknown_event', {});
    expect(res.ok).toBe(false);
  });

  it('session_update 유효 데이터를 ok 결과로 반환한다', () => {
    const res = parseSSEData('session_update', validSessionUpdateData());
    expect(res.ok).toBe(true);
  });

  it('new_proxy_request 유효 데이터를 ok 결과로 반환한다', () => {
    const res = parseSSEData('new_proxy_request', validProxyData());
    expect(res.ok).toBe(true);
  });
});

// =============================================================================
// parseSSEMessage — MessageEvent(.data: JSON string) 래퍼 파싱
// =============================================================================
describe('parseSSEMessage', () => {
  it('유효 JSON 문자열 + 일치하는 type을 파싱한다', () => {
    const wire = JSON.stringify({
      type: 'new_request',
      timestamp: Date.now(),
      data: validNewRequestData(),
    });
    const res = parseSSEMessage('new_request', wire);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.id).toBe('req-1');
  });

  it('깨진 JSON 문자열은 throw하지 않고 ok=false 폴백', () => {
    const res = parseSSEMessage('new_request', '{not json');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(typeof res.error).toBe('string');
  });

  it('envelope.data가 없으면 ok=false 폴백', () => {
    const wire = JSON.stringify({ type: 'new_request', timestamp: 1 });
    const res = parseSSEMessage('new_request', wire);
    expect(res.ok).toBe(false);
  });

  it('비문자열(이미 객체) data도 수용한다 (방어적)', () => {
    const obj = { type: 'session_update', timestamp: 1, data: validSessionUpdateData() };
    const res = parseSSEMessage('session_update', obj);
    expect(res.ok).toBe(true);
  });
});

// =============================================================================
// API envelope
// =============================================================================
describe('ApiListEnvelopeSchema / parseApiEnvelope', () => {
  it('{data: [...]} 배열 envelope를 통과시킨다', () => {
    const schema = ApiListEnvelopeSchema(NewRequestEventSchema);
    const r = schema.safeParse({ data: [validNewRequestData()] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.data.length).toBe(1);
  });

  it('data 누락 시 거부한다', () => {
    const schema = ApiListEnvelopeSchema(NewRequestEventSchema);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('parseApiEnvelope: 무효 항목 포함 시 ok=false 폴백 (throw 금지)', () => {
    const schema = ApiListEnvelopeSchema(NewRequestEventSchema);
    const res = parseApiEnvelope(schema, { data: [{ id: 1 }] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(typeof res.error).toBe('string');
  });

  it('parseApiEnvelope: 빈 fallback(undefined)도 안전 처리', () => {
    const schema = ApiListEnvelopeSchema(NewRequestEventSchema);
    const res = parseApiEnvelope(schema, undefined);
    expect(res.ok).toBe(false);
  });
});

describe('DashboardEnvelopeSchema', () => {
  it('summary 핵심 필드를 가진 dashboard 응답을 통과시킨다', () => {
    const payload = {
      data: {
        summary: {
          totalSessions: 1,
          totalRequests: 2,
          totalTokens: 3,
          activeSessions: 0,
          avgDurationMs: null,
          p95DurationMs: null,
          errorRate: null,
        },
        requests: { avg_duration_ms: 12 },
        projects: [{ project_name: 'p' }],
        types: [{ count: 1 }],
        active: [],
      },
    };
    const r = DashboardEnvelopeSchema.safeParse(payload);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.data.summary.totalRequests).toBe(2);
  });

  it('summary 누락을 거부한다', () => {
    const r = DashboardEnvelopeSchema.safeParse({ data: { projects: [] } });
    expect(r.success).toBe(false);
  });
});
