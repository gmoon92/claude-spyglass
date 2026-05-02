/**
 * SSE (Server-Sent Events) Streaming
 *
 * @description 실시간 데이터 변경 브로드캐스트 — hook(requests)과 proxy(proxy_requests) 두 채널을
 *              브라우저로 push. 채널별 이벤트 타입: 'new_request' / 'new_proxy_request'.
 */

// =============================================================================
// 타입 정의
// =============================================================================

/**
 * SSE 이벤트 타입
 *
 * - 'new_request'       : 훅(hooks) 데이터 (requests 테이블 신규 행)
 * - 'new_proxy_request' : 프록시 데이터 (proxy_requests 테이블 신규 행)
 *                         별도 채널 — payload 시그니처가 다르고 source='proxy' 마커 포함
 *                         @see docs/plans/proxy-sse-integration/adr.md ADR-001
 */
export type SSEEventType =
  | 'new_request'
  | 'new_proxy_request'
  | 'session_update'
  | 'token_update'
  | 'stats_update'
  | 'ping';

/**
 * SSE 이벤트 데이터
 */
export interface SSEEvent {
  type: SSEEventType;
  timestamp: number;
  data?: Record<string, unknown>;
}

// =============================================================================
// 연결 관리
// =============================================================================

/** 활성 SSE 연결 저장 */
const connections = new Set<ReadableStreamDefaultController<Uint8Array>>();

/**
 * SSE 연결 추가
 */
function addConnection(controller: ReadableStreamDefaultController<Uint8Array>): void {
  connections.add(controller);
  console.log(`[SSE] Client connected. Total: ${connections.size}`);

  // 초기 연결 메시지 전송
  sendEvent(controller, {
    type: 'ping',
    timestamp: Date.now(),
    data: { message: 'Connected to spyglass' },
  });
}

/**
 * SSE 연결 제거
 */
function removeConnection(controller: ReadableStreamDefaultController<Uint8Array>): void {
  connections.delete(controller);
  console.log(`[SSE] Client disconnected. Total: ${connections.size}`);
}

// =============================================================================
// 이벤트 전송
// =============================================================================

const encoder = new TextEncoder();

/**
 * 단일 연결에 이벤트 전송
 */
function sendEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: SSEEvent
): void {
  try {
    const data = JSON.stringify(event);
    const chunk = encoder.encode(`event: ${event.type}\ndata: ${data}\n\n`);
    controller.enqueue(chunk);
  } catch (error) {
    console.error('[SSE] Failed to send event:', error);
  }
}

/**
 * 모든 연결에 이벤트 브로드캐스트
 */
export function broadcastUpdate(event: Omit<SSEEvent, 'timestamp'>): void {
  const fullEvent: SSEEvent = {
    ...event,
    timestamp: Date.now(),
  };

  let failedCount = 0;
  connections.forEach((controller) => {
    try {
      sendEvent(controller, fullEvent);
    } catch {
      // 실패한 연결 제거
      removeConnection(controller);
      failedCount++;
    }
  });

  if (failedCount > 0) {
    console.log(`[SSE] Removed ${failedCount} failed connections`);
  }
}

/**
 * 새 요청 알림 브로드캐스트
 */
export function broadcastNewRequest(requestData: {
  id: string;
  session_id: string;
  type: string;
  request_type: string;
  tool_name?: string | null;
  tool_detail?: string | null;
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  duration_ms: number;
  model?: string | null;
  timestamp: number;
  payload?: string | null;
  session_total_tokens: number;
}): void {
  broadcastUpdate({
    type: 'new_request',
    data: requestData,
  });
}

/**
 * 프록시 신규 요청 브로드캐스트 — proxy.ts 전용
 *
 * 훅 데이터(`broadcastNewRequest`)와 별도 채널로 흘려보낸다.
 * payload에 `source: 'proxy'` 마커를 명시해 클라이언트가 출처를 구분할 수 있게 한다.
 *
 * @see docs/plans/proxy-sse-integration/adr.md ADR-001
 *
 * v22 (system-prompt-exposure ADR-005): system_hash·system_byte_size 두 필드 추가.
 *  - system 본문(content, 최대 28KB)은 절대 동봉하지 않음 — N 클라이언트 부하 방지.
 *  - 본문 lazy-fetch는 GET /api/system-prompts/:hash (T-08).
 */
export interface ProxyBroadcastPayload {
  id: string;
  timestamp: number;
  method: string;
  path: string;
  status_code: number | null;
  response_time_ms: number | null;
  model: string | null;
  tokens_input: number;
  tokens_output: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  tokens_per_second: number | null;
  is_stream: boolean;
  messages_count: number;
  max_tokens: number | null;
  tools_count: number;
  request_preview: string | null;
  stop_reason: string | null;
  response_preview: string | null;
  error_type: string | null;
  error_message: string | null;
  first_token_ms: number | null;
  api_request_id: string | null;
  /** v22: system_prompts 참조. 본문은 미동봉, lazy-fetch는 GET /api/system-prompts/:hash. */
  system_hash?: string | null;
  /** v22: UI 'X KB' 라벨용 hot data. */
  system_byte_size?: number | null;
}

export function broadcastNewProxyRequest(p: ProxyBroadcastPayload): void {
  broadcastUpdate({
    type: 'new_proxy_request',
    data: { source: 'proxy', ...p },
  });
}

/**
 * 세션 업데이트 브로드캐스트.
 *
 * 발생 케이스:
 *  - 'token_update': hook이 새 요청을 저장해 total_tokens 증가했을 때
 *  - 'started'     : 새 세션 첫 hook 도달 또는 SessionStart 훅
 *  - 'ended'       : SessionEnd 훅 도달 (ended_at 채워짐)
 *
 * 웹 측은 'session_update' 이벤트 listener에서 캐시 갱신 + 사이드바 재렌더.
 */
export function broadcastSessionUpdate(sessionData: {
  session_id: string;
  total_tokens?: number;
  request_count?: number;
  action?: 'started' | 'ended' | 'token_update';
  started_at?: number;
  ended_at?: number | null;
  project_name?: string;
}): void {
  broadcastUpdate({
    type: 'session_update',
    data: sessionData,
  });
}

// =============================================================================
// 핸들러
// =============================================================================

/**
 * SSE 엔드포인트 핸들러
 */
export function sseRouter(_req: Request): Response {
  let activeController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let pingInterval: ReturnType<typeof setInterval> | null = null;

  const cleanup = () => {
    if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
    if (activeController) { removeConnection(activeController); activeController = null; }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      activeController = controller;
      addConnection(controller);

      // 주기적 핑 (8초) — Bun idleTimeout 전에 연결 유지
      pingInterval = setInterval(() => {
        try {
          sendEvent(controller, {
            type: 'ping',
            timestamp: Date.now(),
            data: { connections: connections.size },
          });
        } catch {
          cleanup();
        }
      }, 8000);

      // 스트림 종료 감지
      const originalClose = controller.close.bind(controller);
      controller.close = () => {
        cleanup();
        return originalClose();
      };
    },

    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// =============================================================================
// 유틸리티
// =============================================================================

/**
 * 현재 연결 수 조회
 */
export function getConnectionCount(): number {
  return connections.size;
}

/**
 * 모든 연결 종료
 */
export function closeAllConnections(): void {
  connections.forEach((controller) => {
    try {
      controller.close();
    } catch {
      // 이미 닫힌 연결 무시
    }
  });
  connections.clear();
  console.log('[SSE] All connections closed');
}
