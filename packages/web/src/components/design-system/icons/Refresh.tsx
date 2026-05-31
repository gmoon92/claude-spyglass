/**
 * design-system/icons/Refresh.tsx — 동기화(↻) 아이콘
 *
 * 원본: assets/js/design-system/icons/refresh.js svgRefresh.
 *  - 두 반호(arc) + 양 끝 화살표 head path 4개. 기본 size 12(래퍼 default 계승).
 *  - is-loading 클래스에서 CSS spin.
 *
 * @module design-system/icons/Refresh
 */
import { Svg, type IconProps } from './Svg';

export function Refresh(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9" />
      <path d="M13.5 8a5.5 5.5 0 0 1-9.4 3.9" />
      <path d="M9.5 4.5h2.5V2" />
      <path d="M6.5 11.5H4V14" />
    </Svg>
  );
}
