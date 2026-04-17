/**
 * SSE (Server-Sent Events) Streaming
 *
 * @description 실시간 데이터 변경 브로드캐스트
 * @see docs/planning/02-prd.md - 실시간 토큰 카운터
 */

// =============================================================================
// 타입 정의
// =============================================================================

/**
 * SSE 이벤트 타입
 */
export type SSEEventType =
  | 'new_request'
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
 * 세션 업데이트 브로드캐스트
 */
export function broadcastSessionUpdate(sessionData: {
  session_id: string;
  total_tokens: number;
  request_count?: number;
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

      // 주기적 핑 (30초)
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
      }, 30000);

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
