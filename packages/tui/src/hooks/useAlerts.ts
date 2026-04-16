/**
 * Alert Hook
 *
 * @description 10K 토큰 초과 알림 감지
 * @see docs/planning/02-prd.md - 단순 알림
 * @see docs/planning/03-adr.md - ADR-005 (10K 고정 임계값)
 */

import { useState, useCallback, useEffect } from 'react';

/**
 * 알림 레벨
 */
export type AlertLevel = 'normal' | 'warning' | 'critical';

/**
 * 알림 임계값 설정
 */
export const ALERT_THRESHOLDS = {
  /** 주의 (5K) */
  WARNING: 5000,
  /** 경고 (10K) */
  CRITICAL: 10000,
} as const;

/**
 * 알림 아이템
 */
export interface Alert {
  id: string;
  level: AlertLevel;
  title: string;
  message: string;
  timestamp: number;
  acknowledged: boolean;
}

/**
 * 알림 옵션
 */
export interface UseAlertsOptions {
  /** 경고 임계값 */
  warningThreshold?: number;
  /** 위험 임계값 */
  criticalThreshold?: number;
  /** 최대 알림 수 */
  maxAlerts?: number;
}

/**
 * 알림 훅 반환값
 */
export interface UseAlertsReturn {
  /** 현재 알림 */
  currentAlert: Alert | null;
  /** 알림 목록 */
  alerts: Alert[];
  /** 알림 레벨 */
  currentLevel: AlertLevel;
  /** 알림 확인 */
  acknowledge: (id: string) => void;
  /** 알림 생성 */
  createAlert: (level: AlertLevel, title: string, message: string) => void;
  /** 알림 지우기 */
  clearAlert: (id: string) => void;
  /** 모든 알림 지우기 */
  clearAll: () => void;
  /** 토큰 체크 */
  checkTokenThreshold: (tokens: number, context?: string) => void;
}

/**
 * 알림 훅
 */
export function useAlerts(options: UseAlertsOptions = {}): UseAlertsReturn {
  const {
    warningThreshold = ALERT_THRESHOLDS.WARNING,
    criticalThreshold = ALERT_THRESHOLDS.CRITICAL,
    maxAlerts = 50,
  } = options;

  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [currentAlert, setCurrentAlert] = useState<Alert | null>(null);
  const [currentLevel, setCurrentLevel] = useState<AlertLevel>('normal');

  /**
   * 알림 생성
   */
  const createAlert = useCallback(
    (level: AlertLevel, title: string, message: string) => {
      const alert: Alert = {
        id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        level,
        title,
        message,
        timestamp: Date.now(),
        acknowledged: false,
      };

      setAlerts((prev) => {
        const newAlerts = [alert, ...prev].slice(0, maxAlerts);
        return newAlerts;
      });

      setCurrentAlert(alert);
      setCurrentLevel(level);

      return alert;
    },
    [maxAlerts]
  );

  /**
   * 알림 확인
   */
  const acknowledge = useCallback((id: string) => {
    setAlerts((prev) =>
      prev.map((alert) =>
        alert.id === id ? { ...alert, acknowledged: true } : alert
      )
    );

    setCurrentAlert((prev) => {
      if (prev?.id === id) {
        return { ...prev, acknowledged: true };
      }
      return prev;
    });
  }, []);

  /**
   * 알림 지우기
   */
  const clearAlert = useCallback(
    (id: string) => {
      setAlerts((prev) => prev.filter((alert) => alert.id !== id));

      // 현재 알림이 삭제되면 레벨 업데이트
      if (currentAlert?.id === id) {
        setCurrentAlert(null);
        setCurrentLevel('normal');
      }
    },
    [currentAlert]
  );

  /**
   * 모든 알림 지우기
   */
  const clearAll = useCallback(() => {
    setAlerts([]);
    setCurrentAlert(null);
    setCurrentLevel('normal');
  }, []);

  /**
   * 토큰 임계값 체크
   */
  const checkTokenThreshold = useCallback(
    (tokens: number, context = 'Request') => {
      if (tokens >= criticalThreshold) {
        createAlert(
          'critical',
          '🚨 Token Limit Exceeded',
          `${context} used ${tokens.toLocaleString()} tokens (>${criticalThreshold.toLocaleString()})`
        );
      } else if (tokens >= warningThreshold) {
        createAlert(
          'warning',
          '⚠️ High Token Usage',
          `${context} used ${tokens.toLocaleString()} tokens`
        );
      } else {
        // 정상 범위
        setCurrentLevel('normal');
      }
    },
    [warningThreshold, criticalThreshold, createAlert]
  );

  /**
   * 미확인 알림 중 가장 높은 레벨로 currentLevel 업데이트
   */
  useEffect(() => {
    const unacknowledged = alerts.filter((a) => !a.acknowledged);
    if (unacknowledged.length === 0) {
      setCurrentLevel('normal');
      setCurrentAlert(null);
      return;
    }

    // 레벨 우선순위: critical > warning > normal
    const hasCritical = unacknowledged.some((a) => a.level === 'critical');
    const hasWarning = unacknowledged.some((a) => a.level === 'warning');

    if (hasCritical) {
      setCurrentLevel('critical');
      setCurrentAlert(unacknowledged.find((a) => a.level === 'critical') || null);
    } else if (hasWarning) {
      setCurrentLevel('warning');
      setCurrentAlert(unacknowledged.find((a) => a.level === 'warning') || null);
    } else {
      setCurrentLevel('normal');
    }
  }, [alerts]);

  return {
    currentAlert,
    alerts,
    currentLevel,
    acknowledge,
    createAlert,
    clearAlert,
    clearAll,
    checkTokenThreshold,
  };
}
