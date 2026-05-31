/**
 * design-system/primitives/CloseButton.tsx — 닫기(×) 버튼 원시 컴포넌트 (P2-02)
 *
 * 원본: assets/js/design-system/primitives/close-button.js renderCloseBtn.
 *  - 출력 마크업 동치: class="ds-close-btn" type="button" data-size aria-label data-*  →  글리프 "×".
 *  - 속성 순서(원본 문자열과 동치 핵심): class → type → data-size → aria-label → data-*extra.
 *  - size 폴백: sm|md|lg 외 입력은 md(원본 동일).
 *
 * 원본 대비 변경(신규 계약):
 *  - label 은 명시 prop. 원본의 window.I18n.t('common.close') 전역 의존을 제거(컴포넌트는 무전역).
 *    호출처가 i18n 라벨을 결정해 주입한다(레이어 규칙: primitive 는 표현만, i18n 은 상위 책임).
 *  - onClick 등 상호작용 핸들러를 <button> 에 전달(원본 string 버전엔 없던 배선).
 *
 * SSoT: hex/글리프 직접 지정은 글리프 "×" 1개로 원본과 동일. 스타일은 ds-close-btn.css 토큰.
 *
 * @module design-system/primitives/CloseButton
 */
import type { ButtonHTMLAttributes } from 'react';

export type CloseBtnSize = 'sm' | 'md' | 'lg';

export interface CloseButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** 버튼 크기 (sm | md | lg). 기타 입력은 md 폴백(원본 동일). */
  size?: CloseBtnSize;
  /** aria-label 텍스트(접근성). 원본의 전역 i18n 기본값 대신 호출처가 명시 주입. */
  label: string;
  /** 추가 data-* 속성 맵(키: 접미사, 값: 속성값). 원본 dataAttrs 와 동일 위치(aria-label 뒤). */
  dataAttrs?: Record<string, string>;
}

function safeSize(size?: string): CloseBtnSize {
  return size === 'sm' || size === 'md' || size === 'lg' ? size : 'md';
}

export function CloseButton({ size, label, dataAttrs = {}, ...rest }: CloseButtonProps) {
  const dataProps: Record<string, string> = {};
  for (const [k, v] of Object.entries(dataAttrs)) {
    dataProps[`data-${k}`] = String(v);
  }
  return (
    <button
      className="ds-close-btn"
      type="button"
      data-size={safeSize(size)}
      aria-label={label}
      {...dataProps}
      {...rest}
    >
      ×
    </button>
  );
}
