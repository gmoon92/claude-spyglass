/**
 * set-d-sequential.ts — 순차 타임라인 DAG 검증 시드 (Set D)
 *
 * 책임:
 *   "중간 로우레벨 도구(bash/read/write)는 숨기고, 상위 메타 노드는 타임라인 인접
 *   순서로 연결" 하는 cohort 타임라인 시퀀스 복원(unified-flow.ts)을 검증하기 위한
 *   결정적 시드. 지시서 예시 trace 를 그대로 재현한다:
 *
 *     agent(pm) → mcp(redmine) → [bash → read → write (hidden)] → skill(commit) → skill(notify)
 *
 *   기대 압축 결과(엣지): pm→mcp, mcp→commit, commit→notify (스타 아님).
 *
 * 의존성:
 *   - mock-client.ts (MockLadybugClient)
 *
 * 디자인 결정:
 *   - **실데이터에 존재하는 엣지만 시드한다**: USES(ToolCall→MetaDocument),
 *     CALLED(Agent→ToolCall), CONTAINS(Session→Turn). SPAWNED/NEXT/PARENT_OF 는
 *     실데이터에서 거의 생성되지 않으므로(스타 토폴로지의 근본 원인) **의도적으로
 *     시드하지 않는다** — 쿼리 시점 타임라인 복원이 이들 없이 동작함을 증명.
 *   - hidden 도구(bash/read/write)는 ToolCall 노드만 만들고 USES 엣지/MetaDocument 를
 *     만들지 않는다 → cohort 타임라인 쿼리에서 원천 제외(경로 압축).
 *   - MetaDocument id 는 production 과 동일하게 `${kind}::${name}` 문자열.
 *   - ID 공간은 'tu-D*' / 'sess-D*' 로 세트 A/B/C 와 분리.
 */

import type { MockLadybugClient } from './mock-client';

const T0 = 1716620100000;

interface ToolCallSeed {
  tool_use_id: string;
  agent_id: string;
  tool_name: string;
  tool_detail: string | null;
  started_at: number;
  /** MetaDocument id (`${kind}::${name}`) — null 이면 hidden(USES 미생성). */
  md_id: string | null;
}

/** MetaDocument 노드 1개 등록 (id = `${kind}::${name}`). */
function addMetaDoc(client: MockLadybugClient, kind: string, name: string): string {
  const id = `${kind}::${name}`;
  client._addNode('MetaDocument', { id, kind, name });
  return id;
}

/** 한 turn 의 ToolCall + USES/CALLED 엣지를 등록. hidden(md_id=null)은 USES 미생성. */
function addTurn(
  client: MockLadybugClient,
  sessionId: string,
  turnId: string,
  ordinal: number,
  startedAt: number,
  toolCalls: ToolCallSeed[],
): void {
  client._addNode('Turn', { id: turnId, session_id: sessionId, ordinal, started_at: startedAt });
  client._addEdge('Session', sessionId, 'Turn', turnId, 'CONTAINS');
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
    // hidden 도구(md_id=null)는 USES 엣지를 만들지 않음 → 타임라인 쿼리에서 제외.
    if (tc.md_id !== null) {
      client._addEdge('ToolCall', tc.tool_use_id, 'MetaDocument', tc.md_id, 'USES');
    }
  }
}

// =============================================================================
// Set D — 단일 trace (지시서 예시 그대로)
// =============================================================================

/**
 * 단일 turn 에 예시 trace 를 시드. center = agent::pm.
 *
 *   pm(t+0) → mcp(t+100) → bash(t+200,hidden) → read(t+300,hidden)
 *           → write(t+400,hidden) → commit(t+500) → notify(t+600)
 *
 * 기대 압축 엣지: pm→mcp, mcp→commit, commit→notify.
 */
