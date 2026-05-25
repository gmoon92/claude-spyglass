/**
 * set-a-refactor.ts — 세트 A 시드 (06 보고서 §4.2 그대로)
 *
 * 책임:
 *   `/refactor` 슬래시 커맨드 1회 호출 시나리오. 10개 메타 문서 + 11개 ToolCall.
 *   기본 알고리즘 무결성 검증 — V-1~V-5 의 기대 결과가 06 §4.3 표와 정확히 일치
 *   해야 한다.
 *
 * 호출 트리 (depth 2, 분기 3):
 *   /refactor (command, center)
 *   ├─ Skill:source-comments
 *   │   └─ Skill:avoid-spaghetti
 *   ├─ Agent:code-reviewer
 *   │   ├─ Skill:lint-fix
 *   │   └─ MCP:linear/issue
 *   └─ Skill:commit
 *       ├─ Skill:git:diff
 *       └─ Skill:git:format-message
 *   + turn-after: Skill:changelog-update
 *
 * ID 공간:
 *   MetaDocument.id = 1001..1010
 *   ToolCall.tool_use_id = 'tu-CENTER', 'tu-S1', 'tu-A1', 'tu-S2'~'tu-S6', 'tu-M1', 'tu-S10'
 *   Session = 'sess-mock-A-1', Turn = 'sess-mock-A-1-T7', Agent = 'main', 'agent-A-cr-1'
 *
 * 타임라인 (T0 = 1716620100000):
 *   tu-CENTER 호출 @ T0
 *   tu-S1     @ T0+200  (Skill:source-comments)
 *   tu-A1     @ T0+400  (Agent:code-reviewer)
 *   tu-S2     @ T0+500  (Skill:avoid-spaghetti — S1 의 자식)
 *   tu-S3     @ T0+1000 (Skill:lint-fix — A1 의 자식)
 *   tu-M1     @ T0+2000 (MCP:linear/issue — A1 의 자식)
 *   tu-S4     @ T0+4000 (Skill:commit)
 *   tu-S5     @ T0+4300 (Skill:git:diff — S4 의 자식)
 *   tu-S6     @ T0+4700 (Skill:git:format-message — S4 의 자식)
 *   tu-S10    @ T0+8500 (Skill:changelog-update — turn-after, PARENT_OF 없음)
 */

import type { MockLadybugClient } from './mock-client';

// =============================================================================
// 식별자 — 테스트가 단언 시 hardcode 안 하도록 export.
// =============================================================================

export const META_DOC_IDS_A = {
  refactor: 1001,
  sourceComments: 1002,
  avoidSpaghetti: 1003,
  codeReviewer: 1004,
  lintFix: 1005,
  linearIssue: 1006,
  commit: 1007,
  gitDiff: 1008,
  gitFmtMsg: 1009,
  changelog: 1010,
} as const;

export const TOOL_USE_IDS_A = {
  center: 'tu-CENTER',
  s1: 'tu-S1',
  a1: 'tu-A1',
  s2: 'tu-S2',
  s3: 'tu-S3',
  m1: 'tu-M1',
  s4: 'tu-S4',
  s5: 'tu-S5',
  s6: 'tu-S6',
  s10: 'tu-S10',
} as const;

const T0 = 1716620100000;

// =============================================================================
// 시드 함수 — MockLadybugClient 에 in-memory 노드/엣지를 한 번에 주입.
// =============================================================================

