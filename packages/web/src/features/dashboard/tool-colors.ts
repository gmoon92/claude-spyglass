/**
 * features/dashboard/tool-colors.ts — 도구 색상 토큰 (P3-09)
 *
 * 원본: assets/js/tool-colors.js (ADR-001 tool-color-tokens). turn 칩/anomaly 마커 공유.
 *  - getToolColor: 순수(접두사 mcp__ 제거 후 룩업, 미존재 → default).
 *  - readToolColorsFromCss(원본 initToolColors): getComputedStyle(document)로 CSS 변수를 읽어
 *    TOOL_COLORS 를 덮어쓴다 — DOM 의존부는 호출처(부팅 시 1회)가 document 를 주입.
 *
 * 신규 계약: 원본은 모듈 전역 TOOL_COLORS 를 mutate 했으나, 본 모듈은 기본 테이블을 export 하고
 *  CSS override 는 새 ToolColorTable 을 반환하는 순수 변환으로 분리(전역 mutate 폐기, 테스트 결정론).
 *
 * @module features/dashboard/tool-colors
 */

export interface ToolColorTable {
  Agent: string;
  Skill: string;
  Task: string;
  Read: string;
  Write: string;
  Edit: string;
  MultiEdit: string;
  Bash: string;
  Grep: string;
  Glob: string;
  WebSearch: string;
  WebFetch: string;
  default: string;
  [k: string]: string;
}

/** CSS 변수와 동기화되는 기본 색상(원본 TOOL_COLORS 동일 값). */
export const TOOL_COLORS: ToolColorTable = {
  Agent: '#f59e0b',
  Skill: '#f59e0b',
  Task: '#60a5fa',
  Read: '#34d399',
  Write: '#34d399',
  Edit: '#34d399',
  MultiEdit: '#34d399',
  Bash: '#fb923c',
  Grep: '#fbbf24',
  Glob: '#fbbf24',
  WebSearch: '#f472b6',
  WebFetch: '#f472b6',
  default: '#94a3b8',
};

/**
 * 도구명 → 색상. mcp__ 등 접두사는 마지막 세그먼트로 룩업, 미존재 → default.
 * (원본 getToolColor 동치 — 순수, table 주입으로 테스트 결정론)
 */
export function getToolColor(toolName: string | null | undefined, table: ToolColorTable = TOOL_COLORS): string {
  if (!toolName) return table.default;
  const base = toolName.split('__').pop() as string;
  return table[base] || table.default;
}

/**
 * CSS 변수(--tool-*)로 색상 테이블 override — 원본 initToolColors 의 순수 변환 버전.
 *  - getVar: CSS 변수 1개를 읽는 함수(호출처가 getComputedStyle(documentElement) 로 주입).
 *  - 빈 값이면 기본값 유지(원본 `|| TOOL_COLORS.X` 폴백).
 * @returns 새 테이블(전역 mutate 폐기 — base 불변).
 */
export function readToolColorsFromCss(
  getVar: (name: string) => string,
  base: ToolColorTable = TOOL_COLORS,
): ToolColorTable {
  const v = (name: string, fallback: string) => getVar(name).trim() || fallback;
  const agent = v('--tool-agent', base.Agent);
  const task = v('--tool-task', base.Task);
  const fs = v('--tool-fs', base.Read);
  const bash = v('--tool-bash', base.Bash);
  const search = v('--tool-search', base.Grep);
  const web = v('--tool-web', base.WebSearch);
  const def = v('--tool-default', base.default);
  return {
    ...base,
    Agent: agent,
    Skill: agent,
    Task: task,
    Read: fs,
    Write: fs,
    Edit: fs,
    MultiEdit: fs,
    Bash: bash,
    Grep: search,
    Glob: search,
    WebSearch: web,
    WebFetch: web,
    default: def,
  };
}
