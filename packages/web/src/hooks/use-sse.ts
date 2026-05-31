/**
 * hooks/use-sse.ts — SSE 연결 React 훅 (P4-04)
 *
 * 원본: assets/js/sse.js (connectSSE, 모듈 싱글톤 _source/_retryTimer/_callbacks, 5초 backoff).
 * 이식 형태(리포 선례 — system-reminder-popover / use-settings-diag §5.1 신계약):
 *  - imperative 결선 → `createSSEController` 주입형 클로저 컨트롤러. 원본 module-level 싱글톤을
 *    클로저 상태로 캡슐화 → 마운트별 독립(전역 공유 부작용 제거).
 *  - React 와이어링 → `useSSE` 훅: useEffect mount 시 컨트롤러 1회 생성, unmount 시 stop()
 *    (EventSource.close + clearTimeout) — 원본 sse.js 가 미보장하던 cleanup 계약(P4-04 신규).
 *
 * sse.js 대비 신규 계약:
 *  1. P1-07 Zod 검증 — 핸들러는 raw MessageEvent 가 아니라 parseSSEMessage 로 검증·정규화된
 *     typed data 를 받는다. 파싱 실패(JSON/스키마 위반/data 누락)는 throw 없이 드롭(핸들러 미호출).
 *  2. 언마운트 cleanup — stop() 이 활성 EventSource 를 닫고 대기 중 재연결 타이머를 정리한다.
 *
 * 채널(sse.js 동일):
 *  - 'new_request'       : 훅 데이터 (requests)
 *  - 'new_proxy_request' : 프록시 데이터 (proxy_requests)  — 핸들러 선택
 *  - 'session_update'    : 세션 활성/비활성 전환            — 핸들러 선택
 *
 * 기존 sse.js / sse.test.ts 는 무수정 병존(P4-04 회귀 0). 본 훅은 React 소비처의 신규 진입점.
 *
 * @see packages/web/assets/js/sse.js (connectSSE 원본)
 * @see packages/web/src/schema/sse-schema.ts (P1-07 parseSSEMessage, ParseResult)
 */
import { useEffect, useRef } from 'react';
import {
  parseSSEMessage,
  type NewRequestEvent,
  type NewProxyRequestEvent,
  type SessionUpdateEvent,
} from '../schema/sse-schema';

/** SSE 재연결 backoff(ms) — sse.js _retry 5000 1:1. */
const RETRY_DELAY_MS = 5000;

/** /events 엔드포인트 — sse.js EventSource('/events') 1:1. */
const SSE_URL = '/events';

/**
 * useSSE / createSSEController 콜백 계약.
 *  - onNewRequest 필수(주 채널). onOpen/onError 선택(미지정 시 no-op).
 *  - onNewProxyRequest/onSessionUpdate 선택 — sse.js 의 후방호환(선택 채널) 1:1.
 *  - 핸들러는 P1-07 검증·정규화된 typed data 를 받는다(raw MessageEvent 아님).
 */
export interface SSECallbacks {
  onNewRequest: (data: NewRequestEvent) => void;
  onNewProxyRequest?: (data: NewProxyRequestEvent) => void;
  onSessionUpdate?: (data: SessionUpdateEvent) => void;
  onOpen?: () => void;
  onError?: () => void;
}

/** createSSEController 반환 — 마운트별 생명주기 핸들. */
export interface SSEController {
  /** 활성 EventSource 를 닫고 대기 중 재연결 타이머를 정리한다(언마운트 cleanup). */
  stop: () => void;
}

/**
 * SSE 연결을 시작하고 생명주기를 캡슐화한다(주입형 클로저 — React 무의존, 테스트 가능).
 *
 * 상태(클로저 캡슐화 — 원본 sse.js 모듈 싱글톤 대체):
 *   source     : 현재 EventSource | null
 *   retryTimer : 재연결 setTimeout 핸들 | null
 *   stopped    : stop() 이후 재진입(재연결) 차단 가드
 *
 * 흐름(sse.js connectSSE 1:1 + Zod 검증 래핑):
 *   connect(): 기존 source close + 타이머 clear → 새 EventSource('/events') →
 *     3 채널 addEventListener(검증 래퍼) + onopen(타이머 clear + onOpen) +
 *     onerror(close + onError + 5초 retry). 생성 throw 시 retry 예약.
 *   retry():   stop 되지 않았으면 RETRY_DELAY_MS 후 connect() 재호출.
 *   stop():    stopped=true, 타이머 clear, source close.
 */
