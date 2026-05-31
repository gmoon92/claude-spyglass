/**
 * design-system/icons/SkillDot.tsx — Skill sub-type 전용 fish-eye 아이콘
 *
 * 원본: assets/js/design-system/icons/skill-dot.js svgSkillDot.
 *  - 외곽 원 r=6.5(stroke) + 안쪽 점 r=3.5(fill). tool-dot 과 동일 글리프, 용도/색 분리.
 *  - 기본 size 12.
 *
 * @module design-system/icons/SkillDot
 */
import { Svg, type IconProps } from './Svg';

export function SkillDot({ size = 12, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth={1.5} />
      <circle cx="8" cy="8" r="3.5" fill="currentColor" stroke="none" />
    </Svg>
  );
}
