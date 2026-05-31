/**
 * T8 Prevention 가드 — 라이브 rolling-parent 추측 보류.
 *
 * 목적:
 *  saveRequest 의 rolling-parent 2순위(매칭 Agent) 추측은, 같은 (session,turn) 에 동일
 *  agent_type 인 Agent 인스턴스가 2개 이상이면 *어느 Agent 가 진짜 부모인지 알 수 없다*.
 *  기존 동작은 timestamp DESC 로 "가장 가까운 완료 Agent" 를 무조건 부모로 채워 G5 오귀속을
 *  유발했다. 본 가드는 그 모호 상황에서 추측을 *보류*(parent NULL 유지)하고, 권위 transcript
 *  백필(persistSubagentChildren)에 위임한다 — "모호하면 틀리게 쓰지 않는다".
 *
 * 단일 Agent 인스턴스일 때만 추측을 채택한다(기존 정상 동작 보존).
 *
 * 본 파일은 *라이브 추측* 동작(saveRequest)만 검증한다. 권위 교정(persistSubagentChildren)의
 * 독립 보장은 subagent-sibling-parent.regression.test.ts 가 담당한다.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SpyglassDatabase, createSession } from '@spyglass/storage';
import { saveRequest, persistSubagentChildren } from '../persist';
import type { NormalizedHookPayload } from '../types';

const SUFFIX = `${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
const TEST_DB_PATH = `/tmp/spyglass-parent-guard-${SUFFIX}.db`;

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
    project_name: 'guard-test',
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

/** 서브에이전트 *내부* 도구 호출이 메인 hook 으로 들어온 라이브 행을 모사. */
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
    project_name: 'guard-test',
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

function getParent(db: SpyglassDatabase, toolUseId: string): string | null {
  const row = db.instance.query(
    'SELECT parent_tool_use_id FROM requests WHERE tool_use_id = ? LIMIT 1',
  ).get(toolUseId) as { parent_tool_use_id: string | null } | null;
  return row?.parent_tool_use_id ?? null;
}

describe('T8 Prevention 가드 — 모호 시 라이브 부모추측 보류', () => {
  let db: SpyglassDatabase;
  let sessionId: string;
  let turnId: string;
  const now = Date.now() - 60_000;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
    sessionId = crypto.randomUUID();
    createSession(db.instance, {
      id: sessionId,
      project_name: 'guard-test',
      started_at: now - 30_000,
    });
    saveRequest(db.instance, {
      id: 'prompt-1',
      session_id: sessionId,
      project_name: 'guard-test',
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

  it('모호 — 같은 turn 동일타입 Agent 2개 → 자식 부모추측 보류(NULL)', () => {
    saveRequest(db.instance, makeAgent({
      id: 'agent-A', sessionId, toolUseId: 'A', agentType: 'Explore',
      timestamp: now + 1000, eventType: 'tool',
    }));
    saveRequest(db.instance, makeAgent({
      id: 'agent-B', sessionId, toolUseId: 'B', agentType: 'Explore',
      timestamp: now + 2000, eventType: 'pre_tool',
    }));
    // 자식 Y — 동일타입 형제 2개라 어느 Agent 가 부모인지 모호 → 추측 보류.
    saveRequest(db.instance, makeChildLiveHook({
      id: 'child-Y', sessionId, toolUseId: 'Y', agentType: 'Explore',
      timestamp: now + 3000,
    }));
    expect(getParent(db, 'Y')).toBeNull();
  });

  it('단일 — 같은 turn 동일타입 Agent 1개 → 자식 부모추측 채택', () => {
    saveRequest(db.instance, makeAgent({
      id: 'agent-A', sessionId, toolUseId: 'A', agentType: 'Explore',
      timestamp: now + 1000, eventType: 'tool',
    }));
    saveRequest(db.instance, makeChildLiveHook({
      id: 'child-X', sessionId, toolUseId: 'X', agentType: 'Explore',
      timestamp: now + 2000,
    }));
    expect(getParent(db, 'X')).toBe('A');
  });

  it('보류된 NULL 은 이후 권위 백필로 정확한 B 가 된다', () => {
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
    // 보류 → NULL.
    expect(getParent(db, 'Y')).toBeNull();

    // 권위(B 의 sub-transcript)에서 Y 추출 → context.parentToolUseId='B'.
    const res = persistSubagentChildren(
      db.instance,
      [{
        toolUseId: 'Y',
        toolName: 'Bash',
        toolInput: { command: 'ls' },
        timestampMs: now + 3000,
        model: 'claude-sonnet',
        tokensInput: 0,
        tokensOutput: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        parentToolUseId: null,
      }],
      { parentToolUseId: 'B', sessionId, turnId },
    );
    expect(getParent(db, 'Y')).toBe('B');
    expect(res.backfilled).toBe(1);
    expect(res.inserted).toBe(0);
  });

  it('무회귀 — 1순위 직전 Skill 부모는 모호 가드와 무관하게 채택', () => {
    // 동일타입 Agent 2개(모호)지만, 직전 Skill 행이 있으면 1순위 경로로 Skill 부모를 잡는다.
    saveRequest(db.instance, makeAgent({
      id: 'agent-A', sessionId, toolUseId: 'A', agentType: 'pm',
      timestamp: now + 1000, eventType: 'tool',
    }));
    saveRequest(db.instance, makeAgent({
      id: 'agent-B', sessionId, toolUseId: 'B', agentType: 'pm',
      timestamp: now + 1500, eventType: 'pre_tool',
    }));
    // 서브 내부 Skill 행 S (agent_type='pm').
    saveRequest(db.instance, makeChildLiveHook({
      id: 'child-S', sessionId, toolUseId: 'S', agentType: 'pm',
      timestamp: now + 2000, toolName: 'Skill',
    }));
    // 일반 도구 T — 직전 Skill S 가 1순위 부모.
    saveRequest(db.instance, makeChildLiveHook({
      id: 'child-T', sessionId, toolUseId: 'T', agentType: 'pm',
      timestamp: now + 3000,
    }));
    expect(getParent(db, 'T')).toBe('S');
  });
});
