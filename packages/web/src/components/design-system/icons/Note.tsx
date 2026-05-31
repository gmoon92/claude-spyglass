/**
 * design-system/icons/Note.tsx — 메모(노트 페이지) 아이콘
 *
 * 원본: assets/js/design-system/icons/note.js svgNote.
 *  - viewBox 0 0 12 12, xmlns 출력, 기본 size 12.
 *  - className 미지정 시 default "turn-system-reminder-icon"(원본 동일).
 *  - 속성 순서가 공통 래퍼와 달라(class aria width height viewBox fill xmlns) 전용 마크업 사용.
 *  - 메모 페이지 외곽선 + dog-ear 접힘선 + 본문 라인 2줄(path 3개).
 *
 * @module design-system/icons/Note
 */
import type { IconProps } from './Svg';

export function Note({ size = 12, className, ariaLabel }: IconProps) {
  const ariaProps = ariaLabel
    ? { role: 'img' as const, 'aria-label': ariaLabel }
    : { 'aria-hidden': true as const };
  return (
    <svg
      className={className ?? 'turn-system-reminder-icon'}
      {...ariaProps}
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M2.25 1.75 H7.5 L9.75 4 V10.25 H2.25 Z"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 1.75 V4 H9.75"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M4 6.25 H7.75 M4 8.25 H6.5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}
