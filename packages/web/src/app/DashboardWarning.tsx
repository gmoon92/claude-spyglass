// app/DashboardWarning.tsx — shallow clone 경고 배너 (P4-09)
//
// 원본: index.html #dashboardShallowWarning(:950-973) + version-check.js applyShallowWarning(:139-147).
//   /api/version isShallowRepository=true && 미dismiss → 노출. dismiss 시 localStorage 영속(다시 안 봄).
//   명령적 hidden 토글 + localStorage 직접 접근을 controlled props 로 1:1 이식한다.
//
// 신규 계약:
//   - visible prop 선언(원본 el.hidden 토글 + dismiss 판정 대체). visible=false → null 렌더.
//   - dismiss 의 localStorage 쓰기는 호출처(AppShell)가 onDismiss 에서 수행(무전역).
//   - copy 는 onCopy 콜백(원본 bindCopyDelegation 의 navigator.clipboard 결선을 호출처가 담당).
//
// 제안 명령(git fetch --unshallow)은 비번역 코드 블록(version-check.js T-10 1:1, 라벨만 i18n).

import type { ReactElement } from 'react';

export type WarningLabeler = (key: string, vars?: Record<string, unknown>) => string;

/** 제안 명령 SSoT — index.html :957 1:1(shallow clone 해소). */
export const SHALLOW_FIX_COMMAND = 'git fetch --unshallow';

export interface DashboardWarningProps {
  /** shallow & 미dismiss 여부 — true 일 때만 노출(applyShallowWarning 1:1). */
  visible: boolean;
  /** dismiss 버튼 콜백 — 호출처가 localStorage 영속 + visible 갱신. */
  onDismiss: () => void;
  /** 명령 복사 콜백 — 호출처가 navigator.clipboard 결선(SHALLOW_FIX_COMMAND 전달). */
  onCopy: (command: string) => void;
  /** i18n 라벨러. */
  t: WarningLabeler;
}

/** 복사 아이콘 — index.html copy 버튼 SVG 1:1. */
function CopyIcon(): ReactElement {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true">
      <rect x="3.5" y="3.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2 8V2.5C2 2 2 2 2.5 2H8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/**
 * shallow clone 경고 배너 — #dashboardShallowWarning 1:1. visible=false 면 미렌더.
 */
export function DashboardWarning({ visible, onDismiss, onCopy, t }: DashboardWarningProps): ReactElement | null {
  if (!visible) return null;
  return (
    <div className="dashboard-warning dashboard-warning--shallow" role="status" aria-live="polite">
      <span className="dashboard-warning-glyph" aria-hidden="true">!</span>
      <div className="dashboard-warning-body">
        <span className="dashboard-warning-title">
          {t('ui.version-check.shallow.warning', undefined) || 'Shallow clone — auto-update may fail'}
        </span>
        <p className="dashboard-warning-text">
          {t('ui.version-check.shallow.body', undefined) || 'This install is a git shallow clone…'}
        </p>
        <div className="dashboard-warning-cmd-row">
          <span className="dashboard-warning-cmd-label">
            {t('ui.html.dashboard-warning.shallow-cmd-label', undefined) || 'Suggested command'}
          </span>
          <code className="dashboard-warning-cmd">{SHALLOW_FIX_COMMAND}</code>
          <button
            type="button"
            className="dashboard-warning-cmd-copy"
            aria-label={t('ui.html.update-modal.copy', undefined) || 'Copy'}
            onClick={() => onCopy(SHALLOW_FIX_COMMAND)}
          >
            <CopyIcon />
          </button>
        </div>
      </div>
      <button
        type="button"
        className="dashboard-warning-dismiss"
        aria-label={t('ui.html.dashboard-warning.shallow-dismiss-aria', undefined) || 'Dismiss'}
        onClick={onDismiss}
      >
        <svg viewBox="0 0 12 12" width="10" height="10" fill="none" aria-hidden="true">
          <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
