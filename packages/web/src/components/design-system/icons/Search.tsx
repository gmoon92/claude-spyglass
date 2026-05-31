/**
 * design-system/icons/Search.tsx — 검색(돋보기) 아이콘 (D-03)
 *
 * 원본: assets/js/design-system/icons/search.js svgSearch.
 *  - circle r=4.5 + 손잡이 line. 기본 size 14.
 *
 * @module design-system/icons/Search
 */
import { Svg, type IconProps } from './Svg';

export function Search({ size = 14, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <circle cx="7" cy="7" r="4.5" />
      <line x1="10.5" y1="10.5" x2="14" y2="14" />
    </Svg>
  );
}
