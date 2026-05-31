// features/dashboard/UpdateModal.tsx — 업데이트 확인 모달 (P4-09)
//
// 원본: index.html #updateModal(:866-946, 버전 비교 + 마이그레이션/local-changes 영역 + actions) +
//   version-check.js openModal/closeModal/doUpdate(:389-495, DOM-imperative 토글).
//   controlled `open` prop 으로 .open 토글을 선언적 도출(원본 classList.add/remove('open') 대체).
//
// 본 셸 범위(task TDD): 모달 토글 + 버전 비교(current→latest) + confirm/cancel/close 배선.
//   마이그레이션 결과 3분기·local-changes(409)·copy 위임은 별도 controlled 영역(props 주입)으로 후속 결선.
//   본 컴포넌트는 fetch/POST 를 직접 하지 않는다(doUpdate 오케스트레이션은 호출처/훅이 onConfirm 으로 주입).
//
// 레이어: features 컴포넌트(controlled, 무전역).

import type { ReactElement } from 'react';

export type ModalLabeler = (key: string, vars?: Record<string, unknown>) => string;

export interface UpdateModalProps {
  /** 모달 가시성 — true 면 .open 모디파이어(원본 classList 토글 1:1). */
  open: boolean;
  /** 버전 비교 표시값. */
  currentVersion?: string;
  latestTag?: string;
  /** Update 확정(doUpdate 결선 — fetch POST 는 호출처/훅). */
  onConfirm: () => void;
  /** Cancel(closeModal 결선). */
  onCancel: () => void;
  /** 닫기(X / 배경 클릭 — closeModal 결선). */
  onClose: () => void;
  /** i18n 라벨러. */
  t: ModalLabeler;
  /** 에러/성공 메시지(doUpdate 결과 — 선택, 호출처 주입). */
  errorMessage?: string;
  successMessage?: string;
}

/** 업데이트 확인 모달 — #updateModal 1:1. open 으로 .open 토글. */
export function UpdateModal({
  open, currentVersion, latestTag, onConfirm, onCancel, onClose, t, errorMessage, successMessage,
}: UpdateModalProps): ReactElement {
  const overlayClass = `update-modal-overlay${open ? ' open' : ''}`;
  return (
    <div
      className={overlayClass}
      role="dialog"
      aria-modal="true"
      aria-labelledby="updateModalTitle"
      // 배경(overlay 자체) 클릭 시 닫힘 — 원본 modal click === modal 1:1.
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="update-modal">
        <button
          type="button"
          className="update-modal-close"
          aria-label={t('ui.html.update-modal.close-aria', undefined) || 'Close'}
          onClick={onClose}
        >
          <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true">
            <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <div className="update-modal-title" id="updateModalTitle">
          {t('ui.html.update-modal.title', undefined) || 'Update available'}
        </div>
        <div className="update-modal-body">
          <div className="update-version-compare">
            <div className="update-version-cell">
              <span className="update-version-num">{currentVersion ?? '—'}</span>
              <span className="update-version-label">
                {t('ui.html.update-modal.current-version', undefined) || 'Current'}
              </span>
            </div>
            <span className="update-version-arrow" aria-hidden="true">→</span>
            <div className="update-version-cell update-version-cell--new">
              <span className="update-version-num">{latestTag ?? '—'}</span>
              <span className="update-version-label">
                {t('ui.html.update-modal.latest-version', undefined) || 'Latest'}
              </span>
            </div>
          </div>
          <p className="update-modal-note">
            {t('ui.html.update-modal.note', undefined) || 'The server will briefly restart after installation.'}
          </p>
        </div>
        <div className="update-modal-actions">
          <button type="button" className="update-modal-btn update-modal-btn-secondary" onClick={onCancel}>
            {t('ui.html.update-modal.cancel', undefined) || 'Cancel'}
          </button>
          <button type="button" className="update-modal-btn update-modal-btn-primary" onClick={onConfirm}>
            {t('ui.html.update-modal.confirm', undefined) || 'Update'}
          </button>
        </div>
        {errorMessage ? <div className="update-modal-error">{errorMessage}</div> : null}
        {successMessage ? <div className="update-modal-success">{successMessage}</div> : null}
      </div>
    </div>
  );
}
