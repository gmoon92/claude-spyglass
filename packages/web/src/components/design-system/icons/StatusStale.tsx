/**
 * design-system/icons/StatusStale.tsx — 세션 stale 상태 아이콘 (◐ 글리프 대체)
 *
 * 원본: assets/js/design-system/icons/status-stale.js svgStatusStale.
 *  - 외곽선 원 + 오른쪽 반원 채움(circle + path). 기본 size 12.
 *
 * @module design-system/icons/StatusStale
 */
import { Svg, type IconProps } from './Svg';

export function StatusStale({ size = 12, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth={1.5} />
      <path d="M8 3 A5 5 0 0 1 8 13 Z" fill="currentColor" stroke="none" />
    </Svg>
  );
}
