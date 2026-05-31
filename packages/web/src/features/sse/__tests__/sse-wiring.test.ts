import { describe, it, expect, beforeEach } from 'vitest';
import { createSSEStoreCallbacks } from '../sse-wiring';
import { useSSEStore, initialSSEState, FEED_CAP } from '../../../stores/sse-store';
import type { NewRequestEvent, NewProxyRequestEvent, SessionUpdateEvent } from '../../../schema/sse-schema';

// sse-wiring.test.ts — useSSE(P4-04) SSECallbacks ↔ sse-store(P4-05) 액션 결선 검증(P4-05).
//
// 글루는 콜백 호출을 store 액션으로 전달만 한다(매핑 정확성·페이로드 보존). store 전이 로직 자체는
// sse-store.test.ts 가 커버하므로, 여기선 "콜백→올바른 액션→스토어 상태 변화" 의 결선만 검증한다.

beforeEach(() => {
  useSSEStore.setState({ ...initialSSEState });
});

function makeReq(over: Partial<NewRequestEvent> = {}): NewRequestEvent {
  return {
    id: 'r1', session_id: 's1', timestamp: 1, type: 'prompt',
    tokens_input: 0, tokens_output: 0, tokens_total: 0, duration_ms: 0,
    sub_type: null, trust_level: 'trusted', model: null, model_fallback_applied: false,
    session_total_tokens: 42, event_phase: 'created', ...over,
  } as NewRequestEvent;
}

function makeProxy(over: Partial<NewProxyRequestEvent> = {}): NewProxyRequestEvent {
  return {
    source: 'proxy', id: 'p1', timestamp: 1, method: 'POST', path: '/m',
    status_code: 200, response_time_ms: 1, model: null, tokens_input: 0, tokens_output: 0,
    cache_creation_tokens: 0, cache_read_tokens: 0, tokens_per_second: null, is_stream: false,
    messages_count: 0, max_tokens: null, tools_count: 0, request_preview: null, stop_reason: null,
    response_preview: null, error_type: null, error_message: null, first_token_ms: null, api_request_id: null,
    ...over,
  } as NewProxyRequestEvent;
}

describe('createSSEStoreCallbacks — 채널 노출', () => {
  it('3 데이터 채널 콜백을 제공하고 onOpen/onError 는 글루 책임이 아니다', () => {
    const cb = createSSEStoreCallbacks();
    expect(typeof cb.onNewRequest).toBe('function');
    expect(typeof cb.onNewProxyRequest).toBe('function');
    expect(typeof cb.onSessionUpdate).toBe('function');
    expect(cb.onOpen).toBeUndefined();
    expect(cb.onError).toBeUndefined();
  });
});

describe('onNewRequest → applyNewRequest 결선', () => {
  it('콜백 호출이 feed prepend + 캐시미스 신호로 이어진다', () => {
    createSSEStoreCallbacks().onNewRequest(makeReq({ id: 'rX', session_id: 'unknown' }));
    const s = useSSEStore.getState();
    expect(s.feed[0]?.id).toBe('rX');
    expect(s.needsSessionsRefetch).toBe(true);
  });

  it('캐시 세션 존재 시 total_tokens 패치까지 결선', () => {
    useSSEStore.setState({ sessions: [{ id: 's1', total_tokens: 0 } as never] });
    createSSEStoreCallbacks().onNewRequest(makeReq({ session_id: 's1', session_total_tokens: 999 }));
    const sess = useSSEStore.getState().sessions.find((x) => (x as { id: string }).id === 's1');
    expect((sess as { total_tokens: number }).total_tokens).toBe(999);
  });

  it('cap 정책이 결선 경로에서도 동일 적용', () => {
    const cb = createSSEStoreCallbacks();
    for (let i = 0; i < FEED_CAP + 2; i++) cb.onNewRequest(makeReq({ id: `r${i}` }));
    expect(useSSEStore.getState().feed.length).toBe(FEED_CAP);
  });
});

describe('onNewProxyRequest → applyNewProxyRequest 결선', () => {
  it('콜백 호출이 proxyFeed prepend 로 이어진다', () => {
    createSSEStoreCallbacks().onNewProxyRequest?.(makeProxy({ id: 'pX' }));
    expect(useSSEStore.getState().proxyFeed[0]?.id).toBe('pX');
  });
});

describe('onSessionUpdate → applySessionUpdate 결선', () => {
  it("ended 패치가 결선 경로로 반영", () => {
    useSSEStore.setState({ sessions: [{ id: 's1', ended_at: null } as never] });
    createSSEStoreCallbacks().onSessionUpdate?.({ session_id: 's1', action: 'ended', ended_at: 555 } as SessionUpdateEvent);
    const sess = useSSEStore.getState().sessions.find((x) => (x as { id: string }).id === 's1');
    expect((sess as { ended_at: number | null }).ended_at).toBe(555);
  });

  it('미존재 세션 update 는 refetch 신호로 결선', () => {
    createSSEStoreCallbacks().onSessionUpdate?.({ session_id: 'ghost', action: 'started' } as SessionUpdateEvent);
    expect(useSSEStore.getState().needsSessionsRefetch).toBe(true);
  });
});
