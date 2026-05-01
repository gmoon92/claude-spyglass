/**
 * useProxyRequests — poll /api/proxy-requests for the latest assistant response,
 * with SSE-driven instant refresh on `new_proxy_request` events.
 *
 * Returns the most recent proxy request where stop_reason = 'end_turn'.
 *
 * Behavior:
 *  - Polling interval defaults to 30 seconds (fallback for SSE drops).
 *  - Subscribes to /events `new_proxy_request` SSE channel; on each event
 *    triggers an immediate refetch (dedup-coalesced via debounce flag).
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/docs/plans/proxy-sse-integration/adr.md ADR-002
 */

import { useEffect, useState } from 'react';
import { EventSource as NodeEventSource } from 'eventsource';

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
    let inflight = false;

    const fetchOnce = async () => {
      // 동시 요청 1건으로 제한 — SSE 폭주 시에도 fetch 중복 호출 방지
      if (inflight) return;
      inflight = true;
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
        inflight = false;
        if (!cancelled) setIsLoading(false);
      }
    };

    // 1) 초기 fetch
    void fetchOnce();

    // 2) 30초 폴링 fallback (SSE 끊김 대응)
    const id = setInterval(() => void fetchOnce(), intervalMs);

    // 3) SSE 트리거 — `new_proxy_request` 수신 즉시 refetch
    //    Bun에는 globalThis.EventSource가 없어 node `eventsource` 패키지 사용
    let es: EventSource | null = null;
    try {
      es = new NodeEventSource(`${apiUrl}/events`) as unknown as EventSource;
      es.addEventListener('new_proxy_request', () => {
        if (cancelled) return;
        void fetchOnce();
      });
      // 에러는 silent — fallback polling이 작동
      es.addEventListener('error', () => {
        // 무시: 30초 폴링이 자동 복구
      });
    } catch {
      // EventSource 생성 실패 시에도 폴링은 계속 동작
    }

    return () => {
      cancelled = true;
      clearInterval(id);
      if (es) {
        try { es.close(); } catch { /* noop */ }
      }
    };
  }, [apiUrl, intervalMs]);

  return { latestEndTurn, isLoading, error };
}
