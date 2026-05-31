/**
 * design-system/icons/Check.tsx — 다중 선택 체크박스 마커 아이콘
 *
 * 원본: assets/js/design-system/icons/check.js svgCheck.
 *  - 미선택: rect rx=2 만. 선택: rect + 체크 path(M5 8.5L7.5 11L11.5 5.5).
 *  - 기본 size 12, stroke-only 래퍼.
 *
 * @module design-system/icons/Check
 */
import { Svg, type IconProps } from './Svg';

export interface CheckProps extends IconProps {
  selected?: boolean;
}

export function Check({ size = 12, selected = false, ...rest }: CheckProps) {
  return (
    <Svg size={size} {...rest}>
      <rect x="2" y="2" width="12" height="12" rx="2" />
      {selected ? <path d="M5 8.5L7.5 11L11.5 5.5" /> : null}
    </Svg>
  );
}
