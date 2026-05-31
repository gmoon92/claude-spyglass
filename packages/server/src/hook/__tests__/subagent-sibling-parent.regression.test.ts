/**
 * G5 회귀 — 같은 turn에 동일 타입 서브에이전트 형제(예: Explore 2개)가 있을 때의 부모 오귀속.
 *
 * 버그(근본 원인):
 *  - saveRequest 의 rolling-parent 2순위 Agent 매칭은 자식 hook 도착 시점에 *완료된*
 *    Agent(event_type='tool')만 후보로 본다. 나중 Agent B 가 아직 pre_tool 이면 후보에서
 *    빠지고, 먼저 끝난 형제 A 가 부모로 선택된다 → B 의 자식이 A 로 오귀속.
 *  - persistSubagentChildren 은 기존 행의 parent 가 NULL/빈값일 때만 백필했으므로,
 *    라이브 추측이 넣은 *틀린 non-NULL*(A) 는 영구 잔존 → 교정 불가.
 *
 * 권위적 근거:
 *  - persistSubagentChildren 의 children 은 *그 Agent 인스턴스의 sub-transcript* 에서
 *    추출되어 호출되고, context.parentToolUseId = 그 Agent 의 정확한 tool_use_id 다.
 *    따라서 resolvedParentToolUseId = child.parentToolUseId ?? context.parentToolUseId 는
 *    transcript 기반 ground truth → 기존 행이 다르면 권위값으로 교정해야 한다.
 *
 * 본 테스트는 saveRequest(라이브 추측) + persistSubagentChildren(권위 교정)을 직접 호출해
 * 메인 케이스(오귀속→교정)와 무회귀(단일·깊이3 보존·NULL 백필·멱등)를 검증한다.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { SpyglassDatabase, createSession } from '@spyglass/storage';
import { saveRequest, persistSubagentChildren } from '../persist';
import type { NormalizedHookPayload, SubagentChildToolCall } from '../types';

const SUFFIX = `${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
const TEST_DB_PATH = `/tmp/spyglass-sibling-parent-${SUFFIX}.db`;

/** Agent 행 1건을 INSERT 한다 (event_type 으로 완료/진행중 모사). */
function makeAgent(opts: {
  id: string;
  sessionId: string;
  toolUseId: string;
  agentType: string;
  timestamp: number;
  eventType: 'pre_tool' | 'tool';
}): NormalizedHookPayload {
  return {
    id: opts.id,
    session_id: opts.sessionId,
    project_name: 'sibling-test',
    timestamp: opts.timestamp,
    event_type: opts.eventType,
    request_type: 'tool_call',
    tool_name: 'Agent',
    tool_detail: opts.agentType,
    tokens_input: 0,
    tokens_output: 0,
    tokens_total: 0,
    duration_ms: 0,
    payload: JSON.stringify({ tool_use_id: opts.toolUseId, agent_type: opts.agentType }),
    source: 'test',
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    tokens_confidence: 'high',
    tokens_source: 'transcript',
  };
}

/**
 * 서브에이전트 *내부* 도구 호출이 메인 hook 으로 들어온 라이브 행을 모사.
 * agent_type 라벨만 있고 parent_tool_use_id 는 없다 → saveRequest 가 rolling-parent 로 추측.
 */
function makeChildLiveHook(opts: {
  id: string;
  sessionId: string;
  toolUseId: string;
  agentType: string;
  timestamp: number;
  toolName?: string;
}): NormalizedHookPayload {
  return {
    id: opts.id,
    session_id: opts.sessionId,
    project_name: 'sibling-test',
    timestamp: opts.timestamp,
    event_type: 'tool',
    request_type: 'tool_call',
    tool_name: opts.toolName ?? 'Bash',
    tool_detail: 'ls',
    tokens_input: 0,
    tokens_output: 0,
    tokens_total: 0,
    duration_ms: 0,
    payload: JSON.stringify({ tool_use_id: opts.toolUseId }),
    source: 'claude-code-hook',
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    tokens_confidence: 'high',
    tokens_source: 'transcript',
    agent_type: opts.agentType,
  };
}

