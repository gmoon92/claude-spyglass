/**
 * design-system/badges/Badge.tsx — 상태 신호·이상 탐지·타입 표지 배지 (P2-03)
 *
 * 원본: assets/js/design-system/badges/badge.js renderBadge.
 *  - tone(의미)·label(텍스트)만으로 일관된 상태 배지를 렌더; 색/배경/패딩은 badge.css + 토큰이 처리.
 *  - 출력 HTML(class·data-tone·aria-label 속성/순서, icon|iconText prefix + label)을
 *    원본 문자열과 **동치**로 유지.
 *
 * SSoT 준수:
 *  - hex/글리프 직접 지정 금지. 색은 data-tone → CSS 변수. 아이콘은 호출자가 SVG 컴포넌트로 주입.
 *
 * 동치 비교 주의:
 *  - 원본 icon 은 svg* 함수가 만든 HTML 문자열(이미 안전 가정)을 그대로 보간한다.
 *    → 본 컴포넌트는 동일 SVG 를 React 노드(예: <ErrorIcon/>)로 주입받아 동일 마크업을 출력한다.
 *  - 원본 iconText 는 escHtml 로 이스케이프된다 → 본 컴포넌트는 텍스트 children 으로 전달(React 이스케이프).
 *  - icon 과 iconText 가 둘 다 있으면 icon 우선(원본 동일).
 *  - aria-label 은 ariaLabel ?? label 이 truthy 일 때만 출력(원본 동일).
 *
 * @module design-system/badges/Badge
 */
import type { ReactNode } from 'react';

/** 배지의 의미론적 색조 — 원본 tone 유니온과 동일. */
export type BadgeTone = 'error' | 'warn' | 'info' | 'success' | 'brand' | 'neutral';

/** Badge 컴포넌트 props — 원본 renderBadge opts 와 1:1. */
export interface BadgeProps {
  /** 의미론적 색조. 기본 'neutral'(원본 동일). */
  tone?: BadgeTone;
  /** 표시 텍스트. 텍스트 children 으로 전달돼 React 가 이스케이프(원본 escHtml 대응). */
  label?: string;
  /** SVG 아이콘 노드(예: <ErrorIcon/>). iconText 보다 우선(원본 동일). */
  icon?: ReactNode;
  /** 단순 글리프(↑ ↻ ◷ ✗ 등). icon 이 없을 때만 사용(원본 동일). */
  iconText?: string;
  /** aria-label. 미지정 시 label 로 자동 설정; 둘 다 falsy 면 속성 미출력(원본 동일). */
  ariaLabel?: string;
}

/**
 * 상태 배지 — 원본 renderBadge 의 속성/순서/구조를 그대로 재현.
 *
 * 속성 순서(동치 핵심): class → data-tone → aria-label?.
 * 내부 구조: `{iconFragment}{label}` (icon|iconText prefix + label).
 */
export function Badge({ tone = 'neutral', label, icon, iconText, ariaLabel }: BadgeProps) {
  const safeLabel = label ?? '';
  const safeAria = ariaLabel ?? label ?? '';
  // prefix: icon(노드) > iconText(텍스트) > 없음 (원본 우선순위 동일).
  const iconFragment: ReactNode = icon ? icon : iconText ? iconText : null;
  return (
    <span className="ds-badge" data-tone={tone} {...(safeAria ? { 'aria-label': safeAria } : {})}>
      {iconFragment}
      {safeLabel}
    </span>
  );
}
