/**
 * use-sse.test.ts — useSSE 훅 + createSSEController 단위/동치 테스트 (P4-04)
 *
 * 전략(tasks.json P4-04 test_strategy + 리포 선례):
 *   러너는 bun test + renderToStaticMarkup(SSR) 이라 useEffect 가 실행되지 않는다.
 *   따라서 use-settings-diag / system-reminder-popover 선례를 따라 imperative 결선을
 *   주입형 클로저 컨트롤러(createSSEController)로 추출하고, 동작은 컨트롤러를 직접 검증한다.
 *   훅(useSSE)의 useEffect 부착/cleanup 은 컨트롤러 stop() 위임 + 정적 결선으로 보증하며,
 *   추가로 호스트 컴포넌트 SSR 스모크(throw 없음)로 import/JSX 무결성을 가드한다.
 *
 * sse.js 대비 신규 계약(P4-04):
 *   1. P1-07 Zod 검증 — 핸들러는 raw MessageEvent 가 아니라 parseSSEMessage 로 검증된
 *      typed data 를 받는다. 파싱 실패(JSON/스키마 위반)는 throw 없이 드롭(핸들러 미호출).
 *   2. 언마운트 cleanup — stop() 이 EventSource.close + 재연결 타이머 clearTimeout 수행
 *      (원본 sse.js 모듈 싱글톤은 미보장). 클로저 캡슐화로 마운트별 독립.
 *
 * MockEventSource/globalThis.EventSource 주입 + jest.useFakeTimers 는 sse.test.ts 와 동일.
 *
 * @see packages/web/assets/js/__tests__/sse.test.ts (connectSSE 8 case 동치 기준)
 * @see packages/web/src/schema/sse-schema.ts (P1-07 parseSSEMessage)
 */
import { describe, it, expect, beforeEach, afterEach, mock, jest } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSSEController, useSSE } from '../use-sse';

// ── MockEventSource (sse.test.ts 1:1 재사용) ───────────────────────────────────
type Listener = (e: { data: string }) => void;

class MockEventSource {
  static _last: MockEventSource | null = null;
  static _count = 0;

  listeners: Record<string, Listener[]> = {};
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(public url: string) {
    MockEventSource._last = this;
    MockEventSource._count += 1;
  }

  addEventListener(type: string, fn: Listener) {
    (this.listeners[type] ??= []).push(fn);
  }

  close() {
    this.closed = true;
  }

  // 테스트 헬퍼
  fireOpen() {
    this.onopen?.();
  }
  fireError() {
    this.onerror?.();
  }
  /** 서버 wire envelope `{ type, data }` 를 stringify 해 dispatch (sse.test.ts 동일). */
  fireMessage(type: string, payload: unknown) {
    const e = { data: JSON.stringify(payload) };
    this.listeners[type]?.forEach((fn) => fn(e));
  }
  /** 검증 실패 케이스용 — 임의의 raw 문자열을 그대로 dispatch. */
  fireRaw(type: string, raw: string) {
    this.listeners[type]?.forEach((fn) => fn({ data: raw }));
  }
}

(globalThis as any).EventSource = MockEventSource;

// ── 유효 페이로드 픽스처 (sse-schema 스키마 충족) ───────────────────────────────
/** NewRequestEventSchema 충족 — envelope.data 로 싣는다. */
const VALID_NEW_REQUEST = {
  id: 'r1',
  session_id: 's1',
  timestamp: 1000,
  type: 'prompt',
  tokens_input: 10,
  tokens_output: 20,
  tokens_total: 30,
  duration_ms: 5,
  sub_type: null,
  trust_level: 'trusted',
  model: 'sonnet',
  model_fallback_applied: false,
  session_total_tokens: 30,
  // event_phase 누락 → 스키마 default('created') 채움
};

/** NewProxyRequestEventSchema 충족(source:'proxy' + 필수 필드). */
const VALID_PROXY_REQUEST = {
  source: 'proxy',
  id: 'p1',
  timestamp: 2000,
  method: 'POST',
  path: '/v1/messages',
  status_code: 200,
  response_time_ms: 120,
  model: 'sonnet',
  tokens_input: 5,
  tokens_output: 6,
  cache_creation_tokens: 0,
  cache_read_tokens: 0,
  tokens_per_second: null,
  is_stream: true,
  messages_count: 1,
  max_tokens: null,
  tools_count: 0,
  request_preview: null,
  stop_reason: null,
  response_preview: null,
  error_type: null,
  error_message: null,
  first_token_ms: null,
  api_request_id: null,
};

