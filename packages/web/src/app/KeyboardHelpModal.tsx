// app/KeyboardHelpModal.tsx — 키보드 단축키 도움말 모달 (keyboard-shortcuts 복원)
//
// 원본: main.js#renderKbdHelpModal(:982-1022) — index.html 다이어트로 JS 주입하던
//   #kbdHelpBackdrop 마크업의 선언적 포트. 스타일은 기존 keyboard-help.css
//   (.kbd-help-backdrop/.kbd-help-modal — 데몬 정적 서빙, vite externalize 목록 기존재) 1:1.
//   레거시는 backdrop 의 .visible 클래스 토글로 show/hide 했으나, controlled React 에선
//   open 시에만 마운트(visible 동반)한다 — CSS 계약(.kbd-help-backdrop.visible{display:flex}) 동일.
//
// 필터 행(1–7)은 단축키 매핑 SSoT(use-keyboard-shortcuts.ts KEYBOARD_FILTER_KEYS)에서 파생해
//   실제 1-7 키 동작과 표가 항상 일치한다(레거시는 하드코딩 — 매핑·표 이중 관리였음).
//
// 레이어: app 셸 컴포넌트(controlled, 무전역). i18n 키 ui.main.kbd-help.* (4 locale 기존재).

import type { ReactElement } from 'react';
import { KEYBOARD_FILTER_KEYS } from './use-keyboard-shortcuts';

export type KbdHelpLabeler = (key: string, vars?: Record<string, unknown>) => string;

/** 필터 키 → 도움말 표시 라벨(레거시 renderKbdHelpModal 하드코딩 텍스트 1:1). */
const FILTER_KEY_LABELS: Record<string, string> = {
  all: 'All',
  agent: 'Agent',
  skill: 'Skill',
  mcp: 'MCP',
};

function filterKeyLabel(key: string): string {
  return FILTER_KEY_LABELS[key] ?? key; // prompt/system/tool_call 은 키 그대로(레거시 동일).
}

export interface KeyboardHelpModalProps {
  /** 모달 열림(controlled) — AppShell 이 소유. */
  open: boolean;
  /** 닫기 통지(백드롭 클릭 / × 버튼 — 레거시 hideKbdHelp 경로). */
  onClose: () => void;
  /** i18n 라벨러 — ui.main.kbd-help.* 키. */
  t: KbdHelpLabeler;
}

/** 단축키 도움말 모달 — 레거시 #kbdHelpBackdrop(role=dialog) 1:1. */
export function KeyboardHelpModal({ open, onClose, t }: KeyboardHelpModalProps): ReactElement | null {
  if (!open) return null;
  return (
    <div
      className="kbd-help-backdrop visible"
      id="kbdHelpBackdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="kbdHelpTitle"
      onClick={(e) => {
        // 레거시: backdrop 자기 자신 클릭만 닫기(모달 내부 클릭 무시 — e.target === backdrop).
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="kbd-help-modal" role="document">
        <div className="kbd-help-header">
          <span className="kbd-help-title" id="kbdHelpTitle">{t('ui.main.kbd-help.title')}</span>
          <button
            className="kbd-help-close ds-close-btn"
            id="kbdHelpClose"
            type="button"
            aria-label={t('ui.main.kbd-help.close')}
            data-size="lg"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="kbd-help-body">
          <div className="kbd-help-section">
            <div className="kbd-help-section-title">{t('ui.main.kbd-help.section.nav')}</div>
            <div className="kbd-help-row">
              <span className="kbd-key">/</span>
              <span className="kbd-help-desc">{t('ui.main.kbd-help.focus-search')}</span>
            </div>
            <div className="kbd-help-row">
              <span className="kbd-key">Esc</span>
              <span className="kbd-help-desc">{t('ui.main.kbd-help.close-modal')}</span>
            </div>
            <div className="kbd-help-row">
              <span className="kbd-key">⌘F</span>
              <span className="kbd-help-desc">{t('ui.main.kbd-help.focus-search-cmd')}</span>
            </div>
          </div>
          <div className="kbd-help-section">
            <div className="kbd-help-section-title">{t('ui.main.kbd-help.section.filter')}</div>
            {KEYBOARD_FILTER_KEYS.map((key, i) => (
              <div className="kbd-help-row" key={key}>
                <span className="kbd-key">{i + 1}</span>
                <span className="kbd-help-desc">{filterKeyLabel(key)}</span>
              </div>
            ))}
          </div>
          <div className="kbd-help-section">
            <div className="kbd-help-section-title">{t('ui.main.kbd-help.section.help')}</div>
            <div className="kbd-help-row">
              <span className="kbd-key">?</span>
              <span className="kbd-help-desc">{t('ui.main.kbd-help.help-toggle')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
