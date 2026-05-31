/**
 * components/settings/TooltipHost.tsx — ⓘ 호버 툴팁 (P2-06 공용 leaf)
 *
 * 원본: settings-view.js .settings-tooltip-host(:437-440 hook, :734 graph, :1219 proxy, :1246
 *   proxy 제목 — 4곳, 아키텍처 §1.1). OptionCard 내부 + proxy 제목 옆에서 단독으로도 쓰인다.
 *   구조: tabindex 0 host + ⓘ 아이콘(aria-hidden) + role=tooltip 버블. aria-label=text.
 *
 * P2-07 재사용: GraphPanel/ProxyPanel 옵션 카드 + 제목 툴팁.
 *
 * @module components/settings/TooltipHost
 */

export interface TooltipHostProps {
  /** 툴팁 텍스트 — aria-label + 버블 본문 동일(원본 :437). React 자동 이스케이프. */
  text: string;
}

export function TooltipHost({ text }: TooltipHostProps) {
  return (
    <span className="settings-tooltip-host" tabIndex={0} aria-label={text}>
      <span className="settings-tooltip-icon" aria-hidden="true">ⓘ</span>
      <span className="settings-tooltip-bubble" role="tooltip">{text}</span>
    </span>
  );
}
