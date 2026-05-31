/**
 * design-system/icons/mcp-dot.js — MCP sub-type 전용 plug/socket 아이콘.
 *
 * 책임:
 *  - turn-spine chip-flow에서 `subType === 'mcp'` 칩에 부착되는 SVG 아이콘 SSoT.
 *  - Agent(◎ bullseye) / Skill(● fish-eye)과 시각적으로 명확히 분리되도록
 *    "외부 서버 접속(plug/socket)" 뉘앙스를 사방 점 4개 + 중앙 원으로 표현한다.
 *  - viewBox 0 0 16 16, currentColor 토큰 기반(하드코딩된 hex 금지).
 *
 * 디자인 의도 (왜 plug/socket인가):
 *  - bullseye(stroke-only 이중 원, agent-dot) = "위임/대리(proxy)" 뉘앙스 — Agent.
 *  - fish-eye(외곽 링 + 채워진 점, skill-dot) = "사용자 의도가 응축된 단일 호출" — Skill.
 *  - plug/socket(사방 점 + 중앙 원) = "외부 시스템과의 접속 포인트" — MCP.
 *  - 색상 토큰 `--sub-type-mcp-color` (#22D3EE cyan)와 글리프의 이중 신호로
 *    Agent(살구) / Skill(황금)과 한 번 더 분리.
 *
 * 흡수:
 *  - render/badges.js#toolIconHtml — `startsWith('mcp__')` 분기에서 호출.
 *  - session-detail/turn-views.js#chipHtml — sub === 'mcp' 분기에서 아이콘 + 짧은 이름 패턴.
 *
 * 의존:
 *  - currentColor 토큰 (호출 컨텍스트의 color 속성이 자동 상속됨)
 *  - stroke + fill 혼용 (외곽 점은 fill, 중앙 원은 stroke — Skill·Agent 패밀리와 룰 일관)
 *
 * 디자인 패밀리:
 *  - 외곽 4꼭짓점 점(fill r=1.2) + 중앙 원(stroke r=2.5) — plug/socket 패턴.
 *  - 기본 size 12 — Agent/Skill/도구 칩 아이콘과 광학 정렬.
 *
 * 관련 모듈:
 *  - [[agent-dot]]  Agent용 bullseye 아이콘 (시각 구분 짝)
 *  - [[skill-dot]]  Skill용 fish-eye 아이콘 (시각 구분 짝)
 *  - [[tool-dot]]   일반 도구용 fish-eye 아이콘
 *
 * @module design-system/icons/mcp-dot
 */

/**
 * 공통 SVG 래퍼 — viewBox/stroke 속성을 한 곳에서 관리.
 * agent-dot.js / skill-dot.js / tool-dot.js와 동일 시그니처(복제 허용 — 도메인 묶음 내 일관성 우선).
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
 * MCP sub-type 전용 아이콘 — plug/socket (사방 점 4개 + 중앙 원).
 *  - 외곽 점 4개: (4,4) (12,4) (4,12) (12,12) r=1.2 fill.
 *  - 중앙 원: (8,8) r=2.5 stroke-only.
 *  - 기본 size 12 — Agent/Skill 칩 아이콘과 광학 정렬.
 *
 * @param {{size?: number, className?: string, ariaLabel?: string}} [opts]
 * @returns {string} SVG HTML 문자열
 */
export function svgMcpDot(opts: { size?: number; className?: string; ariaLabel?: string | null } = {}) {
  const { size = 12, ...rest } = opts;
  const paths =
    '<circle cx="4"  cy="4"  r="1.2" fill="currentColor" stroke="none"/>' +
    '<circle cx="12" cy="4"  r="1.2" fill="currentColor" stroke="none"/>' +
    '<circle cx="4"  cy="12" r="1.2" fill="currentColor" stroke="none"/>' +
    '<circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>' +
    '<circle cx="8"  cy="8"  r="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/>';
  return wrapSvg(paths, { size, ...rest });
}
