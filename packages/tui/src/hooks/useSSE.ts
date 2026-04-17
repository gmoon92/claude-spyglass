import { useEffect, useState, useCallback, useRef } from 'react';
import { EventSource } from 'eventsource';

export interface SSEMessage {
  type: 'new_request' | 'session_update' | 'token_update' | 'stats_update' | 'ping';
  timestamp: number;
  data?: Record<string, unknown>;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface UseSSEOptions {
  url?: string;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  timeout?: number;
  /** 메시지 버퍼 최대 크기 (FIFO, 기본: 50) */
  maxBuffer?: number;
}

export interface UseSSEReturn {
  lastMessage: SSEMessage | null;
  /** 누적 메시지 버퍼 (최근 maxBuffer건, FIFO) */
  messages: SSEMessage[];
  status: ConnectionStatus;
  connect: () => void;
  disconnect: () => void;
  error: string | null;
}

export function useSSE(options: UseSSEOptions = {}): UseSSEReturn {
  const {
    url = 'http://localhost:9999/events',
    autoReconnect = true,
    reconnectInterval = 5000,
    timeout = 10000,
    maxBuffer = 50,
  } = options;

  const [lastMessage, setLastMessage] = useState<SSEMessage | null>(null);
  const [messages, setMessages] = useState<SSEMessage[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addMessage = useCallback((msg: SSEMessage) => {
    setMessages(prev => {
      const key = `${msg.timestamp}:${msg.type}`;
      const isDuplicate = prev.some(m => `${m.timestamp}:${m.type}` === key);
      if (isDuplicate) return prev;
      const next = [...prev, msg];
      return next.length > maxBuffer ? next.slice(next.length - maxBuffer) : next;
    });
  }, [maxBuffer]);

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
    if (eventSourceRef.current?.readyState === EventSource.OPEN) return;

    disconnect();
    setStatus('connecting');
    setError(null);

    try {
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        setStatus('connected');
        setError(null);
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as SSEMessage;
          setLastMessage(data);
          addMessage(data);
        } catch {
          // ignore parse errors
        }
      };

      es.onerror = () => {
        setStatus('error');
        setError('Connection error');
        es.close();
        if (autoReconnect) {
          reconnectTimeoutRef.current = setTimeout(() => connect(), reconnectInterval);
        }
      };

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
  }, [url, autoReconnect, reconnectInterval, timeout, disconnect, addMessage]);

  useEffect(() => {
    connect();
    return disconnect;
  }, [connect, disconnect]);

  return { lastMessage, messages, status, connect, disconnect, error };
}
