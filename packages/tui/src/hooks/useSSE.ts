/**
 * SSE Client Hook
 *
 * @description Server-Sent Events 연결 및 실시간 데이터 수신
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { EventSource } from 'eventsource';

/**
 * SSE 이벤트 데이터
 */
export interface SSEMessage {
  type: 'new_request' | 'session_update' | 'token_update' | 'stats_update' | 'ping';
  timestamp: number;
  data?: Record<string, unknown>;
}

/**
 * 연결 상태
 */
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

/**
 * SSE 옵션
 */
export interface UseSSEOptions {
  /** 서버 URL */
  url?: string;
  /** 자동 재연결 */
  autoReconnect?: boolean;
  /** 재연결 간격 (ms) */
  reconnectInterval?: number;
  /** 연결 타임아웃 (ms) */
  timeout?: number;
}

/**
 * SSE 훅 반환값
 */
export interface UseSSEReturn {
  /** 최신 메시지 */
  lastMessage: SSEMessage | null;
  /** 연결 상태 */
  status: ConnectionStatus;
  /** 연결 시작 */
  connect: () => void;
  /** 연결 종료 */
  disconnect: () => void;
  /** 에러 메시지 */
  error: string | null;
}

/**
 * SSE 클라이언트 훅
 */
export function useSSE(options: UseSSEOptions = {}): UseSSEReturn {
  const {
    url = 'http://localhost:9999/events',
    autoReconnect = true,
    reconnectInterval = 5000,
    timeout = 10000,
  } = options;

  const [lastMessage, setLastMessage] = useState<SSEMessage | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setStatus('disconnected');
  }, []);

  const connect = useCallback(() => {
    // 이미 연결된 경우
    if (eventSourceRef.current?.readyState === EventSource.OPEN) {
      return;
    }

    disconnect();
    setStatus('connecting');
    setError(null);

    try {
      const es = new EventSource(url);
      eventSourceRef.current = es;

      // 연결 성공
      es.onopen = () => {
        setStatus('connected');
        setError(null);
      };

      // 메시지 수신
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as SSEMessage;
          setLastMessage(data);
        } catch (err) {
          console.error('[SSE] Failed to parse message:', err);
        }
      };

      // 에러 처리
      es.onerror = () => {
        setStatus('error');
        setError('Connection error');
        es.close();

        // 자동 재연결
        if (autoReconnect) {
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, reconnectInterval);
        }
      };

      // 타임아웃 처리
      setTimeout(() => {
        if (es.readyState !== EventSource.OPEN) {
          setError('Connection timeout');
          es.close();
        }
      }, timeout);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [url, autoReconnect, reconnectInterval, timeout, disconnect]);

  // 자동 연결
  useEffect(() => {
    connect();
    return disconnect;
  }, [connect, disconnect]);

  return {
    lastMessage,
    status,
    connect,
    disconnect,
    error,
  };
}
