// request-types.js — 요청 타입 상수 및 판별 함수 SSoT (ADR-004)
// Agent/Skill/MCP는 tool_name 기반 클라이언트 필터 전용

export const AGENT_TOOL_NAME = 'Agent';
export const SKILL_TOOL_NAME = 'Skill';
export const MCP_TOOL_PREFIX = 'mcp__';

/** 클라이언트 전용 서브 타입 목록 — 서버 DB의 type 컬럼과 무관 */
export const SUB_TYPES = ['agent', 'skill', 'mcp'];

/**
 * 요청의 서브 타입을 반환 — 'agent' | 'skill' | 'mcp' | ''
 * renderers.js의 data-sub-type 속성 값과 동일하게 사용됨
 */
export function subTypeOf(r) {
  if (r.tool_name === AGENT_TOOL_NAME) return 'agent';
  if (r.tool_name === SKILL_TOOL_NAME) return 'skill';
  if (r.tool_name?.startsWith(MCP_TOOL_PREFIX)) return 'mcp';
  return '';
}
