/**
 * design-system/icons/StatusEnded.tsx — 세션 정상 종료 상태 아이콘 (○ 글리프 대체)
 *
 * 원본: assets/js/design-system/icons/status-ended.js svgStatusEnded.
 *  - 외곽선 원 circle r=5 fill=none stroke=currentColor. 기본 size 12.
 *
 * @module design-system/icons/StatusEnded
 */
import { Svg, type IconProps } from './Svg';

export function StatusEnded({ size = 12, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth={1.5} />
    </Svg>
  );
}
