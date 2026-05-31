/**
 * components/settings/StickyAlert.tsx — 재시작 안내 등 고정 배너 (P2-06 공용 leaf)
 *
 * 원본: settings-view.js showStickyAlert(:566-603) — `#settingsStickyAlertSlot` 동적 삽입 +
 *   4s fade timer. 아키텍처 §4.4: 명령형 createElement/append 전부 제거 → 선언형 컴포넌트 +
 *   useEffect setTimeout cleanup(언마운트 시 clearTimeout — 타이머 누수 방지, §4.4).
 *
 * 상수 보존: STICKY_ALERT_DURATION_MS=4000(:566), STICKY_ALERT_FADE_MS=320(:567).
 *   동일 kind 갱신+타이머 리셋(:589-594)은 React key 로 재현(호출처가 message 변경 시 key 갱신).
 *
 * @module components/settings/StickyAlert
 */
import { useEffect, useState } from 'react';

export const STICKY_ALERT_DURATION_MS = 4000;
export const STICKY_ALERT_FADE_MS = 320;

export interface StickyAlertProps {
  /** 배너 메시지(i18n). */
  message: string;
  /** 알림 종류 — data-alert-kind + 변형 클래스(원본 :586-587). */
  kind?: string;
  /** fade-out 후 완전 사라짐 통지 — 호출처가 언마운트(원본 :601 alert.remove 대체). */
  onDismissed?: () => void;
}

export function StickyAlert({ message, kind = 'info', onDismissed }: StickyAlertProps) {
  const [fading, setFading] = useState(false);

  useEffect(() => {
    // 4s 후 fade-out 시작 → fade 완료 후 dismiss 통지. 언마운트 시 양 타이머 clear(누수 방지).
    const dismissTimer = setTimeout(() => setFading(true), STICKY_ALERT_DURATION_MS);
    const removeTimer = setTimeout(
      () => onDismissed?.(),
      STICKY_ALERT_DURATION_MS + STICKY_ALERT_FADE_MS,
    );
    return () => {
      clearTimeout(dismissTimer);
      clearTimeout(removeTimer);
    };
  }, [message, kind, onDismissed]);

  return (
    <div className="settings-sticky-alert-slot">
      <div
        className={`settings-sticky-alert settings-sticky-alert-${kind}${fading ? ' is-fading-out' : ''}`}
        data-alert-kind={kind}
      >
        <span className="settings-sticky-alert-icon">⚠</span>
        <span className="settings-sticky-alert-text">{message}</span>
      </div>
    </div>
  );
}
