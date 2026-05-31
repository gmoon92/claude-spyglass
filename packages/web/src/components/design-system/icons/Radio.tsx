/**
 * design-system/icons/Radio.tsx — 단일 선택 라디오 마커 아이콘
 *
 * 원본: assets/js/design-system/icons/radio.js svgRadio.
 *  - 미선택: 외곽 원 r=6.5. 선택: + 안쪽 채움 원 r=3.
 *  - 기본 size 12. 래퍼는 stroke-width 까지만(cap/join 없음 — 원본 wrapSvg 와 다름).
 *
 * @module design-system/icons/Radio
 */
import { Svg, type IconProps } from './Svg';

export interface RadioProps extends IconProps {
  selected?: boolean;
}

export function Radio({ size = 12, selected = false, ...rest }: RadioProps) {
  return (
    <Svg size={size} strokeCaps={false} {...rest}>
      <circle cx="8" cy="8" r="6.5" />
      {selected ? <circle cx="8" cy="8" r="3" fill="currentColor" stroke="none" /> : null}
    </Svg>
  );
}
