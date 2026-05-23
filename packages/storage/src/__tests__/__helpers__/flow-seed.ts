/**
 * Flow Pattern 테스트 공용 헬퍼 (structured-coalescing-feather Plan §2.1).
 *
 * 책임:
 *  - strong-unique DB path (Date.now + pid + uuid) — 같은 ms 충돌 방지.
 *  - 모듈 싱글톤 회피 — closeDatabase() 미사용, 인스턴스 close 만.
 *  - 5가지 토폴로지 패턴 시드를 한 줄로 표현 (chain()).
 *
 * 참고: 기존 meta-document-flow.test.ts:42-125 의 seedSkill/seedAgent/seedMcp 가
 *       4개 테스트 파일에 중복 정의되어 있어 공용 헬퍼로 분리한다.
 */

import type { Database } from 'bun:sqlite';
import {
  SpyglassDatabase,
  createSession,
  createRequest,
  upsertMetaDocument,
} from '../../index';

export interface FlowSeedHandle {
  db: SpyglassDatabase;
  inst: Database;
  sessionId: string;
  project: string;
  now: number;
  cleanup: () => void;
}

/** strong-unique DB path 와 세션 1개를 자동 시드 한 핸들.
 *
 *  주의: ctx.now 는 "chain 시드 기준 시각" 이며 실제 wall clock 보다 의도적으로 1분 과거.
 *  - chain() 이 ts = ctx.now + idx*1000 으로 단조 증가시켜도 ego 호출 시점의 Date.now()
 *    (=ego 의 toTs 기본값) 보다 항상 작도록 안전 마진을 둔다.
 *  - 같은 ctx 안에서 시드되는 모든 row 가 같은 windowDays 7 범위 안에 들어간다. */