export function createSSEController(callbacks: SSECallbacks): SSEController {
  const { onNewRequest, onNewProxyRequest, onSessionUpdate, onOpen, onError } = callbacks;

  let source: EventSource | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  /** 재연결 예약 — sse.js _retry 1:1. stop 후에는 예약하지 않는다. */
  function retry() {
    if (stopped) return;
    retryTimer = setTimeout(connect, RETRY_DELAY_MS);
  }

  /**
   * 채널 검증 래퍼 — parseSSEMessage(P1-07)로 검증한 typed data 만 핸들러로 전달.
   * strictNullChecks off 환경이므로 `res.ok ? res.data : drop` 삼항 분기(sse-schema 주석 규약).
   * 검증 실패(ok=false)·data 부재는 throw 없이 드롭(핸들러 미호출).
   */
  function bind<T extends 'new_request' | 'new_proxy_request' | 'session_update'>(
    type: T,
    handler: ((data: unknown) => void) | undefined,
  ) {
    if (!source || typeof handler !== 'function') return;
    source.addEventListener(type, (e: MessageEvent) => {
      const res = parseSSEMessage(type, e.data);
      if (res.ok && res.data !== undefined && res.data !== null) {
        handler(res.data);
      }
      // res.ok=false → 안전 드롭(P1-07): 로깅 없이 무시(콘솔 소음 방지).
    });
  }

  function connect() {
    if (stopped) return;

    if (source) {
      source.close();
      source = null;
    }
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }

    try {
      source = new EventSource(SSE_URL);

      bind('new_request', onNewRequest as (d: unknown) => void);
      // 선택 채널 — 미지정 시 등록하지 않음(sse.js 후방호환 1:1).
      bind('new_proxy_request', onNewProxyRequest as ((d: unknown) => void) | undefined);
      bind('session_update', onSessionUpdate as ((d: unknown) => void) | undefined);

      source.onopen = () => {
        if (retryTimer !== null) {
          clearTimeout(retryTimer);
          retryTimer = null;
        }
        onOpen?.();
      };

      source.onerror = () => {
        if (source) {
          source.close();
          source = null;
        }
        onError?.();
        retry();
      };
    } catch {
      // 생성 자체 실패 → 재연결 예약(sse.js catch → _retry 1:1).
      retry();
    }
  }

  function stop() {
    stopped = true;
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (source) {
      source.close();
      source = null;
    }
  }

  connect();
  return { stop };
}

/**
 * SSE 연결 React 훅 — 마운트 시 1회 연결, 언마운트 시 cleanup(close + clearTimeout).
 *
 * 콜백 안정화: 매 렌더 콜백 객체 신원이 바뀌어도 재연결하지 않도록 ref 로 최신 콜백을 보관하고,
 * useEffect 는 빈 의존성([])으로 컨트롤러를 1회만 생성한다(이벤트 구독 idiom). 컨트롤러에는
 * ref 를 읽는 안정 래퍼를 주입 → 핸들러는 항상 최신 콜백을 호출한다(stale closure 회피).
 *
 * @param callbacks SSE 핸들러(onNewRequest 필수, 나머지 선택)
 */
export function useSSE(callbacks: SSECallbacks): void {
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks; // 매 렌더 최신화(ref 쓰기는 부작용 아님).

  useEffect(() => {
    const ctrl = createSSEController({
      onNewRequest: (d) => cbRef.current.onNewRequest?.(d),
      onNewProxyRequest: (d) => cbRef.current.onNewProxyRequest?.(d),
      onSessionUpdate: (d) => cbRef.current.onSessionUpdate?.(d),
      onOpen: () => cbRef.current.onOpen?.(),
      onError: () => cbRef.current.onError?.(),
    });
    return () => ctrl.stop();
    // 빈 의존성: 마운트 1회 연결 / 언마운트 1회 cleanup. 콜백은 cbRef 로 최신 유지.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
