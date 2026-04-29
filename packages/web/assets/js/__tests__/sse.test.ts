import { describe, it, expect, beforeEach, mock, jest, afterEach } from 'bun:test';
import { connectSSE } from '../sse.js';

// ── MockEventSource ──────────────────────────────────────────────────────────
type Listener = (e: { data: string }) => void;

class MockEventSource {
  static _last: MockEventSource | null = null;

  listeners: Record<string, Listener[]> = {};
  onopen:  (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(public url: string) {
    MockEventSource._last = this;
  }

  addEventListener(type: string, fn: Listener) {
    (this.listeners[type] ??= []).push(fn);
  }

  close() { this.closed = true; }

  // 테스트 헬퍼
  fireOpen()  { this.onopen?.(); }
  fireError() { this.onerror?.(); }
  fireMessage(type: string, payload: unknown) {
    const e = { data: JSON.stringify(payload) };
    this.listeners[type]?.forEach(fn => fn(e));
  }
}

// 전역에 MockEventSource 주입
(globalThis as any).EventSource = MockEventSource;

// ── 테스트 ───────────────────────────────────────────────────────────────────
describe('connectSSE', () => {
  let src: MockEventSource;
  let onNewRequest: ReturnType<typeof mock>;
  let onOpen: ReturnType<typeof mock>;
  let onError: ReturnType<typeof mock>;

  beforeEach(() => {
    jest.useFakeTimers();
    MockEventSource._last = null;
    onNewRequest = mock(() => {});
    onOpen       = mock(() => {});
    onError      = mock(() => {});
    connectSSE({ onNewRequest, onOpen, onError });
    src = MockEventSource._last!;
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('EventSource를 /events URL로 생성', () => {
    expect(src).toBeTruthy();
    expect(src.url).toBe('/events');
  });

  it('onopen 발화 → onOpen 콜백 1회 호출', () => {
    src.fireOpen();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('new_request 이벤트 → onNewRequest 콜백 호출 (원본 MessageEvent 전달)', () => {
    const payload = { type: 'new_request', data: { id: 'r1', session_id: 's1' } };
    src.fireMessage('new_request', payload);
    expect(onNewRequest).toHaveBeenCalledTimes(1);
    const receivedEvent = (onNewRequest.mock.calls[0] as any)[0];
    expect(receivedEvent.data).toBe(JSON.stringify(payload));
  });

  it('onerror 발화 → onError 호출 + source 닫힘', () => {
    src.fireError();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(src.closed).toBe(true);
  });

  it('onerror 후 5초 경과 → 재연결(새 EventSource 생성)', () => {
    src.fireError();
    const prevSrc = src;
    jest.advanceTimersByTime(5000);
    const newSrc = MockEventSource._last!;
    expect(newSrc).not.toBe(prevSrc);
    expect(newSrc.url).toBe('/events');
  });

  it('재연결 후 onOpen 재호출', () => {
    src.fireError();
    jest.advanceTimersByTime(5000);
    const newSrc = MockEventSource._last!;
    newSrc.fireOpen();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('connectSSE 재호출 시 기존 source 닫힘', () => {
    const newOpen = mock(() => {});
    connectSSE({ onNewRequest, onOpen: newOpen, onError });
    expect(src.closed).toBe(true);
    expect(MockEventSource._last).not.toBe(src);
  });

  it('재연결 중 connectSSE 재호출 → 이전 타이머 취소', () => {
    src.fireError();
    // 재연결 타이머가 아직 안 됐을 때 새로 connectSSE 호출
    connectSSE({ onNewRequest, onOpen, onError });
    const secondSrc = MockEventSource._last!;
    // 타이머를 5s 진행해도 세 번째 인스턴스가 생기지 않아야 함
    jest.advanceTimersByTime(5000);
    expect(MockEventSource._last).toBe(secondSrc);
  });
});