export function seedSetA(client: MockLadybugClient): void {
  // ── 0) 메타 문서 노드 10개 ──────────────────────────────────────────────
  const metaDocs: Array<[number, string, string]> = [
    [META_DOC_IDS_A.refactor,        'command', '/refactor'],
    [META_DOC_IDS_A.sourceComments,  'skill',   'source-comments'],
    [META_DOC_IDS_A.avoidSpaghetti,  'skill',   'avoid-spaghetti'],
    [META_DOC_IDS_A.codeReviewer,    'agent',   'code-reviewer'],
    [META_DOC_IDS_A.lintFix,         'skill',   'lint-fix'],
    [META_DOC_IDS_A.linearIssue,     'mcp',     'linear/issue'],
    [META_DOC_IDS_A.commit,          'skill',   'commit'],
    [META_DOC_IDS_A.gitDiff,         'skill',   'git:diff'],
    [META_DOC_IDS_A.gitFmtMsg,       'skill',   'git:format-message'],
    [META_DOC_IDS_A.changelog,       'skill',   'changelog-update'],
  ];
  for (const [id, kind, name] of metaDocs) {
    client._addNode('MetaDocument', { id, kind, name });
  }

  // ── 1) Session / Turn / Agent ───────────────────────────────────────────
  const sessionId = 'sess-mock-A-1';
  const turnId = 'sess-mock-A-1-T7';
  client._addNode('Session', {
    id: sessionId,
    project_name: 'spyglass',
    started_at: T0,
    total_tokens: 12000,
  });
  client._addNode('Turn', {
    id: turnId,
    session_id: sessionId,
    ordinal: 7,
    started_at: T0,
  });
  client._addNode('Agent', { id: 'main', type: null, session_id: sessionId });
  client._addNode('Agent', {
    id: 'agent-A-cr-1',
    type: 'code-reviewer',
    parent_tool_use: TOOL_USE_IDS_A.a1,
    session_id: sessionId,
  });

  client._addEdge('Session', sessionId, 'Turn', turnId, 'CONTAINS');
  client._addEdge('Turn', turnId, 'Agent', 'main', 'SPAWNED');
  client._addEdge('Turn', turnId, 'Agent', 'agent-A-cr-1', 'SPAWNED');

  // ── 2) ToolCall — 11개 (시간 정확) ──────────────────────────────────────
  const toolCalls: Array<{
    tool_use_id: string;
    agent_id: string;
    tool_name: string;
    tool_detail: string | null;
    started_at: number;
    md_id: number;
  }> = [
    { tool_use_id: TOOL_USE_IDS_A.center, agent_id: 'main',          tool_name: 'SlashCommand', tool_detail: '/refactor',           started_at: T0 + 0,    md_id: META_DOC_IDS_A.refactor },
    { tool_use_id: TOOL_USE_IDS_A.s1,     agent_id: 'main',          tool_name: 'Skill',        tool_detail: 'source-comments',      started_at: T0 + 200,  md_id: META_DOC_IDS_A.sourceComments },
    { tool_use_id: TOOL_USE_IDS_A.a1,     agent_id: 'main',          tool_name: 'Agent',        tool_detail: 'code-reviewer',        started_at: T0 + 400,  md_id: META_DOC_IDS_A.codeReviewer },
    { tool_use_id: TOOL_USE_IDS_A.s2,     agent_id: 'main',          tool_name: 'Skill',        tool_detail: 'avoid-spaghetti',      started_at: T0 + 500,  md_id: META_DOC_IDS_A.avoidSpaghetti },
    { tool_use_id: TOOL_USE_IDS_A.s3,     agent_id: 'agent-A-cr-1',  tool_name: 'Skill',        tool_detail: 'lint-fix',             started_at: T0 + 1000, md_id: META_DOC_IDS_A.lintFix },
    { tool_use_id: TOOL_USE_IDS_A.m1,     agent_id: 'agent-A-cr-1',  tool_name: 'mcp__linear__create_issue', tool_detail: null,      started_at: T0 + 2000, md_id: META_DOC_IDS_A.linearIssue },
    { tool_use_id: TOOL_USE_IDS_A.s4,     agent_id: 'main',          tool_name: 'Skill',        tool_detail: 'commit',               started_at: T0 + 4000, md_id: META_DOC_IDS_A.commit },
    { tool_use_id: TOOL_USE_IDS_A.s5,     agent_id: 'main',          tool_name: 'Skill',        tool_detail: 'git:diff',             started_at: T0 + 4300, md_id: META_DOC_IDS_A.gitDiff },
    { tool_use_id: TOOL_USE_IDS_A.s6,     agent_id: 'main',          tool_name: 'Skill',        tool_detail: 'git:format-message',   started_at: T0 + 4700, md_id: META_DOC_IDS_A.gitFmtMsg },
    { tool_use_id: TOOL_USE_IDS_A.s10,    agent_id: 'main',          tool_name: 'Skill',        tool_detail: 'changelog-update',     started_at: T0 + 8500, md_id: META_DOC_IDS_A.changelog },
  ];
  for (const tc of toolCalls) {
    client._addNode('ToolCall', {
      tool_use_id: tc.tool_use_id,
      session_id: sessionId,
      turn_id: turnId,
      agent_id: tc.agent_id,
      tool_name: tc.tool_name,
      tool_detail: tc.tool_detail,
      started_at: tc.started_at,
      duration_ms: 100,
    });
    client._addEdge('Agent', tc.agent_id, 'ToolCall', tc.tool_use_id, 'CALLED');
    client._addEdge('ToolCall', tc.tool_use_id, 'MetaDocument', String(tc.md_id), 'USES');
  }

  // ── 3) PARENT_OF — 호출 트리 ────────────────────────────────────────────
  const parentOf: Array<[string, string]> = [
    [TOOL_USE_IDS_A.center, TOOL_USE_IDS_A.s1],
    [TOOL_USE_IDS_A.center, TOOL_USE_IDS_A.a1],
    [TOOL_USE_IDS_A.center, TOOL_USE_IDS_A.s4],
    [TOOL_USE_IDS_A.s1,     TOOL_USE_IDS_A.s2],
    [TOOL_USE_IDS_A.a1,     TOOL_USE_IDS_A.s3],
    [TOOL_USE_IDS_A.a1,     TOOL_USE_IDS_A.m1],
    [TOOL_USE_IDS_A.s4,     TOOL_USE_IDS_A.s5],
    [TOOL_USE_IDS_A.s4,     TOOL_USE_IDS_A.s6],
    // tu-S10 은 PARENT_OF 없음 — turn-after 케이스.
  ];
  for (const [parent, child] of parentOf) {
    client._addEdge('ToolCall', parent, 'ToolCall', child, 'PARENT_OF');
  }
}
