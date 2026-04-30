/**
 * useStripStats — poll /api/stats/strip + /api/sessions/active + /api/stats/tools.
 */

import { useEffect, useState } from 'react';
import type { StripStats, Session, ToolStat } from '../types';

export type UseStripStatsResult = {
  strip: StripStats | null;
  activeSessions: Session[];
  toolStats: ToolStat[];
  isLoading: boolean;
  error: string | null;
};

type ApiResp<T> = { success?: boolean; data?: T };

export function useStripStats(apiUrl: string, intervalMs = 5000): UseStripStatsResult {
  const [strip, setStrip] = useState<StripStats | null>(null);
  const [activeSessions, setActiveSessions] = useState<Session[]>([]);
  const [toolStats, setToolStats] = useState<ToolStat[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchOnce = async () => {
      try {
        const [stripRes, activeRes, toolsRes] = await Promise.all([
          fetch(`${apiUrl}/api/stats/strip`),
          fetch(`${apiUrl}/api/sessions/active`),
          fetch(`${apiUrl}/api/stats/tools`),
        ]);
        if (cancelled) return;
        const stripJson = (await stripRes.json()) as ApiResp<StripStats>;
        const activeJson = (await activeRes.json()) as ApiResp<Session[]>;
        const toolsJson = (await toolsRes.json()) as ApiResp<Record<string, unknown>[]>;
        if (cancelled) return;

        // Server returns total_tokens / total_requests at top level for some endpoints,
        // but /api/stats/strip may only include p95_duration_ms + error_rate.
        // Synthesize active_sessions from /api/sessions/active for consistency.
        const sessions = activeJson.data ?? [];
        const synthesizedStrip: StripStats = {
          ...(stripJson.data ?? {}),
          active_sessions: sessions.length,
          total_sessions: sessions.length,
          total_requests: sessions.reduce((a, s) => a + (s.request_count ?? 0), 0),
          total_tokens: sessions.reduce((a, s) => a + (s.total_tokens ?? 0), 0),
        };

        // Map server schema (call_count/error_count) to our ToolStat (calls).
        const tools: ToolStat[] = (toolsJson.data ?? []).map((t: Record<string, unknown>) => ({
          tool_name: String(t.tool_name ?? ''),
          calls: Number((t.call_count ?? t.calls ?? 0)),
          avg_tokens: Number(t.avg_tokens ?? 0),
          p95_duration_ms: Number(t.p95_duration_ms ?? t.max_duration_ms ?? 0),
          error_rate: Number(t.error_count ?? 0) / Math.max(1, Number(t.call_count ?? 1)),
        }));

        setStrip(synthesizedStrip);
        setActiveSessions(sessions);
        setToolStats(tools);
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

  return { strip, activeSessions, toolStats, isLoading, error };
}
