import { useState, useEffect, useCallback } from 'react';

export interface Session {
  id: string;
  project_name: string;
  started_at: number;
  ended_at: number | null;
  total_tokens: number;
}

export interface UseSessionListOptions {
  apiUrl?: string;
  interval?: number;
}

export interface UseSessionListReturn {
  sessions: Session[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useSessionList(options: UseSessionListOptions = {}): UseSessionListReturn {
  const {
    apiUrl = 'http://localhost:9999/api/sessions',
    interval = 5000,
  } = options;

  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}?limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      if (result.success) {
        setSessions(result.data as Session[]);
      } else {
        throw new Error(result.error || 'Unknown error');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch sessions');
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    fetchSessions();
    const timer = setInterval(fetchSessions, interval);
    return () => clearInterval(timer);
  }, [fetchSessions, interval]);

  return { sessions, loading, error, refresh: fetchSessions };
}
