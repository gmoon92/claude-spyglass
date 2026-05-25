/**
 * set-c-wide-breadth.ts — 세트 C 시드 (혼합 25 fan-out)
 *
 * 책임:
 *   `/scan-all` 슬래시 커맨드 1회 호출 → depth 1 단일 layer 에 25 개 자식 (혼합 kind).
 *   priority queue 가 같은 layer 안에서 좌→우 시간 정렬을 찌그러뜨리지 않는지 stress
 *   테스트하는 시드.
 *
 * 호출 트리 (depth 1, fan-out 25):
 *   /scan-all (command, center)
 *   ├─ skill:scan-1 .. skill:scan-15  (15 개 skill, 100ms 간격)
 *   ├─ agent:probe-a .. probe-e        (5 개 agent, 100ms 간격)
 *   └─ mcp:server-1 .. server-5        (5 개 mcp, 100ms 간격)
 *
 * 검증 의도:
 *   - 같은 layer 안에서 started_at ASC 정렬이 25 노드 모두 결정성 보장.
 *   - kind 가 섞여 있어도(skill/agent/mcp) 정렬에 영향 없음 — 시간만 보고 정렬.
 *   - 25 노드 가 모두 layer 1 에 들어가는지 (분기 없는 단일 layer 검증).
 *
 * ID 공간:
 *   MetaDocument.id = 3001 (center) + 3002..3026 (25 자식)
 *   ToolCall.tool_use_id = 'tu-C-0' (center) + 'tu-C-skill-1..15' + 'tu-C-agent-1..5' + 'tu-C-mcp-1..5'
 *   Session = 'sess-mock-C-1', Turn = 'sess-mock-C-1-T1'
 *
 * 타임라인 (T0 = 1716620300000):
 *   tu-C-0 (/scan-all)     @ T0 + 0
 *   tu-C-skill-1           @ T0 + 100
 *   tu-C-skill-2           @ T0 + 200
 *   ...
 *   tu-C-skill-15          @ T0 + 1500
 *   tu-C-agent-1           @ T0 + 1600
 *   ...
 *   tu-C-agent-5           @ T0 + 2000
 *   tu-C-mcp-1             @ T0 + 2100
 *   ...
 *   tu-C-mcp-5             @ T0 + 2500
 */

import type { MockLadybugClient } from './mock-client';

// =============================================================================
// 식별자
// =============================================================================

export const META_DOC_IDS_C = {
  center: 3001,
  // 25 자식은 함수 안에서 동적 생성 (3002..3026).
  childrenStart: 3002,
  childrenEnd: 3026,
} as const;

export const TOOL_USE_IDS_C = {
  center: 'tu-C-0',
  // 25 자식 tool_use_id 도 동적 생성.
} as const;

const T0 = 1716620300000;

const SKILL_COUNT = 15;
const AGENT_COUNT = 5;
const MCP_COUNT = 5;

// =============================================================================
// 시드 함수
// =============================================================================

