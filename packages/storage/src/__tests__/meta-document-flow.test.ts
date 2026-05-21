/**
 * Meta Flow Ego-Graph BFS 호출 트리 회귀 테스트 (meta-docs-flow-tree 2026-05-21)
 *
 * 검증 목적:
 *  - callTree.nodes / callTree.edges 가 parent_tool_use_id 체인을 BFS depth 1~3까지 따라가는지
 *  - depth=1 자식만 center 직접 호출, depth 2/3은 전이 호출로 분리되는지
 *  - depth 상한 3 — 4단째 자손은 잘려야 함
 *  - 다이아몬드 dedup — 두 부모가 동일 자식을 호출하면 노드 1개, 가장 얕은 depth, edge 2개
 *  - 카탈로그 화이트리스트 — skill/agent는 meta_documents 등록 이름만, mcp 무관, tool 전부 제외
 *  - fromTs/toTs > windowDays 우선
 *  - 슬래시 가상 tool_use_id ('slash:'||turn_id) 백필 + root 호출 parent 자동 연결
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  SpyglassDatabase,
  closeDatabase,
  createSession,
  createRequest,
  getMetaFlowEgo,
  upsertMetaDocument,
} from '../index';

const TEST_DB_PATH = `/tmp/spyglass-meta-flow-test-${Date.now()}.db`;

/** 카탈로그 시드용 헬퍼 — type/name만 받아 기본 메타로 등록. */
function seedCatalog(db: any, type: 'skill' | 'agent', name: string, now: number) {
  upsertMetaDocument(db, {
    type,
    name,
    source: 'userSettings',
    source_root: '/home/user/.claude',
    file_path: `/home/user/.claude/${type}s/${name}.md`,
    description: `${name} ${type}`,
    user_invocable: type === 'skill',
    frontmatter_json: null,
    seen_at: now,
  });
}

/** Skill 행 시드 헬퍼. */
function seedSkill(db: any, args: {
  id: string; sessionId: string; ts: number; turnId: string;
  name: string;
  toolUseId?: string;
  parentToolUseId?: string;
}) {
  createRequest(db, {
    id: args.id,
    session_id: args.sessionId,
    timestamp: args.ts,
    type: 'tool_call',
    tool_name: 'Skill',
    tool_detail: args.name,
    turn_id: args.turnId,
    tool_use_id: args.toolUseId,
    parent_tool_use_id: args.parentToolUseId,
    event_type: 'tool',
    tokens_input: 0, tokens_output: 0, tokens_total: 0,
  });
}

/** Agent 행 시드 헬퍼. */
function seedAgent(db: any, args: {
  id: string; sessionId: string; ts: number; turnId: string;
  name: string;
  toolUseId?: string;
  parentToolUseId?: string;
}) {
  createRequest(db, {
    id: args.id,
    session_id: args.sessionId,
    timestamp: args.ts,
    type: 'tool_call',
    tool_name: 'Agent',
    tool_detail: args.name,
    turn_id: args.turnId,
    tool_use_id: args.toolUseId,
    parent_tool_use_id: args.parentToolUseId,
    event_type: 'tool',
    tokens_input: 0, tokens_output: 0, tokens_total: 0,
  });
}

/** MCP 도구 행 시드 헬퍼. */
function seedMcp(db: any, args: {
  id: string; sessionId: string; ts: number; turnId: string;
  toolName: string;
  toolUseId?: string;
  parentToolUseId?: string;
}) {
  createRequest(db, {
    id: args.id,
    session_id: args.sessionId,
    timestamp: args.ts,
    type: 'tool_call',
    tool_name: args.toolName,
    turn_id: args.turnId,
    tool_use_id: args.toolUseId,
    parent_tool_use_id: args.parentToolUseId,
    event_type: 'tool',
    tokens_input: 0, tokens_output: 0, tokens_total: 0,
  });
}

/** 내장 도구 행 시드 헬퍼 (TaskCreate 등). */
function seedBuiltinTool(db: any, args: {
  id: string; sessionId: string; ts: number; turnId: string;
  toolName: string;
  toolUseId?: string;
  parentToolUseId?: string;
}) {
  createRequest(db, {
    id: args.id,
    session_id: args.sessionId,
    timestamp: args.ts,
    type: 'tool_call',
    tool_name: args.toolName,
    turn_id: args.turnId,
    tool_use_id: args.toolUseId,
    parent_tool_use_id: args.parentToolUseId,
    event_type: 'tool',
    tokens_input: 0, tokens_output: 0, tokens_total: 0,
  });
}

