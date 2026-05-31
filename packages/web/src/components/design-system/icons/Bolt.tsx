/**
 * design-system/icons/Bolt.tsx — 번개(bolt) 아이콘
 *
 * 원본: assets/js/design-system/icons/bolt.js svgBolt.
 *  - 번개 단일 path, 기본 size 14, stroke-only currentColor.
 *
 * @module design-system/icons/Bolt
 */
import { Svg, type IconProps } from './Svg';

export function Bolt({ size = 14, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <path d="M9.5 1.5L3 9h4.5L6.5 14.5L13 7H8.5L9.5 1.5z" />
    </Svg>
  );
}
