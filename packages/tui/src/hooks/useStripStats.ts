/**
 * useStripStats — poll /api/stats/strip every 5 seconds.
 */

import { useEffect, useState } from 'react';
import type { StripStats, Session } from '../types';

export type UseStripStatsResult = {
  strip: StripStats | null;
  activeSessions: Session[];
  isLoading: boolean;
  error: string | null;
};

export function useStripStats(apiUrl: string, intervalMs = 5000): UseStripStatsResult {
  const [strip, setStrip] = useState<StripStats | null>(null);
  const [activeSessions, setActiveSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const [stripRes, activeRes] = await Promise.all([
          fetch(`${apiUrl}/api/stats/strip`),
          fetch(`${apiUrl}/api/sessions/active`),
        ]);
        if (cancelled) return;
        const stripJson = (await stripRes.json()) as { success: boolean; data: StripStats };
        const activeJson = (await activeRes.json()) as { success: boolean; data: Session[] };
        if (cancelled) return;
        setStrip(stripJson.data ?? null);
        setActiveSessions(activeJson.data ?? []);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    fetchOnce();
    const id = setInterval(fetchOnce, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [apiUrl, intervalMs]);

  return { strip, activeSessions, isLoading, error };
}
