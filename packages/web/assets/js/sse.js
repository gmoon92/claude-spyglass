// sse.js — SSE 연결 관리 (콜백 주입 방식)
// 공개 API: connectSSE({ onNewRequest, onOpen, onError, onNewProxyRequest? })
//
// 채널 분리:
//  - 'new_request'       : 훅(hooks) 데이터 (requests 테이블)
//  - 'new_proxy_request' : 프록시 데이터 (proxy_requests 테이블)
// @see ${CLAUDE_PROJECT_DIR}/.claude/docs/plans/proxy-sse-integration/adr.md ADR-001

let _source     = null;
let _retryTimer = null;
let _callbacks  = null;

function _retry() {
  _retryTimer = setTimeout(() => connectSSE(_callbacks), 5000);
}

/**
 * SSE 연결을 시작한다.
 * @param {{
 *   onNewRequest:       (e: MessageEvent) => void,
 *   onOpen:             () => void,
 *   onError:            () => void,
 *   onNewProxyRequest?: (e: MessageEvent) => void,
 * }} callbacks
 */
export function connectSSE(callbacks) {
  _callbacks = callbacks;
  const { onNewRequest, onOpen, onError, onNewProxyRequest } = callbacks;

  if (_source) { _source.close(); _source = null; }
  clearTimeout(_retryTimer);

  try {
    _source = new EventSource('/events');

    _source.addEventListener('new_request', onNewRequest);

    // proxy 채널은 선택 옵션 — 미지정 시 등록하지 않음 (후방 호환)
    if (typeof onNewProxyRequest === 'function') {
      _source.addEventListener('new_proxy_request', onNewProxyRequest);
    }

    _source.onopen = () => {
      clearTimeout(_retryTimer);
      onOpen();
    };

    _source.onerror = () => {
      _source.close(); _source = null;
      onError();
      _retry();
    };
  } catch {
    _retry();
  }
}