export function seedSetD(client: MockLadybugClient): void {
  const sessionId = 'sess-D-1';
  const turnId = 'sess-D-1-T1';

  client._addNode('Session', { id: sessionId, project_name: 'spyglass', started_at: T0, total_tokens: 9000 });
  client._addNode('Agent', { id: 'main', type: null, session_id: sessionId });
  client._addNode('Agent', { id: 'agent-pm', type: 'pm', session_id: sessionId });

  const mdPm = addMetaDoc(client, 'agent', 'pm');
  const mdMcp = addMetaDoc(client, 'mcp', 'mcp__redmine__create_issue');
  const mdCommit = addMetaDoc(client, 'skill', 'commit');
  const mdNotify = addMetaDoc(client, 'skill', 'notify');

  addTurn(client, sessionId, turnId, 1, T0, [
    { tool_use_id: 'tu-D-pm', agent_id: 'main', tool_name: 'Agent', tool_detail: 'pm', started_at: T0 + 0, md_id: mdPm },
    { tool_use_id: 'tu-D-mcp', agent_id: 'agent-pm', tool_name: 'mcp__redmine__create_issue', tool_detail: null, started_at: T0 + 100, md_id: mdMcp },
    { tool_use_id: 'tu-D-bash', agent_id: 'agent-pm', tool_name: 'Bash', tool_detail: null, started_at: T0 + 200, md_id: null },
    { tool_use_id: 'tu-D-read', agent_id: 'agent-pm', tool_name: 'Read', tool_detail: null, started_at: T0 + 300, md_id: null },
    { tool_use_id: 'tu-D-write', agent_id: 'agent-pm', tool_name: 'Write', tool_detail: null, started_at: T0 + 400, md_id: null },
    { tool_use_id: 'tu-D-commit', agent_id: 'agent-pm', tool_name: 'Skill', tool_detail: 'commit', started_at: T0 + 500, md_id: mdCommit },
    { tool_use_id: 'tu-D-notify', agent_id: 'agent-pm', tool_name: 'Skill', tool_detail: 'notify', started_at: T0 + 600, md_id: mdNotify },
  ]);
}

// =============================================================================
// Set D-Frequency — 다중 turn (인접쌍 빈도 → strength 검증)
// =============================================================================

/**
 * center=agent::pm 로 4개 turn 을 시드. 인접쌍 빈도:
 *   - commit→notify : 4/4 turn  → strong
 *   - pm→commit     : 3/4 turn  → strong
 *   - pm→mcp        : 1/4 turn  → medium
 *   - mcp→commit    : 1/4 turn  → medium
 *
 * Turn 1 만 mcp 를 pm 과 commit 사이에 포함, 나머지 turn 은 pm→commit→notify.
 */
export function seedSetDFrequency(client: MockLadybugClient): void {
  const sessionId = 'sess-DF-1';
  client._addNode('Session', { id: sessionId, project_name: 'spyglass', started_at: T0, total_tokens: 9000 });
  client._addNode('Agent', { id: 'main', type: null, session_id: sessionId });
  client._addNode('Agent', { id: 'agent-pm', type: 'pm', session_id: sessionId });

  const mdPm = addMetaDoc(client, 'agent', 'pm');
  const mdMcp = addMetaDoc(client, 'mcp', 'mcp__redmine__create_issue');
  const mdCommit = addMetaDoc(client, 'skill', 'commit');
  const mdNotify = addMetaDoc(client, 'skill', 'notify');

  for (let k = 1; k <= 4; k++) {
    const turnId = `sess-DF-1-T${k}`;
    const base = T0 + k * 100000;
    const calls: ToolCallSeed[] = [
      { tool_use_id: `tu-DF${k}-pm`, agent_id: 'main', tool_name: 'Agent', tool_detail: 'pm', started_at: base + 0, md_id: mdPm },
    ];
    if (k === 1) {
      calls.push({ tool_use_id: `tu-DF${k}-mcp`, agent_id: 'agent-pm', tool_name: 'mcp__redmine__create_issue', tool_detail: null, started_at: base + 100, md_id: mdMcp });
    }
    calls.push(
      { tool_use_id: `tu-DF${k}-commit`, agent_id: 'agent-pm', tool_name: 'Skill', tool_detail: 'commit', started_at: base + 500, md_id: mdCommit },
      { tool_use_id: `tu-DF${k}-notify`, agent_id: 'agent-pm', tool_name: 'Skill', tool_detail: 'notify', started_at: base + 600, md_id: mdNotify },
    );
    addTurn(client, sessionId, turnId, k, base, calls);
  }
}
