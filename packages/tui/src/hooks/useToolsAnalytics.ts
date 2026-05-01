/**
 * useToolsAnalytics — fetches all analytics data needed for the 5-tab Tools dashboard.
 *
 * Polls every 5 s. Re-fetches immediately when apiUrl or timeRange changes.
 */

import { useEffect, useState } from 'react';
import type { TimeRange } from '../lib/time-range';
import type { ToolStat } from '../types';

export type ByTypeRow = {
  type: string;
  count: number;
  total_tokens: number;
  avg_tokens: number;
};

export type CacheStats = {
  hitRate: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  savingsRate: number;
};

export type ToolsAnalytics = {
  tools: ToolStat[];
  byType: ByTypeRow[];
  cache: CacheStats | null;
  isLoading: boolean;
  error: string | null;
};

type ApiResp<T> = { success?: boolean; data?: T };

/**
 * Raw server shape for /api/stats/tools entries.
 * Fields differ from ToolStat: call_count vs calls, error_count vs error_rate.
 */
type RawToolRow = {
  tool_name?: unknown;
  call_count?: unknown;
  calls?: unknown;
  total_tokens?: unknown;
  avg_tokens?: unknown;
  avg_duration_ms?: unknown;
  max_duration_ms?: unknown;
  p95_duration_ms?: unknown;
  error_count?: unknown;
};

type RawByTypeRow = {
  type?: unknown;
  count?: unknown;
  total_tokens?: unknown;
  avg_tokens?: unknown;
};

type RawCacheData = {
  hitRate?: unknown;
  cacheReadTokens?: unknown;
  cacheCreationTokens?: unknown;
  savingsRate?: unknown;
};

function mapToolRow(t: RawToolRow): ToolStat {
  const callCount = Number(t.call_count ?? t.calls ?? 0);
  const errorCount = Number(t.error_count ?? 0);
  return {
    tool_name: String(t.tool_name ?? ''),
    calls: callCount,
    avg_tokens: Number(t.avg_tokens ?? 0),
    p95_duration_ms: Number(t.p95_duration_ms ?? t.max_duration_ms ?? t.avg_duration_ms ?? 0),
    error_rate: callCount > 0 ? errorCount / callCount : 0,
  };
}

export function useToolsAnalytics(apiUrl: string, timeRange: TimeRange): ToolsAnalytics {
  const [tools, setTools] = useState<ToolStat[]>([]);
  const [byType, setByType] = useState<ByTypeRow[]>([]);
  const [cache, setCache] = useState<CacheStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchAll = async () => {
      try {
        const [toolsRes, byTypeRes, cacheRes] = await Promise.all([
          fetch(`${apiUrl}/api/stats/tools?range=${timeRange}`),
          fetch(`${apiUrl}/api/stats/by-type?range=${timeRange}`),
          fetch(`${apiUrl}/api/stats/cache?range=${timeRange}`),
        ]);
        if (cancelled) return;

        const toolsJson = (await toolsRes.json()) as ApiResp<RawToolRow[]>;
        const byTypeJson = (await byTypeRes.json()) as ApiResp<RawByTypeRow[]>;
        const cacheJson = (await cacheRes.json()) as ApiResp<RawCacheData>;

        if (cancelled) return;

        const toolsMapped = (toolsJson.data ?? []).map(mapToolRow);

        const byTypeMapped: ByTypeRow[] = (byTypeJson.data ?? []).map((r) => ({
          type: String(r.type ?? ''),
          count: Number(r.count ?? 0),
          total_tokens: Number(r.total_tokens ?? 0),
          avg_tokens: Number(r.avg_tokens ?? 0),
        }));

        const cd = cacheJson.data;
        const cacheMapped: CacheStats | null = cd
          ? {
              hitRate: Number(cd.hitRate ?? 0),
              cacheReadTokens: Number(cd.cacheReadTokens ?? 0),
              cacheCreationTokens: Number(cd.cacheCreationTokens ?? 0),
              savingsRate: Number(cd.savingsRate ?? 0),
            }
          : null;

        setTools(toolsMapped);
        setByType(byTypeMapped);
        setCache(cacheMapped);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void fetchAll();
    const id = setInterval(() => void fetchAll(), 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [apiUrl, timeRange]);

  return { tools, byType, cache, isLoading, error };
}
