/**
 * use-sse.test.tsx — 특성화 테스트 (소스 변경 없음, 현재 동작 고정).
 *
 * useSSE 는 node `eventsource` 패키지의 EventSource 를 직접 생성하고,
 * 수신 이벤트를 feedStore 로 push 하며 connection 상태를 노출한다.
 * EventSource 를 FakeEventSource 로 교체하고, renderHook 으로 훅을 마운트해
 * 상태 전이를 발사(emit)로 구동한다.
 *
 * 커버:
 *   - 초기 status='connecting', 버킷 배열 길이 180
 *   - 'open' emit → status='open', flashOk=true
 *   - 'ping' emit → markOpen (status='open')
 *   - 'error' emit → status='reconnecting', es.close() 호출
 *   - 'new_request' emit → feedStore push + lastEventAt 설정 + 버킷 누적
 *   - 깨진 JSON 'new_request' → throw 없이 무시 (push 안 됨)
 *
 * eventsPerSec 같은 1초 interval 기반 값은 실시간 타이머 의존이라
 * 결정적 검증에서 제외 (실제 sleep 금지 원칙). 상태/이벤트 표면만 고정한다.
 */

import { describe, it, expect, afterEach, mock } from 'bun:test';
import { FakeEventSource, esInstances, resetEsInstances } from './helpers/eventsource-mock';
import { flushAsync } from './helpers/fetch-mock';

// eventsource 패키지를 Fake 로 교체 (파일 전역 1회).
mock.module('eventsource', () => ({ EventSource: FakeEventSource }));

const { useSSE } = await import('../hooks/useSSE');
const { renderHook } = await import('./helpers/render-hook');
const { feedStore } = await import('../stores/feed-store');

afterEach(() => {
  resetEsInstances();
  feedStore.reset([]);
});

const API = 'http://test';

describe('useSSE — 초기 상태', () => {
  it("초기 status='connecting' 이고 버킷 배열 길이는 180", async () => {
    const h = renderHook(() => useSSE(API));
    await flushAsync();
    expect(h.current.status).toBe('connecting');
    expect(h.current.pulseBuckets.length).toBe(180);
    expect(h.current.requestBuckets.length).toBe(180);
    expect(h.current.lastEventAt).toBeNull();
    h.unmount();
  });

  it('EventSource 가 /events URL 로 1개 생성된다', async () => {
    const h = renderHook(() => useSSE(API));
    await flushAsync();
    expect(esInstances.length).toBe(1);
    expect(esInstances[0]!.url).toBe(`${API}/events`);
    h.unmount();
  });
});

describe('useSSE — 상태 전이', () => {
  it("'open' emit → status='open', flashOk=true", async () => {
    const h = renderHook(() => useSSE(API));
    await flushAsync();
    esInstances[0]!.emit('open');
    await flushAsync();
    expect(h.current.status).toBe('open');
    expect(h.current.flashOk).toBe(true);
    h.unmount();
  });

  it("'ping' emit → markOpen (status='open')", async () => {
    const h = renderHook(() => useSSE(API));
    await flushAsync();
    esInstances[0]!.emit('ping');
    await flushAsync();
    expect(h.current.status).toBe('open');
    h.unmount();
  });

  it("'error' emit → status='reconnecting' 이고 es.close() 호출됨", async () => {
    const h = renderHook(() => useSSE(API));
    await flushAsync();
    const es = esInstances[0]!;
    es.emit('error');
    await flushAsync();
    expect(h.current.status).toBe('reconnecting');
    expect(es.closed).toBe(true);
    h.unmount();
  });
});

describe('useSSE — 이벤트 수신', () => {
  it("'new_request' 수신 시 feedStore 에 push 되고 lastEventAt 이 설정된다", async () => {
    feedStore.reset([]);
    const h = renderHook(() => useSSE(API));
    await flushAsync();
    esInstances[0]!.emitData('new_request', {
      id: 'sse-1',
      session_id: 's1',
      tool_name: 'Read',
      tool_detail: 'x.ts',
      event_type: 'tool',
      tokens_total: 42,
      timestamp: Date.now(),
    });
    await flushAsync();
    const snap = feedStore.getSnapshot();
    expect(snap.length).toBe(1);
    expect(snap[0]!.id).toBe('sse-1');
    expect(snap[0]!.tool_name).toBe('Read');
    expect(h.current.lastEventAt).not.toBeNull();
    // 수신 후 status 는 open (markOpen 호출됨).
    expect(h.current.status).toBe('open');
    h.unmount();
  });

  it("data.data 래퍼(중첩) 형태도 언랩해서 push 한다", async () => {
    feedStore.reset([]);
    const h = renderHook(() => useSSE(API));
    await flushAsync();
    esInstances[0]!.emitData('new_request', {
      data: { id: 'sse-wrapped', session_id: 's1', tool_name: 'Edit', event_type: 'tool' },
    });
    await flushAsync();
    const snap = feedStore.getSnapshot();
    expect(snap.length).toBe(1);
    expect(snap[0]!.id).toBe('sse-wrapped');
    expect(snap[0]!.tool_name).toBe('Edit');
    h.unmount();
  });

  it('깨진 JSON 은 throw 없이 무시되어 push 되지 않는다', async () => {
    feedStore.reset([]);
    const h = renderHook(() => useSSE(API));
    await flushAsync();
    expect(() => esInstances[0]!.emit('new_request', { data: '{not valid json' })).not.toThrow();
    await flushAsync();
    expect(feedStore.getSnapshot().length).toBe(0);
    h.unmount();
  });
});
