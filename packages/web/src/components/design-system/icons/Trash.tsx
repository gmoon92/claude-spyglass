/**
 * design-system/icons/Trash.tsx — 휴지통(삭제) 아이콘
 *
 * 원본: assets/js/design-system/icons/trash.js svgTrash.
 *  - 본체 사다리꼴 + 뚜껑 가로선 + 손잡이 + 슬릿 2개(path 4개). 기본 size 12(래퍼 default).
 *
 * @module design-system/icons/Trash
 */
import { Svg, type IconProps } from './Svg';

export function Trash(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 4.5l1 9a1.2 1.2 0 0 0 1.2 1H10.8a1.2 1.2 0 0 0 1.2-1l1-9" />
      <path d="M2 4.5h12" />
      <path d="M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5" />
      <path d="M6.5 7.5v4M9.5 7.5v4" />
    </Svg>
  );
}
