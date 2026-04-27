/**
 * Tool 카테고리 분류 유틸리티
 *
 * @description tool_name → 카테고리(FileOps/Search/Bash/MCP/Agent/Other) 매핑.
 * Tier 3 지표 "Tool 카테고리 분포" 및 향후 카테고리 기반 필터에서 재사용.
 */

export type ToolCategory = 'FileOps' | 'Search' | 'Bash' | 'MCP' | 'Agent' | 'Other';

const FILE_OPS = new Set(['Read', 'Write', 'Edit', 'NotebookEdit', 'MultiEdit']);
const SEARCH = new Set(['Grep', 'Glob', 'WebSearch', 'WebFetch']);
const BASH = new Set(['Bash', 'BashOutput', 'KillShell', 'KillBash']);
const AGENT_NAMES = new Set([
  'Agent',
  'Task',
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TaskOutput',
  'TaskCompleted',
  'TaskCreated',
  'TaskStop',
]);

/**
 * tool_name → 카테고리 분류
 * 우선순위: MCP prefix > FileOps > Search > Bash > Agent/Task* > Other
 */
export function categorizeToolName(toolName: string | null | undefined): ToolCategory {
  if (!toolName) return 'Other';
  if (toolName.startsWith('mcp__')) return 'MCP';
  if (FILE_OPS.has(toolName)) return 'FileOps';
  if (SEARCH.has(toolName)) return 'Search';
  if (BASH.has(toolName)) return 'Bash';
  if (AGENT_NAMES.has(toolName) || toolName.startsWith('Task')) return 'Agent';
  return 'Other';
}

/** 모든 카테고리 목록(응답 0건 카테고리도 포함시킬 때 사용) */
export const ALL_TOOL_CATEGORIES: readonly ToolCategory[] = [
  'FileOps',
  'Search',
  'Bash',
  'MCP',
  'Agent',
  'Other',
] as const;