describe('getMetaFlowEgo — BFS callTree (meta-docs-flow-tree)', () => {
  let db: SpyglassDatabase;
  let sessionId: string;
  const now = Date.now();

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
    sessionId = crypto.randomUUID();
    createSession(db.instance, {
      id: sessionId,
      project_name: 'flow-test-project',
      started_at: now - 60_000,
    });
  });

  afterEach(() => {
    closeDatabase();
    try { require('fs').unlinkSync(TEST_DB_PATH); } catch {}
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1) depth=1 직접 호출만 포함
  // ──────────────────────────────────────────────────────────────────────────
  it('depth=1 — center가 직접 호출한 skill/agent만 depth=1로 분류', () => {
    seedCatalog(db.instance, 'skill', 'reviewer', now);
    seedCatalog(db.instance, 'agent', 'analyst', now);

    // center: Skill='reviewer' (tool_use_id='tu-center')
    seedSkill(db.instance, {
      id: 'r-c', sessionId, ts: now - 30_000, turnId: 'turn-1',
      name: 'reviewer', toolUseId: 'tu-center',
    });
    // 직접 자식: agent='analyst' (parent=tu-center)
    seedAgent(db.instance, {
      id: 'r-c1', sessionId, ts: now - 29_000, turnId: 'turn-1',
      name: 'analyst', toolUseId: 'tu-child1', parentToolUseId: 'tu-center',
    });

    const ego = getMetaFlowEgo(db.instance, {
      centerType: 'skill', centerName: 'reviewer',
      project: 'flow-test-project', windowDays: 7,
    });

    expect(ego.center.turns).toBe(1);
    expect(ego.callTree.nodes.length).toBe(1);
    expect(ego.callTree.nodes[0]).toMatchObject({
      kind: 'agent', name: 'analyst', depth: 1,
    });
    expect(ego.callTree.edges).toHaveLength(1);
    expect(ego.callTree.edges[0]).toMatchObject({
      fromKind: 'skill', fromName: 'reviewer',
      toKind: 'agent', toName: 'analyst',
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2) 깊은 호출 사슬 — 깊이 제한 없이 모두 추적 (안전 상한 32)
  // ──────────────────────────────────────────────────────────────────────────
  it('깊은 사슬 — 4단을 넘어도 메타 문서는 모두 callTree에 노출', () => {
    seedCatalog(db.instance, 'skill', 'pm', now);
    seedCatalog(db.instance, 'skill', 'docs-notify', now);
    seedCatalog(db.instance, 'skill', 'gchat', now);
    seedCatalog(db.instance, 'skill', 'log-writer', now);
    seedCatalog(db.instance, 'skill', 'archive', now); // depth 4 — 예전엔 잘렸음

    // 체인: pm(d0) → docs-notify(d1) → gchat(d2) → log-writer(d3) → archive(d4)
    seedSkill(db.instance, { id: 't2-c',  sessionId, ts: now - 40_000, turnId: 'turn-2', name: 'pm',          toolUseId: 'tu-pm' });
    seedSkill(db.instance, { id: 't2-d1', sessionId, ts: now - 39_000, turnId: 'turn-2', name: 'docs-notify', toolUseId: 'tu-dn',  parentToolUseId: 'tu-pm' });
    seedSkill(db.instance, { id: 't2-d2', sessionId, ts: now - 38_000, turnId: 'turn-2', name: 'gchat',       toolUseId: 'tu-gc',  parentToolUseId: 'tu-dn' });
    seedSkill(db.instance, { id: 't2-d3', sessionId, ts: now - 37_000, turnId: 'turn-2', name: 'log-writer',  toolUseId: 'tu-log', parentToolUseId: 'tu-gc' });
    seedSkill(db.instance, { id: 't2-d4', sessionId, ts: now - 36_000, turnId: 'turn-2', name: 'archive',     toolUseId: 'tu-ar',  parentToolUseId: 'tu-log' });

    const ego = getMetaFlowEgo(db.instance, {
      centerType: 'skill', centerName: 'pm',
      project: 'flow-test-project', windowDays: 7,
    });

    const byDepth = new Map<number, string[]>();
    for (const n of ego.callTree.nodes) {
      const list = byDepth.get(n.depth) ?? [];
      list.push(n.name);
      byDepth.set(n.depth, list);
    }

    expect(byDepth.get(1)).toEqual(['docs-notify']);
    expect(byDepth.get(2)).toEqual(['gchat']);
    expect(byDepth.get(3)).toEqual(['log-writer']);
    expect(byDepth.get(4)).toEqual(['archive']);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3) 다이아몬드 dedup — 두 부모가 같은 자식 호출
  // ──────────────────────────────────────────────────────────────────────────
  it('다이아몬드 — 두 부모가 같은 자식을 호출하면 노드 1개 + edge 2개', () => {
    seedCatalog(db.instance, 'skill', 'pm', now);
    seedCatalog(db.instance, 'skill', 'left', now);
    seedCatalog(db.instance, 'skill', 'right', now);
    seedCatalog(db.instance, 'skill', 'common', now); // 두 부모가 모두 호출

    // pm → left, right  (depth 1)
    seedSkill(db.instance, { id: 't3-c',  sessionId, ts: now - 50_000, turnId: 'turn-3', name: 'pm',     toolUseId: 'tu-pm' });
    seedSkill(db.instance, { id: 't3-l',  sessionId, ts: now - 49_000, turnId: 'turn-3', name: 'left',   toolUseId: 'tu-left',  parentToolUseId: 'tu-pm' });
    seedSkill(db.instance, { id: 't3-r',  sessionId, ts: now - 48_000, turnId: 'turn-3', name: 'right',  toolUseId: 'tu-right', parentToolUseId: 'tu-pm' });
    // left → common, right → common (둘 다 depth 2)
    seedSkill(db.instance, { id: 't3-cl', sessionId, ts: now - 47_000, turnId: 'turn-3', name: 'common',                       parentToolUseId: 'tu-left' });
    seedSkill(db.instance, { id: 't3-cr', sessionId, ts: now - 46_000, turnId: 'turn-3', name: 'common',                       parentToolUseId: 'tu-right' });

    const ego = getMetaFlowEgo(db.instance, {
      centerType: 'skill', centerName: 'pm',
      project: 'flow-test-project', windowDays: 7,
    });

    // 노드: left/right (depth 1), common (depth 2 — 1개만)
    const commonNodes = ego.callTree.nodes.filter(n => n.name === 'common');
    expect(commonNodes).toHaveLength(1);
    expect(commonNodes[0].depth).toBe(2);
    // count = distinct turn 수. 같은 turn 안에서 두 부모로부터 호출되어도 1.
    expect(commonNodes[0].count).toBe(1);

    // 엣지: left→common, right→common 2개
    const intoCommon = ego.callTree.edges.filter(e => e.toName === 'common');
    expect(intoCommon).toHaveLength(2);
    const fromNames = intoCommon.map(e => e.fromName).sort();
    expect(fromNames).toEqual(['left', 'right']);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4) 카탈로그 화이트리스트 — skill/agent 등록 이름만, mcp 무관, tool 전부 제외
  // ──────────────────────────────────────────────────────────────────────────
  it('카탈로그 화이트리스트 — skill/agent 등록만, mcp 무관, 내장 도구 제외', () => {
    seedCatalog(db.instance, 'skill', 'reviewer', now);
    seedCatalog(db.instance, 'agent', 'analyst', now);
    // 'phantom' skill은 의도적으로 미등록

    seedSkill(db.instance, { id: 't4-c',     sessionId, ts: now - 30_000, turnId: 'turn-4', name: 'reviewer', toolUseId: 'tu-c' });
    // 등록된 agent — 통과
    seedAgent(db.instance, { id: 't4-ok',    sessionId, ts: now - 29_000, turnId: 'turn-4', name: 'analyst', parentToolUseId: 'tu-c' });
    // 미등록 skill — 차단
    seedSkill(db.instance, { id: 't4-no',    sessionId, ts: now - 28_000, turnId: 'turn-4', name: 'phantom', parentToolUseId: 'tu-c' });
    // 내장 도구 — 전부 제외
    seedBuiltinTool(db.instance, { id: 't4-tc', sessionId, ts: now - 27_000, turnId: 'turn-4', toolName: 'TaskCreate', parentToolUseId: 'tu-c' });
    seedBuiltinTool(db.instance, { id: 't4-rd', sessionId, ts: now - 26_000, turnId: 'turn-4', toolName: 'Read',       parentToolUseId: 'tu-c' });
    // MCP — 카탈로그 무관 통과
    seedMcp(db.instance, { id: 't4-mcp', sessionId, ts: now - 25_000, turnId: 'turn-4', toolName: 'mcp__context7__resolve-library-id', parentToolUseId: 'tu-c' });

    const ego = getMetaFlowEgo(db.instance, {
      centerType: 'skill', centerName: 'reviewer',
      project: 'flow-test-project', windowDays: 7,
    });

    const nodeKeys = ego.callTree.nodes.map(n => `${n.kind}:${n.name}`);
    expect(nodeKeys).toContain('agent:analyst');
    expect(nodeKeys).toContain('mcp:mcp__context7__resolve-library-id');
    expect(nodeKeys).not.toContain('skill:phantom');
    // 내장 도구는 어떤 kind로도 노출되지 않음
    expect(ego.callTree.nodes.some(n => n.kind === 'tool')).toBe(false);
    expect(nodeKeys).not.toContain('command:TaskCreate');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5) fromTs/toTs 우선 — windowDays 무시
  // ──────────────────────────────────────────────────────────────────────────
  it('fromTs/toTs가 windowDays보다 우선', () => {
    seedCatalog(db.instance, 'skill', 'reviewer', now);

    // turnA — 윈도우 안
    seedSkill(db.instance, { id: 't5-a', sessionId, ts: now - 30_000, turnId: 'turn-5a', name: 'reviewer', toolUseId: 'tu-a' });
    // turnB — 100일 전 (기본 windowDays=7 밖)
    const ancientTs = now - 100 * 24 * 60 * 60 * 1000;
    createSession(db.instance, { id: 'sess-old', project_name: 'flow-test-project', started_at: ancientTs });
    seedSkill(db.instance, { id: 't5-b', sessionId: 'sess-old', ts: ancientTs, turnId: 'turn-5b', name: 'reviewer', toolUseId: 'tu-b' });

    const egoDefault = getMetaFlowEgo(db.instance, {
      centerType: 'skill', centerName: 'reviewer',
      project: 'flow-test-project', windowDays: 7,
    });
    expect(egoDefault.center.turns).toBe(1); // turnA만

    const egoExplicit = getMetaFlowEgo(db.instance, {
      centerType: 'skill', centerName: 'reviewer',
      project: 'flow-test-project', windowDays: 7,
      fromTs: now - 200 * 24 * 60 * 60 * 1000,
      toTs: now,
    });
    expect(egoExplicit.center.turns).toBe(2); // turnA + turnB
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6) 슬래시 가상 tool_use_id — 마이그레이션 037 효과 검증
  // ──────────────────────────────────────────────────────────────────────────
  it('슬래시 가상 tool_use_id — root 호출 parent 자동 연결로 callTree에 등장', () => {
    seedCatalog(db.instance, 'skill', 'docs-notify', now);

    // /pm 슬래시 행을 시드(가상 ID 'slash:'||turn_id 부여) — 일반적으로 prompt 타입이지만
    // 본 테스트에서는 백필 효과만 검증하므로 createRequest 호출만 한다.
    createRequest(db.instance, {
      id: 't6-slash',
      session_id: sessionId,
      timestamp: now - 40_000,
      type: 'prompt',
      slash_command: '/pm',
      turn_id: 'turn-6',
      tool_use_id: 'slash:turn-6', // persist.ts에서 부여하는 동일 규칙
      event_type: 'user_prompt',
      tokens_input: 0, tokens_output: 0, tokens_total: 0,
    });

    // 슬래시가 직접 호출한 docs-notify (root-level 호출 — parent를 슬래시 가상 ID로 연결)
    seedSkill(db.instance, {
      id: 't6-child', sessionId,
      ts: now - 39_000, turnId: 'turn-6',
      name: 'docs-notify',
      toolUseId: 'tu-dn',
      parentToolUseId: 'slash:turn-6',
    });

    const ego = getMetaFlowEgo(db.instance, {
      centerType: 'command', centerName: '/pm',
      project: 'flow-test-project', windowDays: 7,
    });

    expect(ego.center.turns).toBe(1);
    expect(ego.callTree.nodes.find(n => n.name === 'docs-notify')).toBeDefined();
    expect(ego.callTree.edges).toContainEqual(expect.objectContaining({
      fromKind: 'command', fromName: '/pm',
      toKind: 'skill', toName: 'docs-notify',
    }));
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 7) 부모 BFS depth=-1 — center 를 호출한 직속 부모가 음수 depth 로 잡힘
  // ──────────────────────────────────────────────────────────────────────────
  it('부모 BFS depth=-1 — pm→commit 시드 후 commit center 에 pm 이 depth=-1 로 잡힘', () => {
    seedCatalog(db.instance, 'agent', 'pm', now);
    seedCatalog(db.instance, 'skill', 'commit', now);

    // pm(agent) → commit(skill) — pm 이 commit 을 호출
    seedAgent(db.instance, {
      id: 't7-pm', sessionId, ts: now - 60_000, turnId: 'turn-7',
      name: 'pm', toolUseId: 'tu-pm',
    });
    seedSkill(db.instance, {
      id: 't7-commit', sessionId, ts: now - 59_000, turnId: 'turn-7',
      name: 'commit', toolUseId: 'tu-commit', parentToolUseId: 'tu-pm',
    });

    const ego = getMetaFlowEgo(db.instance, {
      centerType: 'skill', centerName: 'commit',
      project: 'flow-test-project', windowDays: 7,
    });

    // depth=-1 에 agent='pm' 노드 존재
    const pmNode = ego.callTree.nodes.find(n => n.kind === 'agent' && n.name === 'pm');
    expect(pmNode).toBeDefined();
    expect(pmNode!.depth).toBe(-1);
    expect(pmNode!.timeline).toBeNull();
    // 부모 BFS turnSet 회귀 가드 — count 는 distinct turn 수(>=1).
    expect(pmNode!.count).toBe(1);
    expect(pmNode!.pct).toBeCloseTo(1.0, 5);
    // 엣지: pm → commit (call). 엣지 count 도 distinct turn(=1).
    const pmEdge = ego.callTree.edges.find(e =>
      e.fromKind === 'agent' && e.fromName === 'pm' &&
      e.toKind === 'skill' && e.toName === 'commit' &&
      e.relation === 'call');
    expect(pmEdge).toBeDefined();
    expect(pmEdge!.count).toBe(1);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 8) 부모 BFS depth=-3 — 슬래시 → agent → skill → skill 다단계 거슬러 올라감
  // ──────────────────────────────────────────────────────────────────────────
  it('부모 BFS depth=-3 — /pm → pm → docs-notify → gchat 시드 후 gchat center 에 슬래시가 -3 로 잡힘', () => {
    seedCatalog(db.instance, 'agent', 'pm', now);
    seedCatalog(db.instance, 'skill', 'docs-notify', now);
    seedCatalog(db.instance, 'skill', 'gchat', now);

    // /pm — 슬래시 root
    createRequest(db.instance, {
      id: 't8-slash',
      session_id: sessionId,
      timestamp: now - 70_000,
      type: 'prompt',
      slash_command: '/pm',
      turn_id: 'turn-8',
      tool_use_id: 'slash:turn-8',
      event_type: 'user_prompt',
      tokens_input: 0, tokens_output: 0, tokens_total: 0,
    });
    // /pm → pm(agent)
    seedAgent(db.instance, {
      id: 't8-pm', sessionId, ts: now - 69_000, turnId: 'turn-8',
      name: 'pm', toolUseId: 'tu-pm', parentToolUseId: 'slash:turn-8',
    });
    // pm → docs-notify
    seedSkill(db.instance, {
      id: 't8-dn', sessionId, ts: now - 68_000, turnId: 'turn-8',
      name: 'docs-notify', toolUseId: 'tu-dn', parentToolUseId: 'tu-pm',
    });
    // docs-notify → gchat (center)
    seedSkill(db.instance, {
      id: 't8-gc', sessionId, ts: now - 67_000, turnId: 'turn-8',
      name: 'gchat', toolUseId: 'tu-gc', parentToolUseId: 'tu-dn',
    });

    const ego = getMetaFlowEgo(db.instance, {
      centerType: 'skill', centerName: 'gchat',
      project: 'flow-test-project', windowDays: 7,
    });

    const find = (kind: string, name: string) =>
      ego.callTree.nodes.find(n => n.kind === kind && n.name === name);

    const dn = find('skill', 'docs-notify');
    const pm = find('agent', 'pm');
    const slash = find('command', '/pm');

    expect(dn?.depth).toBe(-1);
    expect(pm?.depth).toBe(-2);
    expect(slash?.depth).toBe(-3);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 9) 같은 턴 시간 흐름 후속 — 인과 사슬 없이 시간만 이후인 메타 문서는 timeline='after'
  // ──────────────────────────────────────────────────────────────────────────
  it('같은 턴 후속 — center 이후 같은 turn 등장한 메타 문서는 timeline=after, 자식과 같으면 자식 우선', () => {
    seedCatalog(db.instance, 'skill', 'redmine', now);
    seedCatalog(db.instance, 'skill', 'commit', now);
    seedCatalog(db.instance, 'skill', 'push',   now);

    // redmine(center) — center 자신
    seedSkill(db.instance, {
      id: 't9-rm', sessionId, ts: now - 50_000, turnId: 'turn-9',
      name: 'redmine', toolUseId: 'tu-rm',
    });
    // commit — redmine 의 자식(인과 사슬 있음, depth=1)
    seedSkill(db.instance, {
      id: 't9-co', sessionId, ts: now - 49_000, turnId: 'turn-9',
      name: 'commit', toolUseId: 'tu-co', parentToolUseId: 'tu-rm',
    });
    // push — 인과 사슬 없음(parent_tool_use_id=null), 시간만 이후 → timeline='after'
    seedSkill(db.instance, {
      id: 't9-ps', sessionId, ts: now - 48_000, turnId: 'turn-9',
      name: 'push', toolUseId: 'tu-ps',
    });

    const ego = getMetaFlowEgo(db.instance, {
      centerType: 'skill', centerName: 'redmine',
      project: 'flow-test-project', windowDays: 7,
    });

    const commitNode = ego.callTree.nodes.find(n => n.kind === 'skill' && n.name === 'commit');
    const pushNode   = ego.callTree.nodes.find(n => n.kind === 'skill' && n.name === 'push');

    // commit: 자식(depth=1), timeline=null
    expect(commitNode?.depth).toBe(1);
    expect(commitNode?.timeline).toBeNull();
    // push: timeline='after' (자식/부모 사슬에 없으므로 turn-after 컬럼)
    expect(pushNode?.timeline).toBe('after');

    // turn-flow 엣지: redmine → push
    expect(ego.callTree.edges).toContainEqual(expect.objectContaining({
      fromKind: 'skill', fromName: 'redmine',
      toKind: 'skill', toName: 'push',
      relation: 'turn-flow',
    }));
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 10) 부모와 자식이 같은 노드(루프) — 별도 컬럼이라 양쪽 등장 허용, after 는 제외
  // ──────────────────────────────────────────────────────────────────────────
  it('루프 — 부모와 자식이 같은 이름이면 양쪽 컬럼 모두 등장(자식/부모 별도 컬럼), turn-after 는 제외', () => {
    seedCatalog(db.instance, 'skill', 'a', now);
    seedCatalog(db.instance, 'skill', 'b', now);

    // a → b → a — b 가 center 일 때 a 는 부모(-1) 이자 자식(+1)
    seedSkill(db.instance, {
      id: 't10-a1', sessionId, ts: now - 60_000, turnId: 'turn-10',
      name: 'a', toolUseId: 'tu-a1',
    });
    seedSkill(db.instance, {
      id: 't10-b',  sessionId, ts: now - 59_000, turnId: 'turn-10',
      name: 'b', toolUseId: 'tu-b', parentToolUseId: 'tu-a1',
    });
    seedSkill(db.instance, {
      id: 't10-a2', sessionId, ts: now - 58_000, turnId: 'turn-10',
      name: 'a', toolUseId: 'tu-a2', parentToolUseId: 'tu-b',
    });

    const ego = getMetaFlowEgo(db.instance, {
      centerType: 'skill', centerName: 'b',
      project: 'flow-test-project', windowDays: 7,
    });

    const aNodes = ego.callTree.nodes.filter(n => n.kind === 'skill' && n.name === 'a');
    // 자식(+1) 1개 + 부모(-1) 1개 — 별도 컬럼이라 dedup 안 됨
    expect(aNodes).toHaveLength(2);
    const depths = aNodes.map(n => n.depth).sort((x, y) => x - y);
    expect(depths).toEqual([-1, 1]);
    // 어느 것도 timeline='after' 가 아니어야 한다(인과 표현이 우선).
    expect(aNodes.every(n => n.timeline === null)).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 11) 사용자 시나리오 — pm → redmine → commit → push → doc-sync
  //   commit 이 center 일 때 부모 사슬(redmine, pm)과 자식 사슬(push, doc-sync) 모두 노출
  // ──────────────────────────────────────────────────────────────────────────
  it('사용자 시나리오 — commit center 에서 부모/자식 사슬 모두 노출', () => {
    seedCatalog(db.instance, 'skill', 'pm', now);
    seedCatalog(db.instance, 'skill', 'redmine', now);
    seedCatalog(db.instance, 'skill', 'commit', now);
    seedCatalog(db.instance, 'skill', 'push', now);
    seedCatalog(db.instance, 'skill', 'doc-sync', now);

    // 체인: pm(d-2) → redmine(d-1) → commit(center) → push(d+1) → doc-sync(d+2)
    seedSkill(db.instance, { id: 's-pm', sessionId, ts: now - 50_000, turnId: 'turn-11', name: 'pm',       toolUseId: 'tu-pm' });
    seedSkill(db.instance, { id: 's-rm', sessionId, ts: now - 49_000, turnId: 'turn-11', name: 'redmine',  toolUseId: 'tu-rm', parentToolUseId: 'tu-pm' });
    seedSkill(db.instance, { id: 's-cm', sessionId, ts: now - 48_000, turnId: 'turn-11', name: 'commit',   toolUseId: 'tu-cm', parentToolUseId: 'tu-rm' });
    seedSkill(db.instance, { id: 's-ps', sessionId, ts: now - 47_000, turnId: 'turn-11', name: 'push',     toolUseId: 'tu-ps', parentToolUseId: 'tu-cm' });
    seedSkill(db.instance, { id: 's-ds', sessionId, ts: now - 46_000, turnId: 'turn-11', name: 'doc-sync', toolUseId: 'tu-ds', parentToolUseId: 'tu-ps' });

    const ego = getMetaFlowEgo(db.instance, {
      centerType: 'skill', centerName: 'commit',
      project: 'flow-test-project', windowDays: 7,
    });

    const byDepth = new Map<number, string[]>();
    for (const n of ego.callTree.nodes) {
      if (n.timeline !== null) continue;
      const list = byDepth.get(n.depth) ?? [];
      list.push(n.name);
      byDepth.set(n.depth, list);
    }

    expect(byDepth.get(-2)).toEqual(['pm']);
    expect(byDepth.get(-1)).toEqual(['redmine']);
    expect(byDepth.get(1)).toEqual(['push']);
    expect(byDepth.get(2)).toEqual(['doc-sync']);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 12) 6-홉 깊은 사슬 — 안전 상한 32 안에서 모두 노출
  // ──────────────────────────────────────────────────────────────────────────
  it('6-홉 사슬 — 종단까지 모두 callTree 에 노출', () => {
    for (const n of ['root', 's1', 's2', 's3', 's4', 's5', 's6']) {
      seedCatalog(db.instance, 'skill', n, now);
    }
    seedSkill(db.instance, { id: 'h-c',  sessionId, ts: now - 70_000, turnId: 'turn-12', name: 'root', toolUseId: 'tu-c' });
    seedSkill(db.instance, { id: 'h-1',  sessionId, ts: now - 69_000, turnId: 'turn-12', name: 's1',   toolUseId: 'tu-1', parentToolUseId: 'tu-c' });
    seedSkill(db.instance, { id: 'h-2',  sessionId, ts: now - 68_000, turnId: 'turn-12', name: 's2',   toolUseId: 'tu-2', parentToolUseId: 'tu-1' });
    seedSkill(db.instance, { id: 'h-3',  sessionId, ts: now - 67_000, turnId: 'turn-12', name: 's3',   toolUseId: 'tu-3', parentToolUseId: 'tu-2' });
    seedSkill(db.instance, { id: 'h-4',  sessionId, ts: now - 66_000, turnId: 'turn-12', name: 's4',   toolUseId: 'tu-4', parentToolUseId: 'tu-3' });
    seedSkill(db.instance, { id: 'h-5',  sessionId, ts: now - 65_000, turnId: 'turn-12', name: 's5',   toolUseId: 'tu-5', parentToolUseId: 'tu-4' });
    seedSkill(db.instance, { id: 'h-6',  sessionId, ts: now - 64_000, turnId: 'turn-12', name: 's6',   toolUseId: 'tu-6', parentToolUseId: 'tu-5' });

    const ego = getMetaFlowEgo(db.instance, {
      centerType: 'skill', centerName: 'root',
      project: 'flow-test-project', windowDays: 7,
    });

    const names = ego.callTree.nodes
      .filter(n => n.timeline === null)
      .map(n => `${n.depth}:${n.name}`)
      .sort();
    expect(names).toEqual(['1:s1', '2:s2', '3:s3', '4:s4', '5:s5', '6:s6']);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 13) 내장 도구 통과 — Bash 가 중간이어도 그 아래 메타 문서 노출
  // ──────────────────────────────────────────────────────────────────────────
  it('내장 도구 transit — skill → Bash → skill 도 사슬 보존', () => {
    seedCatalog(db.instance, 'skill', 'a', now);
    seedCatalog(db.instance, 'skill', 'b', now);

    seedSkill(db.instance, { id: 'bt-c', sessionId, ts: now - 30_000, turnId: 'turn-13', name: 'a', toolUseId: 'tu-a' });
    seedBuiltinTool(db.instance, { id: 'bt-bash', sessionId, ts: now - 29_000, turnId: 'turn-13', toolName: 'Bash', toolUseId: 'tu-bash', parentToolUseId: 'tu-a' });
    seedSkill(db.instance, { id: 'bt-b', sessionId, ts: now - 28_000, turnId: 'turn-13', name: 'b', toolUseId: 'tu-b', parentToolUseId: 'tu-bash' });

    const ego = getMetaFlowEgo(db.instance, {
      centerType: 'skill', centerName: 'a',
      project: 'flow-test-project', windowDays: 7,
    });

    const meta = ego.callTree.nodes.filter(n => n.timeline === null);
    // a 의 자식으로 b 가 depth=1 로 노출 (Bash 노드는 없음).
    expect(meta).toHaveLength(1);
    expect(meta[0]).toMatchObject({ kind: 'skill', name: 'b', depth: 1 });

    // 엣지는 메타 문서 사이 — a → b (Bash 미경유).
    const ab = ego.callTree.edges.filter(e => e.fromName === 'a' && e.toName === 'b');
    expect(ab).toHaveLength(1);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 14) 미등록 skill 통과 — 카탈로그에 없는 ghost 도 사슬은 잇는다
  // ──────────────────────────────────────────────────────────────────────────
  it('미등록 skill transit — skill → ghost → skill 도 사슬 보존', () => {
    seedCatalog(db.instance, 'skill', 'a', now);
    seedCatalog(db.instance, 'skill', 'b', now);
    // 'ghost' 는 의도적으로 카탈로그 미등록

    seedSkill(db.instance, { id: 'gt-c', sessionId, ts: now - 30_000, turnId: 'turn-14', name: 'a', toolUseId: 'tu-a' });
    seedSkill(db.instance, { id: 'gt-g', sessionId, ts: now - 29_000, turnId: 'turn-14', name: 'ghost', toolUseId: 'tu-g', parentToolUseId: 'tu-a' });
    seedSkill(db.instance, { id: 'gt-b', sessionId, ts: now - 28_000, turnId: 'turn-14', name: 'b', toolUseId: 'tu-b', parentToolUseId: 'tu-g' });

    const ego = getMetaFlowEgo(db.instance, {
      centerType: 'skill', centerName: 'a',
      project: 'flow-test-project', windowDays: 7,
    });

    const meta = ego.callTree.nodes.filter(n => n.timeline === null);
    expect(meta).toHaveLength(1);
    expect(meta[0]).toMatchObject({ kind: 'skill', name: 'b', depth: 1 });
    // ghost 노드는 없어야 한다.
    expect(meta.some(n => n.name === 'ghost')).toBe(false);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 15) distinct turn count — 같은 turn 안에서 자식 N 회 호출해도 count=1
  // ──────────────────────────────────────────────────────────────────────────
  it('같은 turn 안 반복 호출 — count = 1 (distinct turn)', () => {
    seedCatalog(db.instance, 'skill', 'a', now);
    seedCatalog(db.instance, 'skill', 'b', now);

    seedSkill(db.instance, { id: 'd-c', sessionId, ts: now - 30_000, turnId: 'turn-15', name: 'a', toolUseId: 'tu-a' });
    // 같은 turn 에서 b 를 5회 호출
    for (let i = 0; i < 5; i++) {
      seedSkill(db.instance, {
        id: `d-b${i}`, sessionId, ts: now - 29_000 + i * 100, turnId: 'turn-15',
        name: 'b', toolUseId: `tu-b${i}`, parentToolUseId: 'tu-a',
      });
    }

    const ego = getMetaFlowEgo(db.instance, {
      centerType: 'skill', centerName: 'a',
      project: 'flow-test-project', windowDays: 7,
    });

    const b = ego.callTree.nodes.find(n => n.name === 'b' && n.timeline === null);
    expect(b).toBeDefined();
    expect(b!.count).toBe(1); // 같은 turn 5회 → distinct = 1
    expect(b!.pct).toBeLessThanOrEqual(1); // % ≤ 100% 보장
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 16) 다중 turn 누적 — 서로 다른 turn 에서 호출되면 count 누적
  // ──────────────────────────────────────────────────────────────────────────
  it('다중 turn 누적 — turn 3개에서 호출되면 count=3', () => {
    seedCatalog(db.instance, 'skill', 'a', now);
    seedCatalog(db.instance, 'skill', 'b', now);

    // 3개 turn 각각에서 a → b 호출.
    for (let t = 0; t < 3; t++) {
      const turnId = `turn-16-${t}`;
      const tuA = `tu-a-${t}`;
      seedSkill(db.instance, { id: `m-a-${t}`, sessionId, ts: now - 60_000 + t * 1000, turnId, name: 'a', toolUseId: tuA });
      seedSkill(db.instance, { id: `m-b-${t}`, sessionId, ts: now - 59_500 + t * 1000, turnId, name: 'b', toolUseId: `tu-b-${t}`, parentToolUseId: tuA });
    }

    const ego = getMetaFlowEgo(db.instance, {
      centerType: 'skill', centerName: 'a',
      project: 'flow-test-project', windowDays: 7,
    });

    expect(ego.center.turns).toBe(3);
    const b = ego.callTree.nodes.find(n => n.name === 'b' && n.timeline === null);
    expect(b).toBeDefined();
    expect(b!.count).toBe(3);
    expect(b!.pct).toBeCloseTo(1.0, 5);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 17) centerInvocations vs centerTurns — 같은 turn 안 다중 호출 시 두 값 분리
  // ──────────────────────────────────────────────────────────────────────────
  it('centerInvocations — 같은 turn 안 2회 호출이면 turns=1 이지만 invocations=2', () => {
    seedCatalog(db.instance, 'skill', 'gchat', now);

    // turn-17a 에서 gchat 1회, turn-17b 에서 gchat 2회 호출 → turns=2, invocations=3.
    seedSkill(db.instance, {
      id: 't17-a', sessionId, ts: now - 60_000, turnId: 'turn-17a',
      name: 'gchat', toolUseId: 'tu-17a',
    });
    seedSkill(db.instance, {
      id: 't17-b1', sessionId, ts: now - 50_000, turnId: 'turn-17b',
      name: 'gchat', toolUseId: 'tu-17b1',
    });
    seedSkill(db.instance, {
      id: 't17-b2', sessionId, ts: now - 49_000, turnId: 'turn-17b',
      name: 'gchat', toolUseId: 'tu-17b2',
    });

    const ego = getMetaFlowEgo(db.instance, {
      centerType: 'skill', centerName: 'gchat',
      project: 'flow-test-project', windowDays: 7,
    });

    expect(ego.center.turns).toBe(2);
    expect(ego.center.invocations).toBe(3);
  });
});
