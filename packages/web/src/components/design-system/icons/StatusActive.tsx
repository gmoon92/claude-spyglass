/**
 * design-system/icons/StatusActive.tsx — 세션 라이브 상태 아이콘 (● 글리프 대체)
 *
 * 원본: assets/js/design-system/icons/status-active.js svgStatusActive.
 *  - 채워진 원 circle r=5 fill=currentColor. 기본 size 12. stroke 패밀리 래퍼.
 *
 * @module design-system/icons/StatusActive
 */
import { Svg, type IconProps } from './Svg';

export function StatusActive({ size = 12, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <circle cx="8" cy="8" r="5" fill="currentColor" />
    </Svg>
  );
}
