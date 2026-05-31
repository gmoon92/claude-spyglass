/**
 * components/settings/CodeCopyBox.tsx — 코드박스 + 우상단 복사 (P2-06 공용 leaf)
 *
 * 원본: settings-view.js .settings-code-wrap(:1274-1280 proxy, :1505-1511 server — 아키텍처 §1.1).
 *   pre.settings-code + 우상단 settings-code-copy 버튼(Copy 아이콘 + 라벨).
 *
 * 제어: onCopy(code) 통지 — 호출처가 copyToClipboard 호출(무전역, clipboard.ts).
 *
 * P2-07 재사용: ProxyPanel 셸 함수 코드박스.
 *
 * @module components/settings/CodeCopyBox
 */
import { Copy } from '../design-system/icons/Copy';

export interface CodeCopyBoxProps {
  /** 코드 본문 — React 자동 이스케이프(원본 escHtml). */
  code: string;
  /** 복사 버튼 title/aria-label/라벨(i18n). */
  copyLabel: string;
  /** 복사 통지. */
  onCopy?: (code: string) => void;
}

export function CodeCopyBox({ code, copyLabel, onCopy }: CodeCopyBoxProps) {
  return (
    <div className="settings-code-wrap">
      <pre className="settings-code">{code}</pre>
      <button
        type="button"
        className="settings-code-copy"
        title={copyLabel}
        aria-label={copyLabel}
        onClick={() => onCopy?.(code)}
      >
        <Copy />
        <span className="settings-code-copy-label">{copyLabel}</span>
      </button>
    </div>
  );
}
