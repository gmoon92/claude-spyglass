/**
 * design-system/icons/Diamond.tsx — 다이아몬드(채움) 아이콘 (D-29 옵션 B)
 *
 * 원본: assets/js/design-system/icons/diamond.js svgDiamond.
 *  - fill-only(stroke 속성 없음): 래퍼는 fill="none", path 가 fill="currentColor".
 *  - viewBox 0 0 16 16, 기본 size 10.
 *
 * @module design-system/icons/Diamond
 */
import { Svg, type IconProps } from './Svg';

export function Diamond({ size = 10, ...rest }: IconProps) {
  return (
    <Svg size={size} stroke={false} {...rest}>
      <path d="M8 1L15 8L8 15L1 8z" fill="currentColor" />
    </Svg>
  );
}
