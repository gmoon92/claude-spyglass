/**
 * design-system/icons/Quote.tsx — 인용 부호(따옴표) 아이콘
 *
 * 원본: assets/js/design-system/icons/quote.js svgQuote.
 *  - fill-only currentColor, viewBox 0 0 12 12, xmlns 출력, 기본 size 12.
 *  - 좌·우 채움형 미니 따옴표 한 쌍(path 2개).
 *
 * @module design-system/icons/Quote
 */
import { Svg, type IconProps } from './Svg';

export function Quote({ size = 12, ...rest }: IconProps) {
  return (
    <Svg size={size} viewBox="0 0 12 12" stroke={false} xmlns {...rest}>
      <path d="M2 3.5 H4.2 V5.7 H3.1 L2 7.5 V3.5 Z" fill="currentColor" />
      <path d="M5.8 3.5 H8 V5.7 H6.9 L5.8 7.5 V3.5 Z" fill="currentColor" />
    </Svg>
  );
}
