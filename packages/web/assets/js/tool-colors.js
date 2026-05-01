// CSS 변수와 동기화되는 도구 색상 토큰 (ADR-001 tool-color-tokens).
// turn 카드의 도구 chip, anomaly 마커 등에서 공유.

export const TOOL_COLORS = {
  Agent:     '#f59e0b',  // --tool-agent
  Skill:     '#f59e0b',  // --tool-agent
  Task:      '#60a5fa',  // --tool-task
  Read:      '#34d399',  // --tool-fs
  Write:     '#34d399',  // --tool-fs
  Edit:      '#34d399',  // --tool-fs
  MultiEdit: '#34d399',  // --tool-fs
  Bash:      '#fb923c',  // --tool-bash
  Grep:      '#fbbf24',  // --tool-search
  Glob:      '#fbbf24',  // --tool-search
  WebSearch: '#f472b6',  // --tool-web
  WebFetch:  '#f472b6',  // --tool-web
  default:   '#94a3b8',  // --tool-default
};

// CSS 변수 값으로 TOOL_COLORS 덮어쓰기. main.js에서 1회 호출.
export function initToolColors() {
  const s   = getComputedStyle(document.documentElement);
  const get = v => s.getPropertyValue(v).trim();
  const agent  = get('--tool-agent')   || TOOL_COLORS.Agent;
  const task   = get('--tool-task')    || TOOL_COLORS.Task;
  const fs     = get('--tool-fs')      || TOOL_COLORS.Read;
  const bash   = get('--tool-bash')    || TOOL_COLORS.Bash;
  const search = get('--tool-search')  || TOOL_COLORS.Grep;
  const web    = get('--tool-web')     || TOOL_COLORS.WebSearch;
  const def    = get('--tool-default') || TOOL_COLORS.default;
  TOOL_COLORS.Agent     = agent;
  TOOL_COLORS.Skill     = agent;
  TOOL_COLORS.Task      = task;
  TOOL_COLORS.Read      = fs;
  TOOL_COLORS.Write     = fs;
  TOOL_COLORS.Edit      = fs;
  TOOL_COLORS.MultiEdit = fs;
  TOOL_COLORS.Bash      = bash;
  TOOL_COLORS.Grep      = search;
  TOOL_COLORS.Glob      = search;
  TOOL_COLORS.WebSearch = web;
  TOOL_COLORS.WebFetch  = web;
  TOOL_COLORS.default   = def;
}

export function getToolColor(toolName) {
  if (!toolName) return TOOL_COLORS.default;
  const base = toolName.split('__').pop();
  return TOOL_COLORS[base] || TOOL_COLORS.default;
}
