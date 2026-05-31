/**
 * design-system/icons/AgentDot.tsx — Agent/Task 도구 아이콘 (◎ bullseye)
 *
 * 원본: assets/js/design-system/icons/agent-dot.js svgAgentDot.
 *  - 이중 원(stroke-only): 바깥 r=6.5 + 안쪽 r=3, 기본 size 12.
 *  - 동심원 = "위임/대리(proxy)" — Skill(fish-eye)과 의도적 분리.
 * SSoT: currentColor 상속, hex 하드코딩 금지.
 *
 * @module design-system/icons/AgentDot
 */
import { Svg, type IconProps } from './Svg';

export function AgentDot({ size = 12, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth={1.5} />
      <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth={1.5} />
    </Svg>
  );
}
