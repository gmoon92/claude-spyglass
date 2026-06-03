/**
 * features/dashboard/SystemPromptDetailModal.tsx — System Prompt 본문 상세 모달 (P3 결함 #2 복원)
 *
 * 원본: assets/js/system-prompt-library.js#showDetailModal/ensureDetailModal/renderModalShell.
 *  - 레거시는 `tr.syslib-row[data-syslib-hash]` 클릭 시 hash 로 본문을 lazy-fetch 해
 *    `#sysLibDetailModal.syslib-detail-modal` 모달에 전체 system prompt 본문을 표시했다.
 *  - React SystemPromptLibrary 는 행(onOpenRow 콜백)만 있고 모달이 없어 클릭이 무반응이었다.
 *
 * 본 컴포넌트는 레거시 모달 마크업을 1:1 복원한 presentation 이다(셀렉터 계약 보존):
 *  - 컨테이너 id=`sysLibDetailModal` / class=`syslib-detail-modal` (backdrop = 컨테이너 자신).
 *  - 닫기: × 버튼(data-syslib-close) / backdrop 클릭 / ESC.
 *  - body 소스: hash 로 fetch 한 content(+meta) 를 props 로 주입받는다(fetch 는 컨테이너가
 *    오케스트레이션 — architecture.md §1.3 presentation↛api). loading/notFound/error 분기는
 *    레거시 skeleton/not-found/load-failed 와 동치.
 *
 * 셀렉터 계약: syslib-detail-modal / syslib-detail-inner / syslib-detail-close / data-syslib-close /
 *   syslib-detail-head / syslib-detail-hash / syslib-detail-content / syslib-dim — 레거시 syslib.css SSoT.
 *
 * @module features/dashboard/SystemPromptDetailModal
 * @see packages/web/assets/js/system-prompt-library.js#showDetailModal
 */
import { useEffect, type ReactElement } from 'react';
import { CloseButton } from '../../components/design-system/primitives/CloseButton';
import { formatBytes } from './syslib-sort';

export type TFunc = (key: string, vars?: Record<string, unknown>) => string;

/** 모달이 표시할 본문 상태(컨테이너의 fetch 결과). */
export interface SystemPromptDetail {
  hash: string;
  content?: string | null;
  byte_size?: number | null;
  segment_count?: number | null;
  ref_count?: number | null;
}

export interface SystemPromptDetailModalProps {
  /** 열린 행의 hash. null 이면 모달 미표시(레거시 modal.hidden). */
  hash: string | null;
  /** 본문 fetch 진행 중(레거시 skeleton). */
  loading: boolean;
  /** fetch 결과(content+meta). hash 와 일치하는 데이터. */
  detail: SystemPromptDetail | null;
  /** fetch 에러 메시지(레거시 modal-load-failed). */
  error?: string | null;
  /** 닫기(× / backdrop / ESC 공통). */
  onClose: () => void;
  /** i18n t(필수 — DI). 호출처가 react-i18next t 주입, 테스트가 stub 주입. */
  t: TFunc;
}

/**
 * System Prompt 본문 모달 — hash 가 있을 때만 렌더(부모가 조건부 마운트하지 않아도 안전).
 * ESC 키 닫기는 mount 동안 document 리스너로(레거시 onKey 동치).
 */
export function SystemPromptDetailModal({
  hash,
  loading,
  detail,
  error = null,
  onClose,
  t,
}: SystemPromptDetailModalProps): ReactElement | null {
  // ESC 닫기(레거시 document.addEventListener('keydown', onKey)). hash 활성일 때만 등록.
  useEffect(() => {
    if (!hash) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [hash, onClose]);

  if (!hash) return null;

  // 본문 영역 — loading → error → not-found → content 순서(레거시 분기 동치).
  let inner: ReactElement;
  if (loading) {
    inner = (
      <div className="syslib-detail-inner" data-skeleton="1">
        <p className="syslib-dim">{t('ui.html.detail-loading')}</p>
      </div>
    );
  } else if (error) {
    inner = (
      <div className="syslib-detail-inner">
        <CloseButton
          size="lg"
          label={t('ui.syslib.close-label')}
          dataAttrs={{ 'syslib-close': '' }}
          className="syslib-detail-close ds-close-btn"
          onClick={onClose}
        />
        <p className="syslib-dim">{t('ui.syslib.modal-load-failed', { message: error })}</p>
      </div>
    );
  } else if (!detail) {
    inner = (
      <div className="syslib-detail-inner">
        <CloseButton
          size="lg"
          label={t('ui.syslib.close-label')}
          dataAttrs={{ 'syslib-close': '' }}
          className="syslib-detail-close ds-close-btn"
          onClick={onClose}
        />
        <p className="syslib-dim">{t('ui.syslib.not-found')}</p>
      </div>
    );
  } else {
    inner = (
      <div className="syslib-detail-inner">
        <CloseButton
          size="lg"
          label={t('ui.syslib.close-label')}
          dataAttrs={{ 'syslib-close': '' }}
          className="syslib-detail-close ds-close-btn"
          onClick={onClose}
        />
        <header className="syslib-detail-head">
          <code className="syslib-detail-hash">{detail.hash}</code>
          <span>{formatBytes(detail.byte_size ?? null)}</span>
          <span>seg={detail.segment_count ?? '?'}</span>
          <span>ref={detail.ref_count ?? '?'}</span>
        </header>
        <pre className="syslib-detail-content">{detail.content ?? ''}</pre>
      </div>
    );
  }

  return (
    <div
      id="sysLibDetailModal"
      className="syslib-detail-modal"
      role="dialog"
      aria-modal="true"
      // backdrop(=컨테이너 자기 자신) 직접 클릭 시에만 닫음(레거시 e.target === modal).
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {inner}
    </div>
  );
}
