/**
 * set-b-deep-hierarchy.ts — 세트 B 시드 (초고깊이 + 분기 2)
 *
 * 책임:
 *   `/auto-pilot` 슬래시 커맨드 1회 호출 → 자율 코딩 워크플로우. depth 7 + 분기 2 곳.
 *   Kahn 위상 정렬이 깊은 layer 에서도 시간축을 꼬지 않는지 검증하는 stress 시드.
 *
 * 호출 트리 (depth 7, 분기 2):
 *   /auto-pilot (command, center) ─────────────────── Layer 0
 *     └─ agent:auto-pilot-orchestrator ─────────────── Layer 1
 *         └─ skill:architect-plan ─────────────────── Layer 2
 *             └─ agent:code-generator ─────────────── Layer 3
 *                 ├─ skill:file-io  (tu-B-4-A) ─── Layer 4 — 분기 #1
 *                 └─ skill:type-check (tu-B-4-B) ──── Layer 4
 *                 (tu-B-4-A 만 자손 계속)
 *                 └─ agent:linter-bot ──────────────── Layer 5
 *                     ├─ skill:lint-fix (tu-B-6-A) ─── Layer 6 — 분기 #2
 *                     └─ skill:format-source (tu-B-6-B) ──── Layer 6
 *                     (tu-B-6-A 만 자손 계속)
 *                     └─ skill:git:commit ───────── Layer 7
 *
 * 검증 의도:
 *   - 가변 깊이 traversal *1..7 정확히 8개 자손 메타 문서 회수.
 *   - 같은 layer 안 (tu-B-4-A, tu-B-4-B) 와 (tu-B-6-A, tu-B-6-B) 의 결정성 정렬.
 *   - Kahn priority key=started_at 가 layer 4 와 layer 6 의 100ms 차이를 정확히 처리.
 *
 * ID 공간:
 *   MetaDocument.id = 2001..2009 (9개)
 *   ToolCall.tool_use_id = 'tu-B-0' ~ 'tu-B-7' (분기는 -A/-B suffix)
 *   Session = 'sess-mock-B-1', Turn = 'sess-mock-B-1-T1'
 *
 * 타임라인 (T0 = 1716620200000):
 *   tu-B-0   @ T0+0     /auto-pilot                            (command)
 *   tu-B-1   @ T0+1000  agent:auto-pilot-orchestrator           (agent)
 *   tu-B-2   @ T0+2000  skill:architect-plan                    (skill)
 *   tu-B-3   @ T0+3500  agent:code-generator                    (agent)
 *   tu-B-4-A @ T0+4000  skill:file-io                           (skill, 분기 #1 좌)
 *   tu-B-4-B @ T0+4100  skill:type-check                        (skill, 분기 #1 우, 100ms 차)
 *   tu-B-5   @ T0+5000  agent:linter-bot                        (agent)
 *   tu-B-6-A @ T0+5500  skill:lint-fix                          (skill, 분기 #2 좌)
 *   tu-B-6-B @ T0+5600  skill:format-source                     (skill, 분기 #2 우, 100ms 차)
 *   tu-B-7   @ T0+7000  skill:git:commit                        (skill)
 */

import type { MockLadybugClient } from './mock-client';

// =============================================================================
// 식별자 — export 해서 테스트가 hardcode 안 하도록.
// =============================================================================

export const META_DOC_IDS_B = {
  autoPilot:     2001,
  orchestrator:  2002,
  architectPlan: 2003,
  codeGenerator: 2004,
  fileIo:        2005,
  typeCheck:     2006,
  linterBot:     2007,
  lintFix:       2008,
  formatSource:  2009,
  gitCommit:     2010,
} as const;

export const TOOL_USE_IDS_B = {
  L0: 'tu-B-0',
  L1: 'tu-B-1',
  L2: 'tu-B-2',
  L3: 'tu-B-3',
  L4A: 'tu-B-4-A',
  L4B: 'tu-B-4-B',
  L5:  'tu-B-5',
  L6A: 'tu-B-6-A',
  L6B: 'tu-B-6-B',
  L7:  'tu-B-7',
} as const;

