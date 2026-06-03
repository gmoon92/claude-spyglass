/**
 * eventsource-mock.ts — 특성화 테스트 전용 EventSource 수작업 mock.
 *
 * 소스 변경 없음. useSSE / useProxyRequests 는 node `eventsource` 패키지의
 * named export `EventSource` 를 직접 import 한다. 새 의존성(msw 등) 없이
 * bun:test 의 `mock.module('eventsource', ...)` 로 이 Fake 를 주입한다.
 *
 * mock.module 은 전역이므로, 사용 테스트 파일에서 파일 상단 1회 등록 +
 * afterEach 에서 instances 초기화하여 누수를 막는다.
 *
 * 사용 패턴:
 *   import { FakeEventSource, esInstances, resetEsInstances } from './helpers/eventsource-mock';
 *   mock.module('eventsource', () => ({ EventSource: FakeEventSource }));
 *   afterEach(() => resetEsInstances());
 *   ...
 *   esInstances[0].emit('new_proxy_request', { data: '{"...":1}' });
 */

/** 생성된 모든 FakeEventSource 인스턴스 (생성 순서대로). */
export const esInstances: FakeEventSource[] = [];

/** 테스트 간 인스턴스 누적 방지 — afterEach 에서 호출. */
export function resetEsInstances(): void {
  esInstances.length = 0;
}

/**
 * node `eventsource` 패키지 EventSource 의 최소 호환 Fake.
 *
 * 실제 구현이 사용하는 표면만 재현한다:
 *   - constructor(url)
 *   - addEventListener(type, cb)
 *   - onopen 프로퍼티 할당
 *   - readyState (0 CONNECTING, 1 OPEN, 2 CLOSED)
 *   - close()
 *
 * emit() 으로 테스트가 임의 이벤트(open/error/ping/new_request/...)를 발사한다.
 */
export class FakeEventSource {
  public url: string;
  public readyState = 0;
  public onopen: (() => void) | null = null;
  public closed = false;
  private listeners: Record<string, Array<(ev: unknown) => void>> = {};

  constructor(url: string) {
    this.url = url;
    esInstances.push(this);
  }

  addEventListener(type: string, cb: (ev: unknown) => void): void {
    (this.listeners[type] ??= []).push(cb);
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }

  /** 임의 이벤트 발사. open 이벤트는 readyState 도 OPEN 으로 만든다. */
  emit(type: string, ev?: unknown): void {
    if (type === 'open') {
      this.readyState = 1;
      this.onopen?.();
    }
    for (const cb of (this.listeners[type] ?? []).slice()) cb(ev);
  }

  /** MessageEvent 형태로 data 페이로드를 실어 발사하는 편의 메서드. */
  emitData(type: string, data: unknown): void {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    this.emit(type, { data: payload });
  }
}
