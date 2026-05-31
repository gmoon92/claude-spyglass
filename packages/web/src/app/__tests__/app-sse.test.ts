/**
 * app-sse.test.ts — 최상위 SSE 콜백 합성 계약 (P4-06)
 *
 * App 이 useSSE 에 주입하는 SSECallbacks 를 만드는 순수 팩토리(buildAppSSECallbacks)를 검증한다.
 *   - 데이터 3채널(onNewRequest/onNewProxyRequest/onSessionUpdate) → sse-store 액션 결선
 *     (features/sse-wiring createSSEStoreCallbacks 재사용 — 재구현 금지).
 *   - 연결 생명주기(onOpen/onError) → 호출처 주입 콜백 합성(sse-wiring 헤더 §onOpen/onError 계약).
 *
 * SSR(renderToStaticMarkup)에서 useSSE 의 useEffect 는 미발화하므로 EventSource 가 생성되지 않는다.
 * 따라서 SSE 결선 계약은 effect 가 아니라 "콜백 객체의 결선"을 직접 invoke 하여 검증한다.
 *
 * 순수 — EventSource/DOM 무의존(콜백을 직접 호출).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { buildAppSSECallbacks } from '../app-sse';
import { useSSEStore, initialSSEState } from '../../stores/sse-store';
import type { NewRequestEvent } from '../../schema/sse-schema';

beforeEach(() => {
  useSSEStore.setState({ ...initialSSEState, feed: [], proxyFeed: [], sessions: [] });
});

describe('buildAppSSECallbacks — 데이터 채널 결선(sse-store)', () => {
  it('onNewRequest 는 sse-store.applyNewRequest 로 결선되어 feed 에 prepend 된다', () => {
    const cb = buildAppSSECallbacks({});
    const req = { id: 'r1', session_id: 's1', session_total_tokens: 10 } as unknown as NewRequestEvent;
    cb.onNewRequest(req);
    const feed = useSSEStore.getState().feed;
    expect(feed.length).toBe(1);
    expect(feed[0].id).toBe('r1');
  });

  it('onNewProxyRequest 는 proxyFeed 로 결선된다', () => {
    const cb = buildAppSSECallbacks({});
    cb.onNewProxyRequest?.({ id: 'p1' } as never);
    expect(useSSEStore.getState().proxyFeed.length).toBe(1);
  });

  it('onSessionUpdate(캐시미스) 는 needsSessionsRefetch 신호를 올린다', () => {
    const cb = buildAppSSECallbacks({});
    cb.onSessionUpdate?.({ session_id: 'missing', action: 'started' } as never);
    expect(useSSEStore.getState().needsSessionsRefetch).toBe(true);
  });
});

describe('buildAppSSECallbacks — 생명주기 합성(onOpen/onError)', () => {
  it('주입한 onOpen/onError 를 그대로 노출한다', () => {
    let opened = 0;
    let errored = 0;
    const cb = buildAppSSECallbacks({
      onOpen: () => { opened += 1; },
      onError: () => { errored += 1; },
    });
    cb.onOpen?.();
    cb.onError?.();
    expect(opened).toBe(1);
    expect(errored).toBe(1);
  });

  it('onOpen/onError 미주입 시에도 onNewRequest 는 필수로 존재한다(SSECallbacks 계약)', () => {
    const cb = buildAppSSECallbacks({});
    expect(typeof cb.onNewRequest).toBe('function');
    // 선택 채널/생명주기는 undefined 일 수 있다(useSSE 가 안전 호출).
    expect(cb.onOpen === undefined || typeof cb.onOpen === 'function').toBe(true);
  });
});