const T0 = 1716620200000;

// =============================================================================
// 시드 함수
// =============================================================================

export function seedSetB(client: MockLadybugClient): void {
  // ── 0) 메타 문서 노드 10개 (center + 9개 자손) ───────────────────────────
  const metaDocs: Array<[number, string, string]> = [
    [META_DOC_IDS_B.autoPilot,     'command', '/auto-pilot'],
    [META_DOC_IDS_B.orchestrator,  'agent',   'auto-pilot-orchestrator'],
    [META_DOC_IDS_B.architectPlan, 'skill',   'architect-plan'],
    [META_DOC_IDS_B.codeGenerator, 'agent',   'code-generator'],
    [META_DOC_IDS_B.fileIo,        'skill',   'file-io'],
    [META_DOC_IDS_B.typeCheck,     'skill',   'type-check'],
    [META_DOC_IDS_B.linterBot,     'agent',   'linter-bot'],
    [META_DOC_IDS_B.lintFix,       'skill',   'lint-fix'],
    [META_DOC_IDS_B.formatSource,  'skill',   'format-source'],
    [META_DOC_IDS_B.gitCommit,     'skill',   'git:commit'],
  ];
  for (const [id, kind, name] of metaDocs) {
    client._addNode('MetaDocument', { id, kind, name });
  }

  // ── 1) Session / Turn / Agent ───────────────────────────────────────────
  const sessionId = 'sess-mock-B-1';
  const turnId = 'sess-mock-B-1-T1';
  client._addNode('Session', {
    id: sessionId,
    project_name: 'spyglass-deep',
    started_at: T0,
    total_tokens: 45000,
  });
  client._addNode('Turn', { id: turnId, session_id: sessionId, ordinal: 1, started_at: T0 });
  // depth 7 시나리오 — agent 노드도 여러 개. parent_tool_use 추적은 mock 단계에선 단순화.
  client._addNode('Agent', { id: 'main', type: null, session_id: sessionId });
  client._addNode('Agent', { id: 'agent-B-orch-1', type: 'auto-pilot-orchestrator', session_id: sessionId });
  client._addNode('Agent', { id: 'agent-B-cg-1',   type: 'code-generator',          session_id: sessionId });
  client._addNode('Agent', { id: 'agent-B-lint-1', type: 'linter-bot',              session_id: sessionId });

  client._addEdge('Session', sessionId, 'Turn', turnId, 'CONTAINS');
  client._addEdge('Turn', turnId, 'Agent', 'main',          'SPAWNED');
  client._addEdge('Turn', turnId, 'Agent', 'agent-B-orch-1','SPAWNED');
  client._addEdge('Turn', turnId, 'Agent', 'agent-B-cg-1',  'SPAWNED');
  client._addEdge('Turn', turnId, 'Agent', 'agent-B-lint-1','SPAWNED');

  // ── 2) ToolCall — 10개. 타임라인 정확. ─────────────────────────────────
  const toolCalls: Array<{
    tool_use_id: string;
    agent_id: string;
    started_at: number;
    md_id: number;
  }> = [
    { tool_use_id: TOOL_USE_IDS_B.L0,  agent_id: 'main',          started_at: T0 + 0,    md_id: META_DOC_IDS_B.autoPilot     },
    { tool_use_id: TOOL_USE_IDS_B.L1,  agent_id: 'main',          started_at: T0 + 1000, md_id: META_DOC_IDS_B.orchestrator  },
    { tool_use_id: TOOL_USE_IDS_B.L2,  agent_id: 'agent-B-orch-1',started_at: T0 + 2000, md_id: META_DOC_IDS_B.architectPlan },
    { tool_use_id: TOOL_USE_IDS_B.L3,  agent_id: 'agent-B-orch-1',started_at: T0 + 3500, md_id: META_DOC_IDS_B.codeGenerator },
    { tool_use_id: TOOL_USE_IDS_B.L4A, agent_id: 'agent-B-cg-1',  started_at: T0 + 4000, md_id: META_DOC_IDS_B.fileIo        },
    { tool_use_id: TOOL_USE_IDS_B.L4B, agent_id: 'agent-B-cg-1',  started_at: T0 + 4100, md_id: META_DOC_IDS_B.typeCheck     },
    { tool_use_id: TOOL_USE_IDS_B.L5,  agent_id: 'agent-B-cg-1',  started_at: T0 + 5000, md_id: META_DOC_IDS_B.linterBot     },
    { tool_use_id: TOOL_USE_IDS_B.L6A, agent_id: 'agent-B-lint-1',started_at: T0 + 5500, md_id: META_DOC_IDS_B.lintFix       },
    { tool_use_id: TOOL_USE_IDS_B.L6B, agent_id: 'agent-B-lint-1',started_at: T0 + 5600, md_id: META_DOC_IDS_B.formatSource  },
    { tool_use_id: TOOL_USE_IDS_B.L7,  agent_id: 'agent-B-lint-1',started_at: T0 + 7000, md_id: META_DOC_IDS_B.gitCommit     },
  ];
  for (const tc of toolCalls) {
    client._addNode('ToolCall', {
      tool_use_id: tc.tool_use_id,
      session_id: sessionId,
      turn_id: turnId,
      agent_id: tc.agent_id,
      tool_name: tc.tool_use_id === TOOL_USE_IDS_B.L0 ? 'SlashCommand' : (
        tc.md_id === META_DOC_IDS_B.orchestrator || tc.md_id === META_DOC_IDS_B.codeGenerator || tc.md_id === META_DOC_IDS_B.linterBot
          ? 'Agent' : 'Skill'
      ),
      tool_detail: tc.tool_use_id === TOOL_USE_IDS_B.L0 ? '/auto-pilot' : (
        // mock 의 USES 엣지로 분류되므로 tool_detail 은 디버깅용 보조 정보.
        ['', 'auto-pilot-orchestrator', 'architect-plan', 'code-generator',
         'file-io', 'type-check', 'linter-bot', 'lint-fix', 'format-source', 'git:commit'][
          toolCalls.indexOf(tc)
        ]
      ),
      started_at: tc.started_at,
      duration_ms: 500,
    });
    client._addEdge('Agent', tc.agent_id, 'ToolCall', tc.tool_use_id, 'CALLED');
    client._addEdge('ToolCall', tc.tool_use_id, 'MetaDocument', String(tc.md_id), 'USES');
  }

  // ── 3) PARENT_OF — 깊은 chain + 분기 2 곳 ──────────────────────────────
  const parentOf: Array<[string, string]> = [
    [TOOL_USE_IDS_B.L0,  TOOL_USE_IDS_B.L1],   // command → orchestrator
    [TOOL_USE_IDS_B.L1,  TOOL_USE_IDS_B.L2],   // orchestrator → architect-plan
    [TOOL_USE_IDS_B.L2,  TOOL_USE_IDS_B.L3],   // architect-plan → code-generator
    [TOOL_USE_IDS_B.L3,  TOOL_USE_IDS_B.L4A],  // code-generator → file-io     [분기 #1 좌]
    [TOOL_USE_IDS_B.L3,  TOOL_USE_IDS_B.L4B],  // code-generator → type-check  [분기 #1 우]
    [TOOL_USE_IDS_B.L4A, TOOL_USE_IDS_B.L5],   // file-io → linter-bot         (L4B 는 자손 없음 — leaf)
    [TOOL_USE_IDS_B.L5,  TOOL_USE_IDS_B.L6A],  // linter-bot → lint-fix        [분기 #2 좌]
    [TOOL_USE_IDS_B.L5,  TOOL_USE_IDS_B.L6B],  // linter-bot → format-source   [분기 #2 우]
    [TOOL_USE_IDS_B.L6A, TOOL_USE_IDS_B.L7],   // lint-fix → git:commit        (L6B 는 자손 없음 — leaf)
  ];
  for (const [parent, child] of parentOf) {
    client._addEdge('ToolCall', parent, 'ToolCall', child, 'PARENT_OF');
  }
}
