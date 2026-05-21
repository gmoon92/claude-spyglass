/**
 * MCP tool_name 파서
 *
 * @description `mcp__<server>__<tool>` 풀네임을 server / tool 두 부분으로 분해한다.
 *  - server 자체에 `_` 가 들어갈 수는 있으나 `__` 는 분리자 전용으로 약속돼 있으므로
 *    parts[1] 만 server 로 잡고 parts.slice(2).join('__') 를 tool 로 복원한다.
 *  - 'mcp__' prefix 가 없거나 분리자가 부족하면 null 을 반환해 호출 측이 단일 단위로 처리하도록 한다.
 *
 * 호출자(현재):
 *  - routes/meta-docs.ts buildEgoFlowGraph — ego-graph mcp 컬럼 그룹핑 시 server 추출.
 *
 * 향후 통합 후보(out-of-scope, 본 PR에서는 손대지 않음):
 *  - packages/tui/src/lib/format.ts compressToolName
 *  - packages/web/assets/js/tool-colors.js
 *  - packages/web/assets/js/session-detail/turn-rows.js
 */

export type ParsedMcpToolName = {
  /** mcp 서버 식별자 (e.g. 'redmine'). */
  server: string;
  /** 서버 내부 도구 이름 (e.g. 'getIssue'). 분리자(`__`)가 더 있어도 join 으로 보존한다. */
  tool: string;
};

const PREFIX = 'mcp__';

/**
 * `mcp__<server>__<tool>` 풀네임을 분해한다.
 *
 * @example
 *   parseMcpToolName('mcp__redmine__getIssue')  // { server: 'redmine', tool: 'getIssue' }
 *   parseMcpToolName('mcp__redmine__sub__op')   // { server: 'redmine', tool: 'sub__op' }
 *   parseMcpToolName('Read')                    // null
 *   parseMcpToolName('mcp__redmine')            // null (분리자 부족)
 */
export function parseMcpToolName(name: string): ParsedMcpToolName | null {
  if (!name.startsWith(PREFIX)) return null;
  const parts = name.split('__');
  // ['mcp', '<server>', '<tool>', ...] 최소 길이 3.
  if (parts.length < 3) return null;
  const server = parts[1];
  if (!server) return null;
  const tool = parts.slice(2).join('__');
  if (!tool) return null;
  return { server, tool };
}
