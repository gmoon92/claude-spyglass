/**
 * T9 — backfill-subagent-parents 권위(transcript) 재도출 마이그레이션 테스트.
 *
 * 검증:
 *  (1) NULL → 정확   : parent NULL 자식을 sub-transcript 권위값으로 채움.
 *  (2) 오귀속 → 정확  : 틀린 형제 Agent(A) 가 parent 로 박힌 자식을 권위값(B)으로 교정.
 *  (3) transcript 없음 → skip : sub-transcript 파일 부재면 그 행은 건드리지 않음(graceful).
 *  (4) idempotent    : 2회 실행 시 2회차 updated=0.
 *
 * 라이브 DB 미접근 — 임시 SQLite + 임시 sub-transcript JSONL 픽스처만 사용한다.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpyglassDatabase, createSession, createRequest, createEvent } from '@spyglass/storage';
import { runBackfill } from '../backfill-subagent-parents';

let workDir: string;
let dbPath: string;
let db: SpyglassDatabase;
let sessionId: string;

/** <workDir>/<session>.jsonl 메인 transcript 경로 — claude_events.transcript_path 로 등록. */
function mainTranscriptPath(): string {
  return join(workDir, `${sessionId}.jsonl`);
}

/** 서브 transcript 경로: <workDir>/<session>/subagents/agent-<agentId>.jsonl */
function subTranscriptPath(agentId: string): string {
  return join(workDir, sessionId, 'subagents', `agent-${agentId}.jsonl`);
}

/** 임시 sub-transcript JSONL 작성 — content[] 에 tool_use 블록 나열. */
function writeSubTranscript(
  agentId: string,
  toolUses: Array<{ id: string; name: string; ts: number }>,
): void {
  const p = subTranscriptPath(agentId);
  mkdirSync(join(workDir, sessionId, 'subagents'), { recursive: true });
  const lines = toolUses.map((t) => JSON.stringify({
    type: 'assistant',
    timestamp: new Date(t.ts).toISOString(),
    message: {
      model: 'claude-sonnet',
      usage: { input_tokens: 0, output_tokens: 0 },
      content: [{ type: 'tool_use', id: t.id, name: t.name, input: { command: 'ls' } }],
    },
  }));
  writeFileSync(p, lines.join('\n'), 'utf-8');
}

/** Agent 행 INSERT — payload 에 tool_response.agentId 를 넣어 폴백 매핑이 가능하게. */
function insertAgent(opts: {
  id: string; toolUseId: string; agentType: string; agentId: string; timestamp: number;
}): void {
  createRequest(db.instance, {
    id: opts.id,
    session_id: sessionId,
    timestamp: opts.timestamp,
    type: 'tool_call',
    tool_name: 'Agent',
    tool_detail: opts.agentType,
    tokens_input: 0,
    tokens_output: 0,
    tokens_total: 0,
    duration_ms: 0,
    payload: JSON.stringify({ tool_name: 'Agent', tool_response: { agentId: opts.agentId } }),
    source: 'claude-code-hook',
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    tool_use_id: opts.toolUseId,
    event_type: 'tool',
    tokens_confidence: 'high',
    tokens_source: 'transcript',
  });
}

/** 서브에이전트 자식 도구 행 INSERT (라이브 hook 으로 들어온 모사). */
function insertChild(opts: {
  id: string; toolUseId: string; agentId: string; agentType: string;
  timestamp: number; parentToolUseId?: string | null; toolName?: string;
}): void {
  createRequest(db.instance, {
    id: opts.id,
    session_id: sessionId,
    timestamp: opts.timestamp,
    type: 'tool_call',
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
    tool_use_id: opts.toolUseId,
    event_type: 'tool',
    tokens_confidence: 'high',
    tokens_source: 'transcript',
    parent_tool_use_id: opts.parentToolUseId ?? null,
    agent_id: opts.agentId,
    agent_type: opts.agentType,
  });
}

/** claude_events 에 메인 transcript_path 를 등록(경로 해석용). */
function registerTranscriptPath(): void {
  createEvent(db.instance, {
    event_id: `evt-${crypto.randomUUID()}`,
    event_type: 'PostToolUse',
    session_id: sessionId,
    transcript_path: mainTranscriptPath(),
    timestamp: Date.now(),
    payload: '{}',
  });
}

function getParent(toolUseId: string): string | null {
  const row = db.instance.query(
    'SELECT parent_tool_use_id FROM requests WHERE tool_use_id = ? LIMIT 1',
  ).get(toolUseId) as { parent_tool_use_id: string | null } | null;
  return row?.parent_tool_use_id ?? null;
}