export function makeFlowDb(opts?: { project?: string }): FlowSeedHandle {
  const suffix = `${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  const dbPath = `/tmp/spyglass-flow-${suffix}.db`;
  const db = new SpyglassDatabase({ dbPath, autoInit: true });
  const sessionId = crypto.randomUUID();
  const project = opts?.project ?? 'flow-pattern-test';
  const now = Date.now() - 60_000;
  createSession(db.instance, {
    id: sessionId,
    project_name: project,
    started_at: now - 60_000,
  });
  return {
    db,
    inst: db.instance,
    sessionId,
    project,
    now,
    cleanup() {
      try { db.close(); } catch {}
      try { require('fs').unlinkSync(dbPath); } catch {}
    },
  };
}

/** Skill/Agent 카탈로그 등록 (BFS 화이트리스트 통과 조건). */
export function seedCatalog(
  inst: Database,
  type: 'skill' | 'agent',
  name: string,
  seenAt: number,
): void {
  upsertMetaDocument(inst, {
    type,
    name,
    source: 'userSettings',
    source_root: '/home/user/.claude',
    file_path: `/home/user/.claude/${type}s/${name}.md`,
    description: `${name} ${type}`,
    user_invocable: type === 'skill',
    frontmatter_json: null,
    seen_at: seenAt,
  });
}

export interface SeedRowArgs {
  id: string;
  sessionId: string;
  ts: number;
  turnId: string;
  name: string;
  toolUseId?: string;
  parentToolUseId?: string | null;
}

export function seedSkill(inst: Database, args: SeedRowArgs): void {
  createRequest(inst, {
    id: args.id,
    session_id: args.sessionId,
    timestamp: args.ts,
    type: 'tool_call',
    tool_name: 'Skill',
    tool_detail: args.name,
    turn_id: args.turnId,
    tool_use_id: args.toolUseId,
    parent_tool_use_id: args.parentToolUseId ?? null,
    event_type: 'tool',
    tokens_input: 0, tokens_output: 0, tokens_total: 0,
  });
}

export function seedAgent(inst: Database, args: SeedRowArgs): void {
  createRequest(inst, {
    id: args.id,
    session_id: args.sessionId,
    timestamp: args.ts,
    type: 'tool_call',
    tool_name: 'Agent',
    tool_detail: args.name,
    turn_id: args.turnId,
    tool_use_id: args.toolUseId,
    parent_tool_use_id: args.parentToolUseId ?? null,
    event_type: 'tool',
    agent_type: args.name,
    tokens_input: 0, tokens_output: 0, tokens_total: 0,
  });
}

export function seedMcp(inst: Database, args: SeedRowArgs & { toolName: string }): void {
  createRequest(inst, {
    id: args.id,
    session_id: args.sessionId,
    timestamp: args.ts,
    type: 'tool_call',
    tool_name: args.toolName,
    turn_id: args.turnId,
    tool_use_id: args.toolUseId,
    parent_tool_use_id: args.parentToolUseId ?? null,
    event_type: 'tool',
    tokens_input: 0, tokens_output: 0, tokens_total: 0,
  });
}

export function seedBuiltin(inst: Database, args: SeedRowArgs & { toolName: string }): void {
  createRequest(inst, {
    id: args.id,
    session_id: args.sessionId,
    timestamp: args.ts,
    type: 'tool_call',
    tool_name: args.toolName,
    turn_id: args.turnId,
    tool_use_id: args.toolUseId,
    parent_tool_use_id: args.parentToolUseId ?? null,
    event_type: 'tool',
    tokens_input: 0, tokens_output: 0, tokens_total: 0,
  });
}

export type ChainNodeKind = 'skill' | 'agent' | 'mcp' | 'builtin';

export interface ChainRow {
  kind: ChainNodeKind;
  /** kind='mcp' 면 'mcp__server__tool', kind='builtin' 면 'TaskCreate' 같은 도구명, 그 외엔 catalog name. */
  name: string;
  toolUseId?: string;
  /** parent tool_use_id. 명시되지 않으면 직전 row 의 toolUseId 가 자동 부모. null 명시 시 root. */
  parent?: string | null;
  /** ts offset (ms). 미지정 시 row index × 1000. 같은 turn 안 단조 증가 보장. */
  tsOffset?: number;
}

/**
 * turn 안 호출 트리를 한 줄로 시드 — 5개 패턴 케이스가 시드 5~10줄로 줄어든다.
 *
 *  - parent 미지정: 직전 row 의 toolUseId 를 부모로 사용. 첫 row 의 parent 는 null.
 *  - parent='STR': 명시된 부모 tool_use_id (외부 turn 의 노드 참조 가능).
 *  - parent=null: root (parent_tool_use_id = null).
 *  - toolUseId 미지정: 자동 생성.
 */
export function chain(
  turnId: string,
  rows: ReadonlyArray<ChainRow>,
  ctx: FlowSeedHandle,
): void {
  let prevToolUseId: string | undefined = undefined;
  rows.forEach((row, idx) => {
    const toolUseId = row.toolUseId ?? `tu-${turnId}-${idx}-${crypto.randomUUID().slice(0, 6)}`;
    const ts = ctx.now + (row.tsOffset ?? idx * 1000);
    // parent 결정: 명시 있으면 그것을 우선 (null 포함), 없으면 직전 row.
    const parent: string | null | undefined = ('parent' in row)
      ? row.parent
      : prevToolUseId;
    const id = `r-${turnId}-${idx}-${crypto.randomUUID().slice(0, 6)}`;

    const args: SeedRowArgs = {
      id,
      sessionId: ctx.sessionId,
      ts,
      turnId,
      name: row.name,
      toolUseId,
      parentToolUseId: parent ?? null,
    };

    switch (row.kind) {
      case 'skill': seedSkill(ctx.inst, args); break;
      case 'agent': seedAgent(ctx.inst, args); break;
      case 'mcp': seedMcp(ctx.inst, { ...args, toolName: row.name }); break;
      case 'builtin': seedBuiltin(ctx.inst, { ...args, toolName: row.name }); break;
    }
    prevToolUseId = toolUseId;
  });
}
