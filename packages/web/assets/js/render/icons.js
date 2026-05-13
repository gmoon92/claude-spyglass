/**
 * icons.js — 인라인 SVG 아이콘 카탈로그 (meta-docs feedback ADR)
 *
 * 책임:
 *  - 메타 모드에서 새로 정의된 휴지통/경고/동기화 아이콘을 단일 모듈에서 관리.
 *  - 기존 SVG 표준(viewBox 0 0 16 16, stroke-only, stroke-width 1.5, round cap/join,
 *    currentColor)을 일관되게 따르도록 함수형 helper로 노출.
 *
 * 디자인 결정:
 *  - 색상은 모두 currentColor — 호출 측 CSS(`color:`)가 톤을 결정.
 *  - 사이즈 기본 12 — 메타 필터 바와 thead 셀의 텍스트 크기에 맞춰 광학적으로 정렬.
 *  - 호출 측이 inline-flex로 텍스트와 정렬하는 패턴을 가정하여 vertical-align는 CSS에서 통제.
 *
 * 사용자 피드백(2026-05-14): 우측 패널 '🗑 삭제된 정의도 표시' emoji + 카드의 ⚠ emoji가
 * 너무 emoji스러워 디자인 톤을 깬다 — 프로젝트 SVG 가이드(stroke-only)로 통일.
 */

/**
 * 공통 SVG 래퍼 — viewBox/stroke 속성을 한 곳에서 관리.
 * 호출 측은 path 마크업과 옵션 클래스만 전달.
 * @param {string} paths - <path .../> 등 내부 마크업
 * @param {{size?: number, className?: string, ariaLabel?: string}} [opts]
 */
function wrapSvg(paths, opts = {}) {
  const { size = 12, className = '', ariaLabel = null } = opts;
  const cls = className ? ` class="${className}"` : '';
  const aria = ariaLabel
    ? ` role="img" aria-label="${ariaLabel}"`
    : ' aria-hidden="true"';
  return `<svg${cls}${aria} viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

/**
 * 휴지통(삭제) 아이콘 — '삭제된 정의 포함' 토글에서 사용.
 *  - 본체 사다리꼴(d.path1) + 뚜껑 가로선(d.path2) + 손잡이(d.path3) + 슬릿 2개(d.path4).
 *  - 사용자 피드백: 단순 emoji는 톤이 떠보이므로 line-icon 패밀리에 합류시킨다.
 */
export function svgTrash(opts) {
  const paths =
    '<path d="M3 4.5l1 9a1.2 1.2 0 0 0 1.2 1H10.8a1.2 1.2 0 0 0 1.2-1l1-9"/>' +
    '<path d="M2 4.5h12"/>' +
    '<path d="M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5"/>' +
    '<path d="M6.5 7.5v4M9.5 7.5v4"/>';
  return wrapSvg(paths, opts);
}

/**
 * 경고(soft-deleted) 아이콘 — 메타 카드의 deleted_at != null 표시.
 *  - 삼각형(d.path1) + 느낌표 막대(d.path2) + 점(d.path3).
 *  - 기존 ⚠ emoji 대비 stroke-only로 가벼움, `color: var(--warn)` 적용 가정.
 */
export function svgWarn(opts) {
  const paths =
    '<path d="M8 2.5L14.5 13.5H1.5L8 2.5Z"/>' +
    '<path d="M8 7v3.2"/>' +
    '<path d="M8 12.2v0.01"/>';
  return wrapSvg(paths, opts);
}

/**
 * 동기화(refresh) 아이콘 — 좌측 thead의 [동기화] 셀에서 사용.
 *  - 두 개의 반호(arc) + 양 끝 화살표 head로 회전 의미를 명확히.
 *  - is-loading 클래스에서 CSS animation으로 spin 회전. 회전축이 어긋나지 않도록
 *    viewBox 중심(8,8)을 기준으로 좌우 대칭 곡선 사용.
 *  - 기존 CSS 원(border 1.5) 방식 대비 의미 전달(↻)이 직관적.
 */
export function svgRefresh(opts) {
  const paths =
    '<path d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9"/>' +
    '<path d="M13.5 8a5.5 5.5 0 0 1-9.4 3.9"/>' +
    '<path d="M9.5 4.5h2.5V2"/>' +
    '<path d="M6.5 11.5H4V14"/>';
  return wrapSvg(paths, opts);
}
