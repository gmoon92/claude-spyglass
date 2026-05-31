/**
 * design-system/icons/skill-dot.js — Skill sub-type 전용 fish-eye 아이콘.
 *
 * 책임:
 *  - turn-spine chip-flow에서 `subType === 'skill'` 칩에 부착되는 SVG 아이콘을
 *    단일 모듈로 노출 (SSoT).
 *  - Agent(◎ bullseye, [[design-system/icons/agent-dot]])와 시각적으로
 *    명확히 구분되도록 fish-eye 패턴(외곽 링 + 채워진 내부 점)을 사용한다.
 *  - viewBox 0 0 16 16, currentColor 토큰 기반(하드코딩된 hex 금지).
 *
 * 디자인 의도 (왜 fish-eye인가):
 *  - bullseye(stroke-only 이중 원)는 "위임/대리(proxy)" 뉘앙스 — Agent에 배정.
 *  - fish-eye(외곽 링 + 채워진 점)는 "사용자 의도가 응축된 단일 호출" 뉘앙스 — Skill에 배정.
 *  - 일반 도구(svgToolDot, Bash/Read/Edit 등)도 fish-eye를 쓰지만 turn-spine 칩에서는
 *    아이콘 자체를 부착하지 않기에 시각 충돌이 없다 — Skill만 turn-spine에서 fish-eye를 노출.
 *  - 색상 토큰 `--sub-type-skill-color` (#FACC15, design-tokens.css:163)로 Agent(#FF9B6E)와
 *    한 번 더 분리. 글리프 + 색의 이중 신호.
 *
 * 흡수:
 *  - session-detail/turn-views.js#chipHtml — sub === 'skill' 분기 신설(2026-05-22).
 *    이전엔 default 분기에서 텍스트만 노출했으나, 사용자 요구에 따라
 *    Agent와 동일하게 아이콘 + 이름 패턴으로 통일.
 *
 * 의존:
 *  - currentColor 토큰 (호출 컨텍스트의 color 속성이 자동 상속됨)
 *  - stroke-only currentColor 패밀리 일관성 (단, 내부 점은 fill — tool-dot.js와 동일 룰)
 *
 * 디자인 패밀리:
 *  - 외곽 원 stroke + 안쪽 큰 점 fill (fish-eye).
 *  - 기본 size 12 — Agent/도구 칩 아이콘과 광학 정렬.
 *
 * 관련 모듈:
 *  - [[agent-dot]]  Agent용 bullseye 아이콘 (시각 구분 짝)
 *  - [[tool-dot]]   일반 도구용 fish-eye 아이콘 (같은 패턴, 다른 용도)
 *  - [[_index]]     barrel export 진입점
 *
 * @module design-system/icons/skill-dot
 */

/**
 * 공통 SVG 래퍼 — viewBox/stroke 속성을 한 곳에서 관리.
 * agent-dot.js / tool-dot.js와 동일 시그니처(복제 허용 — 도메인 묶음 내 일관성 우선).
 *
 * @param {string} paths - 내부 마크업 (`<circle .../>` 등)
 * @param {{size?: number, className?: string, ariaLabel?: string}} [opts]
 * @returns {string} 완성된 SVG 문자열
 */
function wrapSvg(paths: string, opts: { size?: number; className?: string; ariaLabel?: string | null } = {}) {
  const { size = 12, className = '', ariaLabel = null } = opts;
  const cls  = className ? ` class="${className}"` : '';
  const aria = ariaLabel
    ? ` role="img" aria-label="${ariaLabel}"`
    : ' aria-hidden="true"';
  return `<svg${cls}${aria} viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

/**
 * Skill sub-type 전용 아이콘 — fish-eye (외곽 링 + 채워진 내부 점).
 *  - 바깥 원 stroke r=6.5, 안쪽 원 fill r=3.5.
 *  - tool-dot.js와 동일 글리프지만 호출 컨텍스트가 다름:
 *    이 아이콘은 turn-spine chip-flow의 Skill 칩에만 prepend된다.
 *  - 기본 size 12 — Agent/도구 칩 아이콘과 광학 정렬.
 *
 * @param {{size?: number, className?: string, ariaLabel?: string}} [opts]
 * @returns {string} SVG HTML 문자열
 */
export function svgSkillDot(opts: { size?: number; className?: string; ariaLabel?: string | null } = {}) {
  const { size = 12, ...rest } = opts;
  const paths =
    '<circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<circle cx="8" cy="8" r="3.5" fill="currentColor" stroke="none"/>';
  return wrapSvg(paths, { size, ...rest });
}