/** transcript 추출 결과(권위) — persistSubagentChildren 입력. */
function makeChildCall(opts: {
  toolUseId: string;
  timestampMs: number;
  toolName?: string;
  parentToolUseId?: string | null;
}): SubagentChildToolCall {
  return {
    toolUseId: opts.toolUseId,
    toolName: opts.toolName ?? 'Bash',
    toolInput: { command: 'ls' },
    timestampMs: opts.timestampMs,
    model: 'claude-sonnet',
    tokensInput: 0,
    tokensOutput: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    parentToolUseId: opts.parentToolUseId ?? null,
  };
}

function getParent(inst: Database, toolUseId: string): string | null {
  const row = inst.query(
    'SELECT parent_tool_use_id FROM requests WHERE tool_use_id = ? LIMIT 1',
  ).get(toolUseId) as { parent_tool_use_id: string | null } | null;
  return row?.parent_tool_use_id ?? null;
}

function countOutboxFor(inst: Database, eventId: string): number {
  const row = inst.query(
    "SELECT COUNT(*) AS c FROM kuzu_outbox WHERE source = 'requests' AND event_id = ? AND op = 'update'",
  ).get(eventId) as { c: number };
  return row.c;
}

describe('G5 회귀 — 형제 서브에이전트 부모 오귀속 권위 교정', () => {
  let db: SpyglassDatabase;
  let sessionId: string;
  let turnId: string;
  const now = Date.now() - 60_000;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
    sessionId = crypto.randomUUID();
    createSession(db.instance, {
      id: sessionId,
      project_name: 'sibling-test',
      started_at: now - 30_000,
    });
    // turn 채번: prompt 1건으로 같은 turn 에 모든 행을 묶는다.
    saveRequest(db.instance, {
      id: 'prompt-1',
      session_id: sessionId,
      project_name: 'sibling-test',
      timestamp: now,
      event_type: 'prompt',
      request_type: 'prompt',
      tokens_input: 0,
      tokens_output: 0,
      tokens_total: 0,
      source: 'test',
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      payload: JSON.stringify({ prompt: 'hi' }),
    });
    const row = db.instance.query(
      "SELECT turn_id FROM requests WHERE session_id = ? AND type = 'prompt' LIMIT 1",
    ).get(sessionId) as { turn_id: string };
    turnId = row.turn_id;
  });

  afterEach(() => {
    try { db.close(); } catch {}
    try { require('fs').unlinkSync(TEST_DB_PATH); } catch {}
  });

  it('메인 케이스 — 모호 시 라이브 보류(NULL) 후 권위값(B)으로 백필', () => {
    // A: 먼저 완료된 Explore (event_type='tool')
    saveRequest(db.instance, makeAgent({
      id: 'agent-A', sessionId, toolUseId: 'A', agentType: 'Explore',
      timestamp: now + 1000, eventType: 'tool',
    }));
    // B: 나중 Explore — 아직 진행중(pre_tool)
    saveRequest(db.instance, makeAgent({
      id: 'agent-B', sessionId, toolUseId: 'B', agentType: 'Explore',
      timestamp: now + 2000, eventType: 'pre_tool',
    }));

    // 자식 Y(B 의 내부 도구)가 메인 hook 으로 들어옴 → rolling-parent 추측 시도.
    saveRequest(db.instance, makeChildLiveHook({
      id: 'child-Y', sessionId, toolUseId: 'Y', agentType: 'Explore',
      timestamp: now + 3000,
    }));

    // [동작 변경 — T8 prevention 가드] 과거에는 B 가 pre_tool 이라 2순위 후보에서 빠지고
    // 완료된 형제 A 가 부모로 *오귀속*(toBe('A'))됐다. 이제 같은 (session,turn) 에 동일타입
    // Agent 인스턴스가 2개(A,B)면 라이브 추측을 *보류*(NULL)한다 — 틀린 형제로 쓰지 않기 위함.
    // 이는 회귀가 아니라 오귀속 방지를 위한 정당한 동작 개선이다. (라이브 추측이 만든 *non-NULL*
    // 오귀속의 교정 보장은 아래 '독립 correction' 테스트가 라이브 추측과 분리해 영구 커버한다.)
    expect(getParent(db.instance, 'Y')).toBeNull();

    // 권위 백필: B 의 sub-transcript 에서 Y 추출 → context.parentToolUseId='B'.
    const res = persistSubagentChildren(
      db.instance,
      [makeChildCall({ toolUseId: 'Y', timestampMs: now + 3000 })],
      { parentToolUseId: 'B', sessionId, turnId },
    );

    // 기대: 보류된 NULL 이 권위값 B 로 채워진다.
    expect(getParent(db.instance, 'Y')).toBe('B');
    expect(res.backfilled).toBe(1);
    expect(res.inserted).toBe(0);
    // 그래프 sync 를 위한 outbox update 발행 확인.
    const yId = (db.instance.query(
      'SELECT id FROM requests WHERE tool_use_id = ? LIMIT 1',
    ).get('Y') as { id: string }).id;
    expect(countOutboxFor(db.instance, yId)).toBeGreaterThanOrEqual(1);
  });

  it('독립 correction — 수동 주입된 *틀린 non-NULL*(A) 를 권위값(B)으로 덮어쓰기', () => {
    // 라이브 추측에 *의존하지 않고*, 이미 틀린 형제 A 로 오귀속된 행을 직접 주입해
    // persistSubagentChildren 의 non-NULL 교정 경로를 독립적으로 보장한다.
    // (T8 가드로 라이브 메인 케이스가 NULL→백필로 바뀌어도, non-NULL 오귀속 교정 보장은
    //  이 테스트가 항상 커버한다.)
    saveRequest(db.instance, makeAgent({
      id: 'agent-A', sessionId, toolUseId: 'A', agentType: 'Explore',
      timestamp: now + 1000, eventType: 'tool',
    }));
    saveRequest(db.instance, makeAgent({
      id: 'agent-B', sessionId, toolUseId: 'B', agentType: 'Explore',
      timestamp: now + 2000, eventType: 'tool',
    }));
    // 자식 Y 를 *직접* INSERT 하며 틀린 parent='A' 를 주입(라이브 추측 경로 우회).
    db.instance.run(
      `INSERT INTO requests
        (id, session_id, timestamp, type, tool_name, tool_detail, turn_id,
         tokens_input, tokens_output, tokens_total, duration_ms, payload, source,
         cache_creation_tokens, cache_read_tokens, tool_use_id, event_type,
         tokens_confidence, tokens_source, parent_tool_use_id, agent_type)
       VALUES
        (?, ?, ?, 'tool_call', 'Bash', 'ls', ?,
         0, 0, 0, 0, ?, 'claude-code-hook',
         0, 0, ?, 'tool',
         'high', 'transcript', ?, 'Explore')`,
      [
        'child-Y-manual', sessionId, now + 3000, turnId,
        JSON.stringify({ tool_use_id: 'Y' }), 'Y', 'A',
      ],
    );
    // 전제: 틀린 non-NULL 부모 A 가 주입됨.
    expect(getParent(db.instance, 'Y')).toBe('A');

    // 권위 교정: B 의 sub-transcript 에서 Y 추출 → context.parentToolUseId='B'.
    const res = persistSubagentChildren(
      db.instance,
      [makeChildCall({ toolUseId: 'Y', timestampMs: now + 3000 })],
      { parentToolUseId: 'B', sessionId, turnId },
    );
    // 기대: 틀린 A 가 권위값 B 로 덮어써진다(NULL 백필이 아니라 non-NULL 교정).
    expect(getParent(db.instance, 'Y')).toBe('B');
    expect(res.backfilled).toBe(1);
    expect(res.inserted).toBe(0);
    const yId = (db.instance.query(
      'SELECT id FROM requests WHERE tool_use_id = ? LIMIT 1',
    ).get('Y') as { id: string }).id;
    expect(countOutboxFor(db.instance, yId)).toBeGreaterThanOrEqual(1);
  });

  it('무회귀 ① — 단일 Explore + 자식: 부모 정확(교정 불필요, no-op)', () => {
    saveRequest(db.instance, makeAgent({
      id: 'agent-A', sessionId, toolUseId: 'A', agentType: 'Explore',
      timestamp: now + 1000, eventType: 'tool',
    }));
    saveRequest(db.instance, makeChildLiveHook({
      id: 'child-X', sessionId, toolUseId: 'X', agentType: 'Explore',
      timestamp: now + 2000,
    }));
    // 라이브 추측이 이미 정확히 A.
    expect(getParent(db.instance, 'X')).toBe('A');

    const res = persistSubagentChildren(
      db.instance,
      [makeChildCall({ toolUseId: 'X', timestampMs: now + 2000 })],
      { parentToolUseId: 'A', sessionId, turnId },
    );
    // resolved == existing → no-op 멱등.
    expect(getParent(db.instance, 'X')).toBe('A');
    expect(res.backfilled).toBe(0);
    expect(res.inserted).toBe(0);
  });

  it('무회귀 ② — child.parentToolUseId=Skill(깊이3) 보존', () => {
    // Agent A 완료, 그 내부에 Skill S 가 있고, S 의 자식 Z 가 깊이3.
    saveRequest(db.instance, makeAgent({
      id: 'agent-A', sessionId, toolUseId: 'A', agentType: 'pm',
      timestamp: now + 1000, eventType: 'tool',
    }));
    // 자식 Z 가 라이브 hook 으로 들어와 parent=A 로 추측됨(직전 Skill 행 없음).
    saveRequest(db.instance, makeChildLiveHook({
      id: 'child-Z', sessionId, toolUseId: 'Z', agentType: 'pm',
      timestamp: now + 3000,
    }));
    expect(getParent(db.instance, 'Z')).toBe('A');

    // 권위: transcript 는 Z 의 직속 부모가 Skill 'S' 임을 안다.
    const res = persistSubagentChildren(
      db.instance,
      [makeChildCall({ toolUseId: 'Z', timestampMs: now + 3000, parentToolUseId: 'S' })],
      { parentToolUseId: 'A', sessionId, turnId },
    );
    // 깊이3 보존: resolved = child.parentToolUseId = 'S' 로 교정.
    expect(getParent(db.instance, 'Z')).toBe('S');
    expect(res.backfilled).toBe(1);
  });

  it('무회귀 ③ — parent NULL → context 부모 백필', () => {
    // 자식 W 가 parent NULL 상태로 이미 적재(라이브 추측 미스).
    saveRequest(db.instance, makeChildLiveHook({
      id: 'child-W', sessionId, toolUseId: 'W', agentType: 'Explore',
      timestamp: now + 2000,
    }));
    // Agent 행이 없어 rolling-parent 가 매칭 실패 → parent NULL.
    expect(getParent(db.instance, 'W')).toBeNull();

    const res = persistSubagentChildren(
      db.instance,
      [makeChildCall({ toolUseId: 'W', timestampMs: now + 2000 })],
      { parentToolUseId: 'A', sessionId, turnId },
    );
    expect(getParent(db.instance, 'W')).toBe('A');
    expect(res.backfilled).toBe(1);
  });

  it('무회귀 ④ — persistSubagentChildren 2회 멱등', () => {
    saveRequest(db.instance, makeAgent({
      id: 'agent-A', sessionId, toolUseId: 'A', agentType: 'Explore',
      timestamp: now + 1000, eventType: 'tool',
    }));
    saveRequest(db.instance, makeAgent({
      id: 'agent-B', sessionId, toolUseId: 'B', agentType: 'Explore',
      timestamp: now + 2000, eventType: 'pre_tool',
    }));
    saveRequest(db.instance, makeChildLiveHook({
      id: 'child-Y', sessionId, toolUseId: 'Y', agentType: 'Explore',
      timestamp: now + 3000,
    }));

    const child = [makeChildCall({ toolUseId: 'Y', timestampMs: now + 3000 })];
    const r1 = persistSubagentChildren(db.instance, child, { parentToolUseId: 'B', sessionId, turnId });
    expect(getParent(db.instance, 'Y')).toBe('B');
    expect(r1.backfilled).toBe(1);

    // 2회차: 이미 B → resolved == existing → no-op.
    const r2 = persistSubagentChildren(db.instance, child, { parentToolUseId: 'B', sessionId, turnId });
    expect(getParent(db.instance, 'Y')).toBe('B');
    expect(r2.backfilled).toBe(0);
    expect(r2.inserted).toBe(0);

    // 행은 여전히 단일.
    const cnt = db.instance.query(
      'SELECT COUNT(*) AS c FROM requests WHERE tool_use_id = ?',
    ).get('Y') as { c: number };
    expect(cnt.c).toBe(1);
  });
});
