/**
 * design-system/icons/note.js — 메모(노트 페이지) 아이콘
 *
 * 책임:
 *  - system-reminder 칩의 아이콘으로 사용되는 메모 페이지 SVG를 단독 모듈로 노출.
 *  - turn-views.js의 SYSTEM_REMINDER_ICON_SVG 인라인 상수를 함수형 헬퍼로 추출.
 *  - viewBox 0 0 12 12, stroke-only, currentColor, stroke-width 1.5, round cap/join.
 *
 * 사용처:
 *  - session-detail/turn-views.js (buildSystemReminderChip 내 시스템 리마인더 칩 아이콘)
 *
 * 디자인 패밀리:
 *  - stroke-only currentColor — 칩 색상을 CSS `color:` 가 결정.
 *  - 메모 페이지 + dog-ear(접힌 모서리) + 본문 라인 2줄 구성.
 *  - 기본 size 12 — 시스템 리마인더 칩 텍스트와 광학 정렬.
 *
 * @module design-system/icons/note
 */

/**
 * 메모(노트 페이지) 아이콘 — system-reminder 칩에서 사용.
 *  - 메모 페이지 외곽선(path1, dog-ear 포함) + dog-ear 접힘선(path2) + 본문 라인 2줄(path3).
 *  - currentColor로 칩 색상 자동 추종.
 * @param {{size?: number, className?: string, ariaLabel?: string}} [opts]
 */
export function svgNote({ size = 12, className, ariaLabel } = {}) {
  const cls = className ? ` class="${className}"` : ' class="turn-system-reminder-icon"';
  const aria = ariaLabel
    ? ` role="img" aria-label="${ariaLabel}"`
    : ' aria-hidden="true"';
  return `<svg${cls}${aria} width="${size}" height="${size}" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M2.25 1.75 H7.5 L9.75 4 V10.25 H2.25 Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M7.5 1.75 V4 H9.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M4 6.25 H7.75 M4 8.25 H6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;
}
