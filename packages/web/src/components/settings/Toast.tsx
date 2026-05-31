/**
 * components/settings/Toast.tsx — 복사 성공 등 1.8s 토스트 (P2-06 공용 leaf)
 *
 * 원본: settings-view.js toast(:1579-1590) — body 직접 append + is-show 토글 + 1.8s 후 제거.
 *   아키텍처 §4.4: body 직접 append(React 트리 밖) → portal 정석. enter/leave 클래스 토글
 *   (:1585-1588)은 useEffect 로 재현. 호출처가 전역 1개 Toast 호스트로 마운트.
 *
 * 상수: SHOW_DELAY_MS=10(:1585), DURATION_MS=1800(:1586), LEAVE_MS=200(:1588) 보존.
 *
 * @module components/settings/Toast
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export const TOAST_SHOW_DELAY_MS = 10;
export const TOAST_DURATION_MS = 1800;
export const TOAST_LEAVE_MS = 200;

export interface ToastProps {
  /** 토스트 메시지. */
  message: string;
  /** leave 완료 후 제거 통지 — 호출처가 언마운트(원본 :1589 el.remove 대체). */
  onDone?: () => void;
  /** portal 대상(테스트 주입용). 기본 document.body(원본 :1584). */
  container?: Element | null;
}

export function Toast({ message, onDone, container }: ToastProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const showTimer = setTimeout(() => setShow(true), TOAST_SHOW_DELAY_MS);
    const leaveTimer = setTimeout(() => setShow(false), TOAST_DURATION_MS);
    const doneTimer = setTimeout(() => onDone?.(), TOAST_DURATION_MS + TOAST_LEAVE_MS);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(leaveTimer);
      clearTimeout(doneTimer);
    };
  }, [message, onDone]);

  const host = container ?? (typeof document !== 'undefined' ? document.body : null);
  const node = (
    <div className={`settings-toast${show ? ' is-show' : ''}`}>{message}</div>
  );
  return host ? createPortal(node, host) : node;
}
