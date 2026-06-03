/**
 * use-proxy-requests.test.tsx — 특성화 테스트 (소스 변경 없음, 현재 동작 고정).
 *
 * useProxyRequests 는 /api/proxy-requests 를 폴링하고, SSE
 * `new_proxy_request` 수신 시 즉시 refetch 한다. EventSource 는 node
 * `eventsource` 패키지를 mock.module 로 FakeEventSource 로 대체한다.
 *
 * 커버:
 *   - rows 중 stop_reason='end_turn' 최초 항목 선택 (find 의미)
 *   - end_turn 없으면 null
 *   - SSE new_proxy_request → 즉시 refetch (호출 횟수 증가)
 *   - inflight 중복 방지: 동시 다중 SSE 발사 시 fetch 1회로 합쳐짐
 *   - SSE error 발생해도 throw 없이 동작 지속 (폴링 fallback 유지)
 */

import { describe, it, expect, afterEach, mock } from 'bun:test';
import { FakeEventSource, esInstances, resetEsInstances } from './helpers/eventsource-mock';
import { FetchMock, flushAsync } from './helpers/fetch-mock';
import { makeProxyRow } from './helpers/fixtures';

// node `eventsource` 패키지를 Fake 로 교체 (파일 전역 1회).
mock.module('eventsource', () => ({ EventSource: FakeEventSource }));

// mock.module 이 적용된 뒤 import 되도록 동적 import.
const { useProxyRequests } = await import('../hooks/useProxyRequests');
const { renderHook } = await import('./helpers/render-hook');

let fm: FetchMock;
afterEach(() => {
  fm?.restore();
  resetEsInstances();
});

const API = 'http://test';
const HUGE = 9_999_999; // 폴링 비활성화

describe('useProxyRequests — end_turn 선택', () => {
  it('stop_reason=end_turn 최초 항목을 고른다', async () => {
    fm = new FetchMock().route('/api/proxy-requests', {
      json: { data: [makeProxyRow({ id: 'a', stop_reason: 'tool_use' }), makeProxyRow({ id: 'b', stop_reason: 'end_turn' }), makeProxyRow({ id: 'c', stop_reason: 'end_turn' })] },
    });
    const h = renderHook(() => useProxyRequests(API, HUGE));
    await flushAsync();
    expect(h.current.latestEndTurn?.id).toBe('b');
    expect(h.current.isLoading).toBe(false);
    h.unmount();
  });

  it('end_turn 없으면 null', async () => {
    fm = new FetchMock().route('/api/proxy-requests', {
      json: { data: [makeProxyRow({ id: 'a', stop_reason: 'tool_use' })] },
    });
    const h = renderHook(() => useProxyRequests(API, HUGE));
    await flushAsync();
    expect(h.current.latestEndTurn).toBeNull();
    h.unmount();
  });
});

describe('useProxyRequests — SSE 트리거', () => {
  it('new_proxy_request 수신 시 refetch 한다', async () => {
    fm = new FetchMock().route('/api/proxy-requests', { json: { data: [makeProxyRow()] } });
    const h = renderHook(() => useProxyRequests(API, HUGE));
    await flushAsync();
    const before = fm.callCount('/api/proxy-requests');
    expect(before).toBe(1);

    esInstances[0]!.emit('new_proxy_request');
    await flushAsync();
    expect(fm.callCount('/api/proxy-requests')).toBe(before + 1);
    h.unmount();
  });

  it('SSE error 가 와도 throw 없이 동작 지속', async () => {
    fm = new FetchMock().route('/api/proxy-requests', { json: { data: [makeProxyRow()] } });
    const h = renderHook(() => useProxyRequests(API, HUGE));
    await flushAsync();
    // error 핸들러는 silent — 예외 없이 통과해야 함
    expect(() => esInstances[0]!.emit('error')).not.toThrow();
    await flushAsync();
    expect(h.current.error).toBeNull();
    h.unmount();
  });
});

describe('useProxyRequests — inflight 중복 방지', () => {
  it('동시 다중 SSE 발사 시 fetch 가 1회로 합쳐진다', async () => {
    // fetch 를 의도적으로 지연시켜 inflight 윈도우를 넓힌다.
    let resolveJson: (() => void) | null = null;
    const gate = new Promise<void>((r) => { resolveJson = r; });
    let calls = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls++;
      await gate; // 첫 호출이 이 안에 머무는 동안 inflight=true 유지
      return { ok: true, status: 200, json: async () => ({ data: [makeProxyRow()] }) };
    }) as unknown as typeof globalThis.fetch;

    try {
      const h = renderHook(() => useProxyRequests(API, HUGE));
      // 초기 fetch 가 inflight 로 머무는 동안 SSE 를 여러 번 발사
      await flushAsync(2);
      const es = esInstances[0]!;
      es.emit('new_proxy_request');
      es.emit('new_proxy_request');
      es.emit('new_proxy_request');
      await flushAsync(2);
      // inflight 가드로 추가 fetch 가 막힌다 — 아직 1회
      expect(calls).toBe(1);

      // 게이트 해제 → 첫 fetch 완료
      resolveJson!();
      await flushAsync();
      h.unmount();
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
