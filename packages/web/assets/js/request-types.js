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

/**
 * ANCHOR 판정 SSoT — 요청이 flow-head 칩에서 "색상 시그널" 인가.
 *
 * 디자인 어휘:
 *   - ANCHOR  = response(◆), TaskUpdate 이벤트, sub-type 있는 도구(agent/skill/mcp).
 *               flow-head 에서 의미 있는 흐름의 분기점이 되는 칩.
 *   - NEUTRAL = 그 외 일반 도구(Bash/Read/Write/Edit/Glob/Grep/...).
 *               turn-rows.js#compressNeutralWindows 가 ANCHOR 사이의 연속 NEUTRAL 을
 *               하나의 무채색 묶음 칩으로 축약한다.
 *
 * 호출자:
 *   - turn-rows.js#compressNeutralWindows  (윈도우 경계 판정 SSoT)
 *
 * 주의:
 *   - 비-tool 요청(response/prompt 등)은 flow 항목에서 별도 kind 로 들어오므로
 *     이 함수에 전달될 일이 거의 없다. 안전망 차원에서 type 분기를 함께 둔다.
 *
 * @param {object} r NormalizedRequest
 * @returns {boolean}
 */
export function isAnchorTool(r) {
  if (!r) return false;
  if (r.type === 'response') return true;
  if (r.tool_name === 'TaskUpdate') return true;
  return subTypeOf(r) !== '';
}
