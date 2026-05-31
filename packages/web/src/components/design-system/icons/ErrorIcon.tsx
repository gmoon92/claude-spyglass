/**
 * design-system/icons/ErrorIcon.tsx — 오류(원+X) 아이콘 (D-11)
 *
 * 원본: assets/js/design-system/icons/error.js svgError.
 *  - circle r=6.5 + X 대각선 2줄. 기본 size 14.
 *  - 컴포넌트명은 `Error`(전역 Error 생성자 충돌)를 피해 `ErrorIcon` 으로 명명.
 *
 * @module design-system/icons/ErrorIcon
 */
import { Svg, type IconProps } from './Svg';

export function ErrorIcon({ size = 14, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <circle cx="8" cy="8" r="6.5" />
      <line x1="5.5" y1="5.5" x2="10.5" y2="10.5" />
      <line x1="10.5" y1="5.5" x2="5.5" y2="10.5" />
    </Svg>
  );
}
