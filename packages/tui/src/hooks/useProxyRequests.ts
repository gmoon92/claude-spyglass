/**
 * useProxyRequests — poll /api/proxy-requests for the latest assistant response.
 *
 * Returns the most recent proxy request where stop_reason = 'end_turn'.
 * Polling interval defaults to 30 seconds.
 */

import { useEffect, useState } from 'react';

export type ProxyRequestSummary = {
  id: string;
  model: string | null;
  stop_reason: string | null;
  response_preview: string | null;
  first_token_ms: number | null;
  tokens_per_second: number | null;
  timestamp: number;
  session_id: string | null;
};

type ApiResp<T> = { success?: boolean; data?: T };

export type UseProxyRequestsResult = {
  latestEndTurn: ProxyRequestSummary | null;
  isLoading: boolean;
  error: string | null;
};

export function useProxyRequests(
  apiUrl: string,
  intervalMs = 30_000,
): UseProxyRequestsResult {
  const [latestEndTurn, setLatestEndTurn] = useState<ProxyRequestSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchOnce = async () => {
      try {
        const res = await fetch(`${apiUrl}/api/proxy-requests?limit=20`);
        if (cancelled) return;
        const json = (await res.json()) as ApiResp<ProxyRequestSummary[]>;
        if (cancelled) return;

        const rows = json.data ?? [];
        const endTurn = rows.find((r) => r.stop_reason === 'end_turn') ?? null;
        setLatestEndTurn(endTurn);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void fetchOnce();
    const id = setInterval(() => void fetchOnce(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [apiUrl, intervalMs]);

  return { latestEndTurn, isLoading, error };
}
