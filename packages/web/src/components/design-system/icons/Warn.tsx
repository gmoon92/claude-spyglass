/**
 * design-system/icons/Warn.tsx — 경고(삼각형+느낌표) 아이콘
 *
 * 원본: assets/js/design-system/icons/warn.js svgWarn.
 *  - 삼각형 + 느낌표 막대 + 점(path 3개). 기본 size 12(래퍼 default).
 *
 * @module design-system/icons/Warn
 */
import { Svg, type IconProps } from './Svg';

export function Warn(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 2.5L14.5 13.5H1.5L8 2.5Z" />
      <path d="M8 7v3.2" />
      <path d="M8 12.2v0.01" />
    </Svg>
  );
}
