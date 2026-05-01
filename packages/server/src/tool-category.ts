/**
 * Tool 카테고리 분류 유틸리티
 *
 * @description tool_name → 카테고리(Agent/Skill/MCP/Native) 매핑.
 * ADR-WDO-011: 6개 → 4개 압축 (FileOps/Search/Bash/Other → Native 통합).
 * Tier 3 지표 "Tool 카테고리 분포" 및 향후 카테고리 기반 필터에서 재사용.
 */

export type ToolCategory = 'Agent' | 'Skill' | 'MCP' | 'Native';

const AGENT_TOOLS = new Set([
  'Agent',
  'Task',
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TaskGet',
  'TaskOutput',
  'TaskStop',
]);

/**
 * tool_name → 카테고리 분류
 * 우선순위: MCP prefix > Agent/Task* > Skill > Native
 */
export function categorizeToolName(toolName: string | null | undefined): ToolCategory {
  if (!toolName) return 'Native';
  if (toolName.startsWith('mcp__')) return 'MCP';
  if (AGENT_TOOLS.has(toolName)) return 'Agent';
  if (toolName === 'Skill') return 'Skill';
  // 그 외 모두 Native (Read, Write, Edit, Bash, Grep, Glob, WebSearch, WebFetch 등)
  return 'Native';
}

/** 모든 카테고리 목록(응답 0건 카테고리도 포함시킬 때 사용) */
export const ALL_TOOL_CATEGORIES: readonly ToolCategory[] = [
  'Agent',
  'Skill',
  'MCP',
  'Native',
] as const;
