/**
 * components/settings/InlineCopyButton.tsx — inline 복사 버튼 (P2-06 공용 leaf)
 *
 * 원본: settings-view.js .settings-inline-copy(:211-212 diag installHint, :1106 sqlite — 아키텍처 §1.1).
 *   data-copy-text 속성 + Copy 아이콘 + title. 클릭 시 clipboard 복사(원본 위임 :362-367).
 *
 * 제어: onCopy(text) 통지 — 호출처가 copyToClipboard(clipboard.ts) 호출(부수효과 분리, 무전역).
 *   data-copy-text 셀렉터 계약 보존(아키텍처 §4.2).
 *
 * P2-07 재사용: SqlitePanel CLI 명령 복사.
 *
 * @module components/settings/InlineCopyButton
 */
import { Copy } from '../design-system/icons/Copy';

export interface InlineCopyButtonProps {
  /** 복사할 텍스트 — data-copy-text. */
  text: string;
  /** title/aria-label. */
  title: string;
  /** 복사 통지 — 호출처가 clipboard 부수효과 수행. */
  onCopy?: (text: string) => void;
}

export function InlineCopyButton({ text, title, onCopy }: InlineCopyButtonProps) {
  return (
    <button
      type="button"
      className="settings-inline-copy"
      data-copy-text={text}
      title={title}
      aria-label="copy"
      onClick={() => onCopy?.(text)}
    >
      <Copy />
    </button>
  );
}
