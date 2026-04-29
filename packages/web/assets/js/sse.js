// sse.js — SSE 연결 관리 (콜백 주입 방식)
// 공개 API: connectSSE({ onNewRequest, onOpen, onError })

let _source     = null;
let _retryTimer = null;
let _callbacks  = null;

function _retry() {
  _retryTimer = setTimeout(() => connectSSE(_callbacks), 5000);
}

/**
 * SSE 연결을 시작한다.
 * @param {{ onNewRequest: (e: MessageEvent) => void, onOpen: () => void, onError: () => void }} callbacks
 */
export function connectSSE(callbacks) {
  _callbacks = callbacks;
  const { onNewRequest, onOpen, onError } = callbacks;

  if (_source) { _source.close(); _source = null; }
  clearTimeout(_retryTimer);

  try {
    _source = new EventSource('/events');

    _source.addEventListener('new_request', onNewRequest);

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
