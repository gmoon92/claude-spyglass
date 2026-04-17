import { useState, useEffect, useCallback } from 'react';

export interface AnalysisResult {
  topRequests: Array<{
    id: string;
    type: string;
    tool_name?: string | null;
    tokens_total: number;
    timestamp: number;
  }>;
  typeStats: Array<{
    type: string;
    count: number;
    total_tokens: number;
    avg_tokens: number;
  }>;
  toolStats: Array<{
    tool_name: string;
    call_count: number;
    total_tokens: number;
    avg_tokens: number;
  }>;
  errors: { top?: string; type?: string; tool?: string };
}

export interface UseAnalysisOptions {
  apiUrl?: string;
  interval?: number;
}

export interface UseAnalysisReturn {
  data: AnalysisResult | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useAnalysis(options: UseAnalysisOptions = {}): UseAnalysisReturn {
  const { apiUrl = 'http://localhost:9999', interval = 10000 } = options;
  const [data, setData] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [topRes, typeRes, toolRes] = await Promise.allSettled([
      fetch(`${apiUrl}/api/requests/top?limit=10`).then(r => r.json()),
      fetch(`${apiUrl}/api/stats/by-type`).then(r => r.json()),
      fetch(`${apiUrl}/api/stats/tools?limit=10`).then(r => r.json()),
    ]);
    const errors: AnalysisResult['errors'] = {};
    const result: AnalysisResult = { topRequests: [], typeStats: [], toolStats: [], errors };

    if (topRes.status === 'fulfilled' && topRes.value.success) {
      result.topRequests = topRes.value.data || [];
    } else {
      errors.top = topRes.status === 'rejected' ? topRes.reason?.message : 'fetch failed';
    }
    if (typeRes.status === 'fulfilled' && typeRes.value.success) {
      result.typeStats = typeRes.value.data || [];
    } else {
      errors.type = typeRes.status === 'rejected' ? typeRes.reason?.message : 'fetch failed';
    }
    if (toolRes.status === 'fulfilled' && toolRes.value.success) {
      result.toolStats = toolRes.value.data || [];
    } else {
      errors.tool = toolRes.status === 'rejected' ? toolRes.reason?.message : 'fetch failed';
    }

    setData(result);
    setLoading(false);
  }, [apiUrl]);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, interval);
    return () => clearInterval(id);
  }, [fetchAll, interval]);

  return { data, loading, refresh: fetchAll };
}
