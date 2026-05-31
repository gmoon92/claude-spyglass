/**
 * design-system/primitives/Tab.tsx — 탭 버튼 원시 컴포넌트 (P2-02)
 *
 * 원본: assets/js/design-system/primitives/tab.js renderTab.
 *  - 출력 마크업 동치: class="ds-tab" type="button" role="tab" aria-selected data-tab-value? → label.
 *  - 속성 순서(동치 핵심): class → type → role → aria-selected → data-tab-value?(있을 때만).
 *  - value 가 undefined 면 data-tab-value 속성 자체를 출력하지 않음(원본 동일).
 *  - label escape: 원본 escHtml 대비 React 텍스트 노드는 & < > escape, " 미escape(시각·보안 동치).
 *  - 선택 상태 전환은 CSS 단독(aria-selected 토글)으로 처리(원본 설계 계승).
 *
 * 원본 대비 변경(신규 계약):
 *  - onClick 등 상호작용 핸들러를 <button> 에 전달(원본 string 버전엔 없던 배선).
 *
 * @module design-system/primitives/Tab
 */
import type { ButtonHTMLAttributes } from 'react';

export interface TabProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 탭 레이블(React 가 텍스트 노드로 안전 escape). */
  label: string;
  /** 선택 상태(aria-selected). 기본 false. */
  selected?: boolean;
  /** data-tab-value 식별자. undefined 면 속성 미출력(원본 동일). */
  value?: string;
}

export function Tab({ label, selected = false, value, ...rest }: TabProps) {
  return (
    <button
      className="ds-tab"
      type="button"
      role="tab"
      aria-selected={selected ? 'true' : 'false'}
      {...(value !== undefined ? { 'data-tab-value': value } : {})}
      {...rest}
    >
      {label}
    </button>
  );
}