function countOutbox(eventId: string): number {
  const row = db.instance.query(
    "SELECT COUNT(*) AS c FROM kuzu_outbox WHERE source='requests' AND event_id=? AND op='update'",
  ).get(eventId) as { c: number };
  return row.c;
}

describe('T9 — backfill-subagent-parents 권위 재도출', () => {
  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'spyglass-backfill-'));
    dbPath = join(workDir, 'test.db');
    db = new SpyglassDatabase({ dbPath, autoInit: true });
    sessionId = crypto.randomUUID();
    createSession(db.instance, {
      id: sessionId, project_name: 'backfill-test', started_at: Date.now() - 60_000,
    });
    registerTranscriptPath();
  });

  afterEach(() => {
    try { db.close(); } catch {}
    try { rmSync(workDir, { recursive: true, force: true }); } catch {}
  });

  it('(1) NULL → 권위값으로 채움 (Skill 직속 부모)', () => {
    // sub-transcript: Skill S, 그 다음 Bash Y (rolling parent = S).
    writeSubTranscript('ag1', [
      { id: 'S', name: 'Skill', ts: Date.now() - 5000 },
      { id: 'Y', name: 'Bash', ts: Date.now() - 4000 },
    ]);
    insertChild({
      id: 'c-Y', toolUseId: 'Y', agentId: 'ag1', agentType: 'pm',
      timestamp: Date.now() - 4000, parentToolUseId: null,
    });
    expect(getParent('Y')).toBeNull();

    const res = runBackfill(db.instance, { dryRun: false, limit: null });
    expect(getParent('Y')).toBe('S');
    expect(res.updated).toBe(1);
    expect(countOutbox('c-Y')).toBeGreaterThanOrEqual(1);
  });

  it('(2) 오귀속(A) → 권위값(B) 으로 교정 (Agent 폴백)', () => {
    // 동일타입 Agent A(부모 아님) + B(진짜 부모, agentId='agB').
    insertAgent({ id: 'a-A', toolUseId: 'A', agentType: 'Explore', agentId: 'agA', timestamp: Date.now() - 8000 });
    insertAgent({ id: 'a-B', toolUseId: 'B', agentType: 'Explore', agentId: 'agB', timestamp: Date.now() - 7000 });
    // B 의 sub-transcript: Bash Y 만(Skill 없음 → parentToolUseId null → Agent 폴백).
    writeSubTranscript('agB', [{ id: 'Y', name: 'Bash', ts: Date.now() - 6000 }]);
    // 자식 Y 는 agentId='agB' 인데 *틀린* parent='A' 로 오귀속돼 있다.
    insertChild({
      id: 'c-Y', toolUseId: 'Y', agentId: 'agB', agentType: 'Explore',
      timestamp: Date.now() - 6000, parentToolUseId: 'A',
    });
    expect(getParent('Y')).toBe('A');

    const res = runBackfill(db.instance, { dryRun: false, limit: null });
    expect(getParent('Y')).toBe('B');
    expect(res.updated).toBe(1);
    expect(countOutbox('c-Y')).toBeGreaterThanOrEqual(1);
  });

  it('(3) transcript 없음 → graceful skip (행 미변경)', () => {
    // sub-transcript 파일을 만들지 않는다.
    insertChild({
      id: 'c-W', toolUseId: 'W', agentId: 'agMissing', agentType: 'pm',
      timestamp: Date.now() - 4000, parentToolUseId: null,
    });
    const res = runBackfill(db.instance, { dryRun: false, limit: null });
    expect(getParent('W')).toBeNull();
    expect(res.updated).toBe(0);
    expect(res.skippedNoTranscript).toBeGreaterThanOrEqual(1);
  });

  it('(4) idempotent — 2회 실행 시 2회차 updated=0', () => {
    writeSubTranscript('ag1', [
      { id: 'S', name: 'Skill', ts: Date.now() - 5000 },
      { id: 'Y', name: 'Bash', ts: Date.now() - 4000 },
    ]);
    insertChild({
      id: 'c-Y', toolUseId: 'Y', agentId: 'ag1', agentType: 'pm',
      timestamp: Date.now() - 4000, parentToolUseId: null,
    });
    const r1 = runBackfill(db.instance, { dryRun: false, limit: null });
    expect(getParent('Y')).toBe('S');
    expect(r1.updated).toBe(1);

    const r2 = runBackfill(db.instance, { dryRun: false, limit: null });
    expect(getParent('Y')).toBe('S');
    expect(r2.updated).toBe(0);
  });

  it('(5) dry-run — 카운트만, 미변경', () => {
    writeSubTranscript('ag1', [
      { id: 'S', name: 'Skill', ts: Date.now() - 5000 },
      { id: 'Y', name: 'Bash', ts: Date.now() - 4000 },
    ]);
    insertChild({
      id: 'c-Y', toolUseId: 'Y', agentId: 'ag1', agentType: 'pm',
      timestamp: Date.now() - 4000, parentToolUseId: null,
    });
    const res = runBackfill(db.instance, { dryRun: true, limit: null });
    // dry-run 은 would-update 만 집계하고 실제 UPDATE/outbox 는 하지 않는다.
    expect(getParent('Y')).toBeNull();
    expect(res.wouldUpdate).toBe(1);
    expect(res.updated).toBe(0);
    expect(countOutbox('c-Y')).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T10 다양화 — 실 유입 데이터 형태(shape) 재현. toolu_test* 합성 id + agent_id 별
  //   sub-transcript 픽스처. 실 경로/세션UUID/장문 toolu/실프롬프트 미사용.
  // ─────────────────────────────────────────────────────────────────────────

  it('(6) 여러 agent_id 혼재 — 한 run 에서 각 자식이 자기 transcript 권위로 정확 귀속(형제 오염 0)', () => {
    // 동일타입(Explore) Agent 2개가 서로 다른 agent_id 로 병렬. 각 자식은 *자기* agent_id
    //   sub-transcript 권위로 귀속돼야 한다 — agent_id 로 인스턴스를 정확히 분간.
    const A = 'toolu_testMixA';
    const B = 'toolu_testMixB';
    insertAgent({ id: 'a-A', toolUseId: A, agentType: 'Explore', agentId: 'agMixA', timestamp: Date.now() - 9000 });
    insertAgent({ id: 'a-B', toolUseId: B, agentType: 'Explore', agentId: 'agMixB', timestamp: Date.now() - 8000 });
    // 각 인스턴스 sub-transcript: Skill 없음 → Agent 폴백(자기 Agent tool_use_id).
    writeSubTranscript('agMixA', [{ id: 'toolu_testMixYA', name: 'Bash', ts: Date.now() - 7000 }]);
    writeSubTranscript('agMixB', [{ id: 'toolu_testMixYB', name: 'Read', ts: Date.now() - 6000 }]);
    // 두 자식 모두 *틀린* 형제로 오귀속(YA→B, YB→A) 상태로 적재 → 교정 대상.
    insertChild({
      id: 'c-YA', toolUseId: 'toolu_testMixYA', agentId: 'agMixA', agentType: 'Explore',
      timestamp: Date.now() - 7000, parentToolUseId: B,
    });
    insertChild({
      id: 'c-YB', toolUseId: 'toolu_testMixYB', agentId: 'agMixB', agentType: 'Explore',
      timestamp: Date.now() - 6000, parentToolUseId: A, toolName: 'Read',
    });
    expect(getParent('toolu_testMixYA')).toBe(B);
    expect(getParent('toolu_testMixYB')).toBe(A);

    const res = runBackfill(db.instance, { dryRun: false, limit: null });
    // 각자 자기 agent_id transcript 권위로 정확 교정 — 형제 오염 0.
    expect(getParent('toolu_testMixYA')).toBe(A);
    expect(getParent('toolu_testMixYB')).toBe(B);
    expect(res.updated).toBe(2);
    expect(countOutbox('c-YA')).toBeGreaterThanOrEqual(1);
    expect(countOutbox('c-YB')).toBeGreaterThanOrEqual(1);
  });

  it('(7) PostToolUseFailure 자식 — 실패 도구(agent_id 보유)도 후보로 잡혀 권위 교정', () => {
    // 실패한 도구도 sub-transcript 에 tool_use 블록으로 남고 agent_id 를 보유한다.
    //   parent NULL 로 적재된 실패 자식이 권위값으로 채워져야 한다(누락 없음).
    insertAgent({ id: 'a-A', toolUseId: 'toolu_testFailA', agentType: 'backend-agent', agentId: 'agFail', timestamp: Date.now() - 8000 });
    writeSubTranscript('agFail', [{ id: 'toolu_testFailY', name: 'Bash', ts: Date.now() - 6000 }]);
    insertChild({
      id: 'c-fail', toolUseId: 'toolu_testFailY', agentId: 'agFail', agentType: 'backend-agent',
      timestamp: Date.now() - 6000, parentToolUseId: null,
    });
    expect(getParent('toolu_testFailY')).toBeNull();

    const res = runBackfill(db.instance, { dryRun: false, limit: null });
    expect(getParent('toolu_testFailY')).toBe('toolu_testFailA');
    expect(res.updated).toBe(1);
  });
});
