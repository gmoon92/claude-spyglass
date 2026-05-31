/**
 * design-system/icons/Chevron.tsx — 꺾쇠(방향) 아이콘 (D-04)
 *
 * 원본: assets/js/design-system/icons/chevron.js svgChevron.
 *  - viewBox 0 0 12 12, stroke-width 1.6, 기본 size 12, 기본 dir 'right'.
 *  - dir → rotate: right=0, down=90, left=180, up=270. deg!==0 일 때만 inline style 출력.
 *  - data-dir 속성 항상 출력.
 *
 * @module design-system/icons/Chevron
 */
import { Svg, type IconProps } from './Svg';

export interface ChevronProps extends IconProps {
  dir?: 'right' | 'down' | 'left' | 'up';
}

const ROTATE: Record<string, number> = { right: 0, down: 90, left: 180, up: 270 };

export function Chevron({ size = 12, dir = 'right', ...rest }: ChevronProps) {
  const deg = ROTATE[dir] ?? 0;
  return (
    <Svg
      size={size}
      viewBox="0 0 12 12"
      strokeWidth={1.6}
      dataDir={dir}
      {...(deg !== 0 ? { style: { transform: `rotate(${deg}deg)` } } : {})}
      {...rest}
    >
      <path d="M4.5 2L8.5 6L4.5 10" />
    </Svg>
  );
}
