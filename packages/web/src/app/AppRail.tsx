// app/AppRail.tsx — 좌측 56px 앱 모드 rail (P4-09)
//
// 원본: assets/js/app-rail.js (initAppRail/setRailActive/syncRailButtons) +
//   index.html .app-rail aside(:130-165, ADR-003 left-rail-meta-docs).
//   imperative 클릭 위임 + aria-current 토글을 controlled React 컴포넌트로 1:1 이식한다.
//
// 신규 계약(원본 대비):
//   - aria-current 는 appMode prop 에서 선언적으로 도출(syncRailButtons 의 명령적 토글 대체).
//   - rail 은 직접 view 를 만지지 않고 onSelect 콜백에 raw mode 만 전달(app-rail.js applyAppMode 주입 1:1).
//   - 아이콘 SVG 는 index.html 원본(:135-163) 마크업 그대로(traffic / book / gear).
//
// 레이어(architecture.md §1.3): app 셸 컴포넌트(controlled, 무전역). 호출처(AppShell)가 store 결선.

import type { ReactElement } from 'react';
import type { AppMode } from '../stores/app-store';

/** rail 모드 순서 SSoT — index.html 버튼 순서(browse → metadocs → settings) 1:1. */
export const APP_RAIL_MODES: readonly AppMode[] = ['browse', 'metadocs', 'settings'] as const;

/** AppRail 라벨러 — window.I18n 무참조(호출처가 tt 주입). */
export type RailLabeler = (key: string, vars?: Record<string, unknown>) => string;

export interface AppRailProps {
  /** 현재 활성 모드 — 활성 버튼에 aria-current="page" 부여(controlled). */
  appMode: AppMode;
  /** 모드 버튼 클릭 콜백 — raw mode 전달(app-rail.js applyAppMode 주입 1:1). */
  onSelect: (mode: AppMode) => void;
  /** i18n 라벨러(aria-label/title) — 미주입 시 호출처가 tt 폴백. */
  t: RailLabeler;
}

/** 모드별 aria-label/title i18n 키 + SVG 아이콘 — index.html :131-163 1:1. */
const RAIL_BUTTONS: ReadonlyArray<{
  mode: AppMode;
  ariaKey: string;
  titleKey: string;
  ariaFallback: string;
  titleFallback: string;
  icon: ReactElement;
}> = [
  {
    mode: 'browse',
    ariaKey: 'ui.html.app-rail.browse-aria',
    titleKey: 'ui.html.app-rail.browse-title',
    ariaFallback: 'Browse (sessions & requests)',
    titleFallback: 'Browse',
    // Lucide-style traffic/signal — 3 가로 막대(세션/턴 흐름).
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="5" width="16" height="2.5" rx="1" />
        <rect x="4" y="11" width="10" height="2.5" rx="1" />
        <rect x="4" y="17" width="13" height="2.5" rx="1" />
      </svg>
    ),
  },
  {
    mode: 'metadocs',
    ariaKey: 'ui.html.app-rail.metadocs-aria',
    titleKey: 'ui.html.app-rail.metadocs-title',
    ariaFallback: 'Behavior Definitions catalog',
    titleFallback: 'Behavior Definitions',
    // Lucide-style book — 펼친 책(정의/카탈로그).
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 4.5C3 3.7 3.7 3 4.5 3H11V20H4.5C3.7 20 3 19.3 3 18.5V4.5Z" strokeLinejoin="round" />
        <path d="M21 4.5C21 3.7 20.3 3 19.5 3H13V20H19.5C20.3 20 21 19.3 21 18.5V4.5Z" strokeLinejoin="round" />
        <line x1="11" y1="3" x2="11" y2="20" />
        <line x1="13" y1="3" x2="13" y2="20" />
      </svg>
    ),
  },
  {
    mode: 'settings',
    ariaKey: 'ui.html.app-rail.settings-aria',
    titleKey: 'ui.html.app-rail.settings-title',
    ariaFallback: 'Settings — Diagnostics, Hook, Graph DB',
    titleFallback: 'Settings',
    // Lucide-style gear — 8 톱니 + 중앙 원.
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path
          d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1A2 2 0 1 1 4.4 17l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

/**
 * 좌측 앱 모드 rail — 3 모드 버튼 + aria-current 선언적 동기(app-rail.js syncRailButtons 1:1).
 * 클릭 시 onSelect(mode) 호출(app-rail.js 클릭 위임 1:1) — view 가시성은 호출처(라우터)가 결정.
 */
export function AppRail({ appMode, onSelect, t }: AppRailProps): ReactElement {
  return (
    <aside className="app-rail" aria-label={t('ui.html.app-rail.aria', undefined) || 'App mode'}>
      {RAIL_BUTTONS.map(({ mode, ariaKey, titleKey, ariaFallback, titleFallback, icon }) => {
        const isActive = mode === appMode;
        return (
          <button
            key={mode}
            type="button"
            className="app-rail-btn"
            data-app-mode={mode}
            aria-current={isActive ? 'page' : undefined}
            aria-label={t(ariaKey, undefined) || ariaFallback}
            data-tip={t(titleKey, undefined) || titleFallback}
            onClick={() => onSelect(mode)}
          >
            {icon}
          </button>
        );
      })}
    </aside>
  );
}
