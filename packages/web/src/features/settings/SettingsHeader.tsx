// features/settings/SettingsHeader.tsx — 설정 패널 헤더 (P4-09)
//
// 원본: index.html #settingsView header(:816-828, gear 아이콘 타이틀 + #settingsRefreshBtn "전체 진단 다시 실행").
//   settings-view.js settingsRefreshBtn 클릭 → 전체 진단 재실행(useAsyncResource refetch 결선).
//   SettingsLayout 의 6 패널 본문 위에 얹는 헤더 — 본 셸은 타이틀 + 새로고침 진입만 제공.
//
// 신규 계약: refresh 는 onRefresh 콜백(호출처가 6 패널 refetch 오케스트레이션). 무전역.

import type { ReactElement } from 'react';

export type SettingsHeaderLabeler = (key: string, vars?: Record<string, unknown>) => string;

export interface SettingsHeaderProps {
  /** 전체 진단 다시 실행 콜백(원본 settingsRefreshBtn). */
  onRefresh: () => void;
  /** i18n 라벨러. */
  t: SettingsHeaderLabeler;
}

/** 설정 패널 헤더 — gear 타이틀 + 진단 새로고침 버튼(.settings-header 1:1). */
export function SettingsHeader({ onRefresh, t }: SettingsHeaderProps): ReactElement {
  return (
    <header className="settings-header">
      <h2 className="settings-title">
        <svg
          className="settings-title-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1A2 2 0 1 1 4.4 17l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
        <span>{t('ui.settings-view.title', undefined) || '설정'}</span>
      </h2>
      <button
        type="button"
        className="settings-refresh-btn"
        data-tip={t('ui.settings-view.refresh-title', undefined) || ''}
        onClick={onRefresh}
      >
        {t('ui.settings-view.refresh', undefined) || '전체 진단 다시 실행'}
      </button>
    </header>
  );
}