export function seedSetC(client: MockLadybugClient): void {
  // ── 0) 메타 문서 — center 1 + 25 자식 ──────────────────────────────────
  client._addNode('MetaDocument', {
    id: META_DOC_IDS_C.center,
    kind: 'command',
    name: '/scan-all',
  });

  let mdId = META_DOC_IDS_C.childrenStart;
  for (let i = 1; i <= SKILL_COUNT; i++) {
    client._addNode('MetaDocument', { id: mdId++, kind: 'skill', name: `scan-${i}` });
  }
  for (let i = 1; i <= AGENT_COUNT; i++) {
    const letter = String.fromCharCode('a'.charCodeAt(0) + i - 1); // a..e
    client._addNode('MetaDocument', { id: mdId++, kind: 'agent', name: `probe-${letter}` });
  }
  for (let i = 1; i <= MCP_COUNT; i++) {
    client._addNode('MetaDocument', { id: mdId++, kind: 'mcp', name: `server-${i}` });
  }

  // ── 1) Session / Turn / Agent ───────────────────────────────────────────
  const sessionId = 'sess-mock-C-1';
  const turnId = 'sess-mock-C-1-T1';
  client._addNode('Session', {
    id: sessionId,
    project_name: 'spyglass-wide',
    started_at: T0,
    total_tokens: 8000,
  });
  client._addNode('Turn', { id: turnId, session_id: sessionId, ordinal: 1, started_at: T0 });
  client._addNode('Agent', { id: 'main', type: null, session_id: sessionId });
  client._addEdge('Session', sessionId, 'Turn', turnId, 'CONTAINS');
  client._addEdge('Turn', turnId, 'Agent', 'main', 'SPAWNED');

  // ── 2) center ToolCall ──────────────────────────────────────────────────
  client._addNode('ToolCall', {
    tool_use_id: TOOL_USE_IDS_C.center,
    session_id: sessionId,
    turn_id: turnId,
    agent_id: 'main',
    tool_name: 'SlashCommand',
    tool_detail: '/scan-all',
    started_at: T0 + 0,
    duration_ms: 2600,
  });
  client._addEdge('Agent', 'main', 'ToolCall', TOOL_USE_IDS_C.center, 'CALLED');
  client._addEdge('ToolCall', TOOL_USE_IDS_C.center, 'MetaDocument', String(META_DOC_IDS_C.center), 'USES');

  // ── 3) 25 자식 ToolCall — 100ms 간격, layer 1 단일 ─────────────────────
  // 순서: skill 15 → agent 5 → mcp 5. started_at 은 100ms 씩 증가.
  let offset = 100;
  const childMdStart = META_DOC_IDS_C.childrenStart;

  // skill 1..15
  for (let i = 1; i <= SKILL_COUNT; i++) {
    const tuid = `tu-C-skill-${i}`;
    client._addNode('ToolCall', {
      tool_use_id: tuid,
      session_id: sessionId,
      turn_id: turnId,
      agent_id: 'main',
      tool_name: 'Skill',
      tool_detail: `scan-${i}`,
      started_at: T0 + offset,
      duration_ms: 50,
    });
    client._addEdge('Agent', 'main', 'ToolCall', tuid, 'CALLED');
    client._addEdge('ToolCall', tuid, 'MetaDocument', String(childMdStart + (i - 1)), 'USES');
    client._addEdge('ToolCall', TOOL_USE_IDS_C.center, 'ToolCall', tuid, 'PARENT_OF');
    offset += 100;
  }

  // agent 1..5 (probe-a .. probe-e)
  for (let i = 1; i <= AGENT_COUNT; i++) {
    const letter = String.fromCharCode('a'.charCodeAt(0) + i - 1);
    const tuid = `tu-C-agent-${i}`;
    client._addNode('ToolCall', {
      tool_use_id: tuid,
      session_id: sessionId,
      turn_id: turnId,
      agent_id: 'main',
      tool_name: 'Agent',
      tool_detail: `probe-${letter}`,
      started_at: T0 + offset,
      duration_ms: 80,
    });
    client._addEdge('Agent', 'main', 'ToolCall', tuid, 'CALLED');
    client._addEdge('ToolCall', tuid, 'MetaDocument', String(childMdStart + SKILL_COUNT + (i - 1)), 'USES');
    client._addEdge('ToolCall', TOOL_USE_IDS_C.center, 'ToolCall', tuid, 'PARENT_OF');
    offset += 100;
  }

  // mcp 1..5
  for (let i = 1; i <= MCP_COUNT; i++) {
    const tuid = `tu-C-mcp-${i}`;
    client._addNode('ToolCall', {
      tool_use_id: tuid,
      session_id: sessionId,
      turn_id: turnId,
      agent_id: 'main',
      tool_name: `mcp__server-${i}__probe`,
      tool_detail: null,
      started_at: T0 + offset,
      duration_ms: 60,
    });
    client._addEdge('Agent', 'main', 'ToolCall', tuid, 'CALLED');
    client._addEdge(
      'ToolCall',
      tuid,
      'MetaDocument',
      String(childMdStart + SKILL_COUNT + AGENT_COUNT + (i - 1)),
      'USES',
    );
    client._addEdge('ToolCall', TOOL_USE_IDS_C.center, 'ToolCall', tuid, 'PARENT_OF');
    offset += 100;
  }
}

/** 세트 C 검증 helper — 자식 노드 25개의 *기대* 시간순 id 배열을 반환. */
export function expectedSetCChildOrder(): string[] {
  const out: string[] = [];
  for (let i = 1; i <= SKILL_COUNT; i++) out.push(`tu-C-skill-${i}`);
  for (let i = 1; i <= AGENT_COUNT; i++) out.push(`tu-C-agent-${i}`);
  for (let i = 1; i <= MCP_COUNT; i++)   out.push(`tu-C-mcp-${i}`);
  return out;
}
