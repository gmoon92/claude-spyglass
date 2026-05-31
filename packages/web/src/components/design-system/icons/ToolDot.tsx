/**
 * design-system/icons/ToolDot.tsx — 일반 도구 아이콘 (◉ fish-eye)
 *
 * 원본: assets/js/design-system/icons/tool-dot.js svgToolDot.
 *  - 외곽 원 r=6.5(stroke) + 안쪽 큰 점 r=3.5(fill). 기본 size 12.
 *
 * @module design-system/icons/ToolDot
 */
import { Svg, type IconProps } from './Svg';

export function ToolDot({ size = 12, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth={1.5} />
      <circle cx="8" cy="8" r="3.5" fill="currentColor" stroke="none" />
    </Svg>
  );
}
