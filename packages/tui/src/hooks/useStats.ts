/**
 * Stats Hook
 *
 * @description 서버에서 통계 데이터 조회
 */

import { useState, useEffect, useCallback } from 'react';

/**
 * 세션 통계
 */
export interface SessionStats {
  total_sessions: number;
  total_tokens: number;
  avg_tokens_per_session: number;
  active_sessions: number;
}

/**
 * 요청 통계
 */
export interface RequestStats {
  total_requests: number;
  total_tokens_input: number;
  total_tokens_output: number;
  total_tokens: number;
  avg_tokens_per_request: number;
  avg_duration_ms: number;
}

/**
 * 대시보드 데이터
 */
export interface DashboardData {
  summary: {
    totalSessions: number;
    totalRequests: number;
    totalTokens: number;
    activeSessions: number;
  };
  sessions: SessionStats;
  requests: RequestStats;
}

/**
 * 통계 훅 옵션
 */
export interface UseStatsOptions {
  /** API 서버 URL */
  apiUrl?: string;
  /** 폧링 간격 (ms) */
  interval?: number;
  /** 자동 갱신 */
  autoRefresh?: boolean;
}

/**
 * 통계 훅 반환값
 */
export interface UseStatsReturn {
  /** 대시보드 데이터 */
  data: DashboardData | null;
  /** 로딩 상태 */
  isLoading: boolean;
  /** 에러 메시지 */
  error: string | null;
  /** 수동 갱신 */
  refresh: () => Promise<void>;
}

/**
 * 통계 데이터 훅
 */
export function useStats(options: UseStatsOptions = {}): UseStatsReturn {
  const {
    apiUrl = 'http://localhost:9999/api/dashboard',
    interval = 5000,
    autoRefresh = true,
  } = options;

  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();

      if (result.success) {
        setData(result.data);
      } else {
        throw new Error(result.error || 'Unknown error');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch stats');
    } finally {
      setIsLoading(false);
    }
  }, [apiUrl]);

  // 자동 갱신
  useEffect(() => {
    fetchData();

    if (!autoRefresh) return;

    const timer = setInterval(fetchData, interval);
    return () => clearInterval(timer);
  }, [fetchData, autoRefresh, interval]);

  return {
    data,
    isLoading,
    error,
    refresh: fetchData,
  };
}
