/**
 * tool-icon.ts — Single source of truth for tool icon resolution.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/skills/ui-designer/references/tui/tool-icons.md §3
 *
 * RULE: callers pass raw record; this function decides glyph + spinner + color.
 *       Callers MUST NOT compute booleans like `event_type === 'pre_tool'` themselves.
 */

import { tokens } from '../design-tokens';
import type { Request } from '../types';

export type ToolIconResolution = {
  glyph: string;
  spinning: boolean;
  color: string;
  label: string;
};

const FILE_OPS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Delete']);
const SEARCH_OPS = new Set(['Grep', 'Glob', 'WebSearch', 'WebFetch']);
const BASH_OPS = new Set(['Bash', 'KillShell', 'BashOutput']);

export function categorize(toolName?: string | null): string {
  if (!toolName) return 'other';
  if (toolName === 'Agent' || toolName === 'Task') return 'agent';
  if (toolName.startsWith('mcp__')) return 'mcp';
  if (FILE_OPS.has(toolName)) return 'fileops';
  if (SEARCH_OPS.has(toolName)) return 'search';
  if (BASH_OPS.has(toolName)) return 'bash';
  return 'other';
}

function fileOpGlyph(name: string): string {
  switch (name) {
    case 'Read':
      return tokens.icon.file.read;
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return tokens.icon.file.edit;
    case 'Write':
      return tokens.icon.file.write;
    case 'Delete':
      return tokens.icon.file.delete;
    default:
      return tokens.icon.file.read;
  }
}

function searchGlyph(name: string): string {
  if (name === 'WebSearch' || name === 'WebFetch') return tokens.icon.search.web;
  return tokens.icon.search.grep;
}

function bashGlyph(name: string): string {
  if (name === 'KillShell') return tokens.icon.bash.kill;
  return tokens.icon.bash.exec;
}

/**
 * Resolve glyph/spinner/color for a single record.
 * Centralizes pre_tool / error / category logic.
 */
export function toolIconForRecord(record: Pick<Request, 'tool_name' | 'event_type' | 'tool_detail' | 'status'>): ToolIconResolution {
  const { tool_name, event_type, tool_detail, status } = record;

  // Agent is shown from pre-stage (server includes it).
  const isPreTool = event_type === 'pre_tool';

  // Error first.
  const isError =
    status === 'error' ||
    (tool_detail != null && /error|failed|exit\s*[1-9]/i.test(tool_detail));

  if (isError && !isPreTool) {
    return {
      glyph: tokens.icon.state.err,
      spinning: false,
      color: tokens.color.danger.fg,
      label: tool_name ?? '',
    };
  }

  if (isPreTool) {
    // Spinner glyph; rotation handled by Spinner component.
    return {
      glyph: tokens.motion.spinner.tool.frames[0]!,
      spinning: true,
      color: tokens.color.info.fg,
      label: tool_name ?? '',
    };
  }

  const cat = categorize(tool_name);
  switch (cat) {
    case 'agent':
      return {
        glyph: tokens.icon.agent.d0,
        spinning: false,
        color: tokens.color.accent.fg,
        label: tool_name ?? 'Agent',
      };
    case 'mcp':
      return {
        glyph: tokens.icon.mcp.default,
        spinning: false,
        color: tokens.color.accent.fg,
        label: tool_name ?? '',
      };
    case 'fileops':
      return {
        glyph: fileOpGlyph(tool_name!),
        spinning: false,
        color: tokens.color.success.fg,
        label: tool_name ?? '',
      };
    case 'search':
      return {
        glyph: searchGlyph(tool_name!),
        spinning: false,
        color: tokens.color.info.fg,
        label: tool_name ?? '',
      };
    case 'bash':
      return {
        glyph: bashGlyph(tool_name!),
        spinning: false,
        color: tokens.color.warning.fg,
        label: tool_name ?? '',
      };
    default:
      return {
        glyph: tokens.icon.other,
        spinning: false,
        color: tokens.color.muted.fg,
        label: tool_name ?? '',
      };
  }
}