/** SessionUpdateEventSchema 충족(session_id 필수). */
const VALID_SESSION_UPDATE = {
  session_id: 's1',
  action: 'started',
  total_tokens: 30,
};

function envelope(type: string, data: unknown) {
  return { type, timestamp: Date.now(), data };
}

// ── createSSEController (동작 SSoT) ─────────────────────────────────────────────
describe('createSSEController — 결선/재연결/Zod 검증/cleanup', () => {
  let onNewRequest: ReturnType<typeof mock>;
  let onNewProxyRequest: ReturnType<typeof mock>;
  let onSessionUpdate: ReturnType<typeof mock>;
  let onOpen: ReturnType<typeof mock>;
  let onError: ReturnType<typeof mock>;
  let ctrl: { stop: () => void };

  beforeEach(() => {
    jest.useFakeTimers();
    MockEventSource._last = null;
    MockEventSource._count = 0;
    onNewRequest = mock(() => {});
    onNewProxyRequest = mock(() => {});
    onSessionUpdate = mock(() => {});
    onOpen = mock(() => {});
    onError = mock(() => {});
    ctrl = createSSEController({
      onNewRequest,
      onNewProxyRequest,
      onSessionUpdate,
      onOpen,
      onError,
    });
  });

  afterEach(() => {
    ctrl.stop();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  const src = () => MockEventSource._last!;

  // 1. /events 연결 (connectSSE 동치)
  it('EventSource 를 /events URL 로 생성', () => {
    expect(src()).toBeTruthy();
    expect(src().url).toBe('/events');
  });

  // 2. onopen → onOpen 1회 (connectSSE 동치)
  it('onopen 발화 → onOpen 콜백 1회 호출', () => {
    src().fireOpen();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  // 3. new_request 유효 → 검증된 data 로 핸들러 호출 (P1-07 신계약: raw 아님)
  it('new_request 유효 envelope → onNewRequest 가 검증된 data 로 호출', () => {
    src().fireMessage('new_request', envelope('new_request', VALID_NEW_REQUEST));
    expect(onNewRequest).toHaveBeenCalledTimes(1);
    const data = (onNewRequest.mock.calls[0] as any)[0];
    expect(data.id).toBe('r1');
    expect(data.session_id).toBe('s1');
    // 스키마 default 적용 확인 (event_phase 누락 → 'created')
    expect(data.event_phase).toBe('created');
  });

  // 4. new_proxy_request 유효 → 검증된 data 로 호출
  it('new_proxy_request 유효 envelope → onNewProxyRequest 가 검증된 data 로 호출', () => {
    src().fireMessage('new_proxy_request', envelope('new_proxy_request', VALID_PROXY_REQUEST));
    expect(onNewProxyRequest).toHaveBeenCalledTimes(1);
    const data = (onNewProxyRequest.mock.calls[0] as any)[0];
    expect(data.id).toBe('p1');
    expect(data.source).toBe('proxy');
  });

  // 5. session_update 유효 → 검증된 data 로 호출
  it('session_update 유효 envelope → onSessionUpdate 가 검증된 data 로 호출', () => {
    src().fireMessage('session_update', envelope('session_update', VALID_SESSION_UPDATE));
    expect(onSessionUpdate).toHaveBeenCalledTimes(1);
    const data = (onSessionUpdate.mock.calls[0] as any)[0];
    expect(data.session_id).toBe('s1');
    expect(data.action).toBe('started');
  });

  // 6a. 잘못된 JSON → 드롭(throw 없음, 핸들러 미호출) — P1-07 안전처리
  it('new_request 깨진 JSON → 핸들러 미호출(throw 없이 안전 드롭)', () => {
    expect(() => src().fireRaw('new_request', '{not json')).not.toThrow();
    expect(onNewRequest).not.toHaveBeenCalled();
  });

  // 6b. 스키마 위반(필드 누락) → 드롭 — P1-07 안전처리
  it('new_request 스키마 위반(필드 누락) → 핸들러 미호출(안전 드롭)', () => {
    const broken = envelope('new_request', { id: 'x' }); // 필수 필드 다수 누락
    expect(() => src().fireMessage('new_request', broken)).not.toThrow();
    expect(onNewRequest).not.toHaveBeenCalled();
  });

  // 6c. data 누락 envelope → 드롭
  it('data 필드 없는 envelope → 핸들러 미호출(안전 드롭)', () => {
    expect(() => src().fireMessage('session_update', { type: 'session_update' })).not.toThrow();
    expect(onSessionUpdate).not.toHaveBeenCalled();
  });

  // 7. onerror → onError + source 닫힘 (connectSSE 동치)
  it('onerror 발화 → onError 호출 + source 닫힘', () => {
    src().fireError();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(src().closed).toBe(true);
  });

  // 8. onerror 후 5초 → 재연결 (connectSSE 동치)
  it('onerror 후 5초 경과 → 재연결(새 EventSource 생성)', () => {
    const prev = src();
    src().fireError();
    jest.advanceTimersByTime(5000);
    expect(MockEventSource._last).not.toBe(prev);
    expect(MockEventSource._last!.url).toBe('/events');
  });

  // 9. 재연결 후 onOpen 재호출 (connectSSE 동치)
  it('재연결 후 onOpen 재호출', () => {
    src().fireError();
    jest.advanceTimersByTime(5000);
    src().fireOpen();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  // 10. stop() → close + 재연결 타이머 정리 (언마운트 cleanup 신계약)
  it('stop() → source 닫힘 + 대기 중 재연결 타이머 취소(언마운트 cleanup)', () => {
    src().fireError(); // 재연결 타이머 5s 예약
    const closedAfterError = src().closed;
    ctrl.stop();
    expect(closedAfterError).toBe(true);
    // stop 후 5s 진행해도 새 EventSource 가 생기지 않아야 함(타이머 clearTimeout).
    const countBefore = MockEventSource._count;
    jest.advanceTimersByTime(5000);
    expect(MockEventSource._count).toBe(countBefore);
  });

  // 11. stop() 가 활성 source 를 닫음(에러 전 상태에서도)
  it('stop() → 활성 EventSource 즉시 close', () => {
    expect(src().closed).toBe(false);
    ctrl.stop();
    expect(src().closed).toBe(true);
  });

  // 12. 선택 채널 미지정 시 onNewProxyRequest/onSessionUpdate 없이도 동작(후방호환)
  it('proxy/session 핸들러 미지정 → 해당 이벤트 도착해도 throw 없음', () => {
    ctrl.stop();
    MockEventSource._last = null;
    const minimal = createSSEController({ onNewRequest });
    expect(() =>
      MockEventSource._last!.fireMessage('new_proxy_request', envelope('new_proxy_request', VALID_PROXY_REQUEST)),
    ).not.toThrow();
    minimal.stop();
  });
});

// ── useSSE 훅 — SSR 스모크(결선 무결성) ─────────────────────────────────────────
describe('useSSE — 호스트 컴포넌트 SSR 스모크', () => {
  beforeEach(() => {
    MockEventSource._last = null;
    MockEventSource._count = 0;
  });

  it('useSSE 를 호출하는 컴포넌트 렌더가 throw 하지 않음(effect 미실행 환경)', () => {
    function Host() {
      useSSE({ onNewRequest: () => {} });
      return createElement('div', null, 'ok');
    }
    // SSR 은 useEffect 를 실행하지 않으므로 EventSource 생성은 일어나지 않는다.
    // 본 스모크는 import/JSX/Hook 호출 무결성만 가드한다(런타임 결선은 컨트롤러 테스트가 보증).
    expect(() => renderToStaticMarkup(createElement(Host))).not.toThrow();
    expect(MockEventSource._count).toBe(0);
  });

  it('useSSE 와 createSSEController 가 export 되어 있다', () => {
    expect(typeof useSSE).toBe('function');
    expect(typeof createSSEController).toBe('function');
  });
});
