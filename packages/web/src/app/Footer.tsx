// app/Footer.tsx — 앱 푸터 + 단축키 도움말 버튼 (P4-09)
//
// 원본: index.html .footer(:854-859, 브랜드 텍스트 + #btnHelpOpen "?" 버튼).
//   keyboard-help.js 가 #btnHelpOpen 클릭으로 단축키 오버레이를 열었다.
//   본 셸은 도움말 진입만 onHelp 콜백으로 노출(오버레이 자체는 후속 chrome — 본 범위 밖).
//
// 레이어: app 셸 컴포넌트(controlled, 무전역).

import type { ReactElement } from 'react';

export type FooterLabeler = (key: string, vars?: Record<string, unknown>) => string;

export interface FooterProps {
  /** 단축키 도움말 버튼 클릭 콜백(원본 btnHelpOpen → keyboard-help 오버레이). */
  onHelp: () => void;
  /** i18n 라벨러 — title/aria-label 용. */
  t: FooterLabeler;
}

/** 앱 푸터 — 브랜드 텍스트 + 단축키 도움말 버튼(.footer 1:1). */
export function Footer({ onHelp, t }: FooterProps): ReactElement {
  return (
    <footer className="footer">
      Claude Spyglass — real-time Claude Code monitor
      <button
        type="button"
        className="footer-help-btn"
        data-tip={t('ui.html.footer.help-title', undefined) || 'Keyboard shortcuts (?)'}
        aria-label={t('ui.html.footer.help-aria', undefined) || 'Keyboard shortcuts'}
        onClick={onHelp}
      >
        ?
      </button>
    </footer>
  );
}
