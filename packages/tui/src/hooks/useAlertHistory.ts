/**
 * Alert History Hook
 *
 * @description 알림 기록 저장 및 조회
 */

import { useState, useCallback } from 'react';
import type { Alert, AlertLevel } from './useAlerts';

/**
 * 히스토리 옵션
 */
export interface UseAlertHistoryOptions {
  maxHistory?: number;
}

/**
 * 히스토리 훅 반환값
 */
export interface UseAlertHistoryReturn {
  /** 알림 히스토리 */
  history: Alert[];
  /** 히스토리에 추가 */
  addToHistory: (alert: Alert) => void;
  /** 필터링된 히스토리 */
  getHistoryByLevel: (level: AlertLevel) => Alert[];
  /** 날짜 범위로 조회 */
  getHistoryByDateRange: (start: number, end: number) => Alert[];
  /** 히스토리 지우기 */
  clearHistory: () => void;
}

/**
 * 알림 히스토리 훅
 */
export function useAlertHistory(options: UseAlertHistoryOptions = {}): UseAlertHistoryReturn {
  const { maxHistory = 100 } = options;
  const [history, setHistory] = useState<Alert[]>([]);

  /**
   * 히스토리에 추가
   */
  const addToHistory = useCallback((alert: Alert) => {
    setHistory((prev) => [alert, ...prev].slice(0, maxHistory));
  }, [maxHistory]);

  /**
   * 레벨별 히스토리 조회
   */
  const getHistoryByLevel = useCallback((level: AlertLevel) => {
    return history.filter((alert) => alert.level === level);
  }, [history]);

  /**
   * 날짜 범위로 조회
   */
  const getHistoryByDateRange = useCallback((start: number, end: number) => {
    return history.filter(
      (alert) => alert.timestamp >= start && alert.timestamp <= end
    );
  }, [history]);

  /**
   * 히스토리 지우기
   */
  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  return {
    history,
    addToHistory,
    getHistoryByLevel,
    getHistoryByDateRange,
    clearHistory,
  };
}
