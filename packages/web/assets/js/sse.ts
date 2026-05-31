// @ts-check
// sse.js — SSE 연결 관리 (콜백 주입 방식)
// 공개 API: connectSSE({ onNewRequest, onOpen, onError, onNewProxyRequest?, onSessionUpdate? })
//
// 채널 분리:
//  - 'new_request'       : 훅(hooks) 데이터 (requests 테이블)
//  - 'new_proxy_request' : 프록시 데이터 (proxy_requests 테이블)
//  - 'session_update'    : 세션 활성/비활성 전환 (started/ended/token_update) — v22 추가
// @see ${CLAUDE_PROJECT_DIR}/.claude/docs/plans/proxy-sse-integration/adr.md ADR-001

interface SseCallbacks {
  onNewRequest:       (e: MessageEvent) => void;
  onOpen:             () => void;
  onError:            () => void;
  onNewProxyRequest?: (e: MessageEvent) => void;
  onSessionUpdate?:   (e: MessageEvent) => void;
}

let _source: EventSource | null     = null;
let _retryTimer: ReturnType<typeof setTimeout> | undefined = undefined;
let _callbacks: SseCallbacks | null  = null;

function _retry() {
  _retryTimer = setTimeout(() => { if (_callbacks) connectSSE(_callbacks); }, 5000);
}

/**
 * SSE 연결을 시작한다.
 * @param {{
 *   onNewRequest:       (e: MessageEvent) => void,
 *   onOpen:             () => void,
 *   onError:            () => void,
 *   onNewProxyRequest?: (e: MessageEvent) => void,
 *   onSessionUpdate?:   (e: MessageEvent) => void,
 * }} callbacks
 */
export function connectSSE(callbacks: SseCallbacks) {
  _callbacks = callbacks;
  const { onNewRequest, onOpen, onError, onNewProxyRequest, onSessionUpdate } = callbacks;

  if (_source) { _source.close(); _source = null; }
  clearTimeout(_retryTimer);

  try {
    _source = new EventSource('/events');

    _source.addEventListener('new_request', onNewRequest);

    // proxy 채널은 선택 옵션 — 미지정 시 등록하지 않음 (후방 호환)
    if (typeof onNewProxyRequest === 'function') {
      _source.addEventListener('new_proxy_request', onNewProxyRequest);
    }

    // v22: 세션 활성/비활성 전환 채널 — SessionStart/SessionEnd 시 사이드바 마커 즉시 갱신
    if (typeof onSessionUpdate === 'function') {
      _source.addEventListener('session_update', onSessionUpdate);
    }

    _source.onopen = () => {
      clearTimeout(_retryTimer);
      onOpen();
    };

    _source.onerror = () => {
      _source?.close(); _source = null;
      onError();
      _retry();
    };
  } catch {
    _retry();
  }
}
