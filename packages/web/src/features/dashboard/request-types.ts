/**
 * features/dashboard/request-types.ts — 요청 타입 상수 및 판별 함수 SSoT (P3-09)
 *
 * 원본: assets/js/request-types.js (ADR-004). Agent/Skill/MCP/Task 는 tool_name 기반 클라이언트 필터.
 *  - 순수 함수 모듈을 1:1 .ts 이식. 디자인 토큰 매핑 SSoT 는 design-tokens.css.
 *  - turn-rows.js#compressNeutralWindows(P3-05) 등이 isAnchorTool 을 소비.
 *
 * @module features/dashboard/request-types
 */

export const AGENT_TOOL_NAME = 'Agent';
export const SKILL_TOOL_NAME = 'Skill';
export const MCP_TOOL_PREFIX = 'mcp__';
export const TASK_TOOL_PREFIX = 'Task';

/** 클라이언트 전용 서브 타입 목록 — 서버 DB type 컬럼과 무관. */
export const SUB_TYPES = ['agent', 'skill', 'mcp', 'task'] as const;
export type SubType = (typeof SUB_TYPES)[number] | '';

/** 요청에서 판별에 쓰는 최소 형태. */
export interface RequestLike {
  tool_name?: string | null;
  type?: string | null;
}

/**
 * 요청의 서브 타입 — 'agent'|'skill'|'mcp'|'task'|''.
 *  Agent/Skill 정확 일치, mcp__/Task 접두사 매칭(원본 subTypeOf 동치).
 */
export function subTypeOf(r: RequestLike): SubType {
  if (r.tool_name === AGENT_TOOL_NAME) return 'agent';
  if (r.tool_name === SKILL_TOOL_NAME) return 'skill';
  if (r.tool_name?.startsWith(MCP_TOOL_PREFIX)) return 'mcp';
  if (r.tool_name?.startsWith(TASK_TOOL_PREFIX)) return 'task';
  return '';
}

/**
 * ANCHOR 판정 SSoT — flow-head 칩에서 "색상 시그널" 인가.
 *  ANCHOR = response / TaskUpdate / sub-type 있는 도구(agent/skill/mcp). 그 외 NEUTRAL.
 *  (원본 isAnchorTool 동치)
 */
export function isAnchorTool(r: RequestLike | null | undefined): boolean {
  if (!r) return false;
  if (r.type === 'response') return true;
  if (r.tool_name === 'TaskUpdate') return true;
  return subTypeOf(r) !== '';
}
