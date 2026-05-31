/**
 * design-system/icons/Copy.tsx — 복사 아이콘 (P2-06, settings ICON_COPY 승격)
 *
 * 원본: assets/js/settings-view.js:47 ICON_COPY (Lucide-style 24×24, stroke-width 2).
 *   - 외부 도구 inline 복사 / 코드박스 우상단 복사 / 포트 변경 복사 — 3곳 동일 사용.
 *   - currentColor 라 호스트 버튼의 color 토큰 상속.
 *
 * 아키텍처 §1.1: ICON_COPY 를 design-system/icons 로 승격(P2-01 정합). 다만 본 아이콘은
 *   design-system 의 16×16 stroke-1.5 Svg 패밀리와 *기하가 다르다*(24×24 stroke-2). 원본 SVG
 *   문자열과의 DOM 동치를 위해 Svg 래퍼를 거치지 않고 원본 path/속성을 1:1 재현한다.
 *   class="settings-copy-icon" 셀렉터 계약 유지(CodeCopyBox/InlineCopyButton CSS 가 의존).
 *
 * @module design-system/icons/Copy
 */

/** Copy 아이콘 — 원본 ICON_COPY(:47) 와 DOM 동치(24×24, stroke 2, settings-copy-icon). */
export function Copy() {
  return (
    <svg
      className="settings-copy-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
