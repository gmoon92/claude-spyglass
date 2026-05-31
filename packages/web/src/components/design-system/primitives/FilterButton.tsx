/**
 * design-system/primitives/FilterButton.tsx — 필터 버튼 원시 컴포넌트 (P2-02)
 *
 * 원본: assets/js/design-system/primitives/filter-button.js renderFilterBtn.
 *  - 출력 마크업 동치: class="ds-filter-btn" type="button" aria-pressed data-strength data-value? → label.
 *  - 속성 순서(동치 핵심): class → type → aria-pressed → data-strength → data-value?(있을 때만).
 *  - strength 폴백: soft|strong 외 입력은 soft(원본 동일).
 *  - value 가 undefined 면 data-value 속성 자체를 출력하지 않음(원본 동일).
 *  - label escape: 원본은 escHtml(& < > ")을 적용. React 는 텍스트 노드에서 & < > 를 escape 하고
 *    " 는 텍스트로 안전(미escape) — 시각·보안 동치(따옴표는 텍스트 컨텐츠에서 무해).
 *
 * 원본 대비 변경(신규 계약):
 *  - onClick 등 상호작용 핸들러를 <button> 에 전달(원본 string 버전엔 없던 배선).
 *
 * @module design-system/primitives/FilterButton
 */
import type { ButtonHTMLAttributes } from 'react';

export type FilterStrength = 'soft' | 'strong';

export interface FilterButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 버튼 레이블(React 가 텍스트 노드로 안전 escape). */
  label: string;
  /** 활성 상태(aria-pressed). 기본 false. */
  active?: boolean;
  /** 활성 강조 강도. soft|strong 외 입력은 soft 폴백(원본 동일). 기본 soft. */
  strength?: FilterStrength;
  /** data-value 식별자. undefined 면 속성 미출력(원본 동일). */
  value?: string;
}

function safeStrength(s?: string): FilterStrength {
  return s === 'soft' || s === 'strong' ? s : 'soft';
}

export function FilterButton({ label, active = false, strength, value, ...rest }: FilterButtonProps) {
  return (
    <button
      className="ds-filter-btn"
      type="button"
      aria-pressed={active ? 'true' : 'false'}
      data-strength={safeStrength(strength)}
      {...(value !== undefined ? { 'data-value': value } : {})}
      {...rest}
    >
      {label}
    </button>
  );
}
