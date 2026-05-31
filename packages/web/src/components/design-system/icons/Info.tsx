/**
 * design-system/icons/Info.tsx — 정보(원+i) 아이콘 (D-11)
 *
 * 원본: assets/js/design-system/icons/info.js svgInfo.
 *  - circle r=6.5 + 세로획 line(8,5→8,9) + 점 circle(cx=8 cy=11.5 r=0.6 fill currentColor stroke none).
 *  - 기본 size 14, stroke-only 래퍼.
 *
 * @module design-system/icons/Info
 */
import { Svg, type IconProps } from './Svg';

export function Info({ size = 14, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <circle cx="8" cy="8" r="6.5" />
      <line x1="8" y1="5" x2="8" y2="9" />
      <circle cx="8" cy="11.5" r="0.6" fill="currentColor" stroke="none" />
    </Svg>
  );
}
