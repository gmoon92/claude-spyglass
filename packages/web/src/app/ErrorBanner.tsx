// app/ErrorBanner.tsx — SSE 연결 실패 배너 (P4-09)
//
// 원본: index.html #errorBanner(:117-123, info 아이콘 + 메시지 + retry 버튼).
//   main.js startSSE onError 시 표출 / onOpen 시 숨김(connectSSE 생명주기).
//   명령적 가시성 토글을 controlled `visible` prop 으로 1:1 이식한다.
//
// 신규 계약: 가시성은 visible prop 선언(원본 style/hidden 명령적 토글 대체).
//   visible=false → null 렌더(DOM 미생성). retry 는 onRetry 콜백(원본 retryBtn 클릭 → reconnect).
//
// 레이어: app 셸 컴포넌트(controlled, 무전역). 호출처(AppShell)가 connected 상태/재연결 결선.

import type { ReactElement } from 'react';

export type BannerLabeler = (key: string, vars?: Record<string, unknown>) => string;

export interface ErrorBannerProps {
  /** 연결 실패 여부 — true 일 때만 배너 노출(SSE onError 결선). */
  visible: boolean;
  /** retry 버튼 클릭 콜백 — 원본 retryBtn → 재연결 트리거. */
  onRetry: () => void;
  /** i18n 라벨러 — 미주입 시 호출처가 tt 폴백. */
  t: BannerLabeler;
}

/**
 * SSE 연결 실패 배너 — #errorBanner 1:1. visible=false 면 미렌더.
 */
export function ErrorBanner({ visible, onRetry, t }: ErrorBannerProps): ReactElement | null {
  if (!visible) return null;
  return (
    <div className="error-banner" role="alert">
      <svg
        className="ds-icon"
        data-icon="info"
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="8" cy="8" r="6.5" />
        <line x1="8" y1="5" x2="8" y2="9" />
        <circle cx="8" cy="11.5" r="0.6" fill="currentColor" stroke="none" />
      </svg>
      <span>{t('ui.html.error-banner.msg', undefined) || 'Cannot connect to server.'}</span>
      <button type="button" className="retry-btn" onClick={onRetry}>
        {t('ui.html.error-banner.retry', undefined) || 'Retry'}
      </button>
    </div>
  );
}
