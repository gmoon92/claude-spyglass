/**
 * W-1 — pre_tool / post_tool 머지 race & 중복 시나리오
 * (structured-coalescing-feather Plan §10.1 P0-3 보강).
 *
 * 검증 목적:
 *  - 정상 순서 (pre → post) UPDATE 머지가 single row 결과.
 *  - PostToolUse 가 PreToolUse 보다 먼저 도착 (out-of-order) — pre 매칭 실패로 일반 INSERT 분기.
 *  - 동일 tool_use_id 의 중복 PreToolUse — 두 행이 별도로 INSERT (UNIQUE constraint 없음).
 *  - 중복 PostToolUse (이미 머지된 행 + 두 번째 post) — pre 매칭 실패 후 일반 INSERT.
 *
 * 본 테스트는 saveRequest 동작을 직접 호출해 시나리오별 결과 행 수와 event_type 정합성을 검증.
 * persist.ts 변경 시 머지 정책 회귀가 즉시 빨강.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type { Database } from 'bun:sqlite';
import {
  SpyglassDatabase,
  createSession,
} from '@spyglass/storage';
import { saveRequest } from '../persist';
import type { NormalizedHookPayload } from '../types';

/** ACTIVE_REQUEST_FILTER_SQL 우회 — 본 테스트는 pre_tool 행도 검증해야 함. */
function fetchAllRows(inst: Database, sessionId: string) {
  return inst.query(
    'SELECT id, event_type, tool_use_id, tokens_total, duration_ms FROM requests WHERE session_id = ? ORDER BY timestamp ASC',
  ).all(sessionId) as Array<{
    id: string;
    event_type: string | null;
    tool_use_id: string | null;
    tokens_total: number;
    duration_ms: number;
  }>;
}

const SUFFIX = `${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
const TEST_DB_PATH = `/tmp/spyglass-persist-race-${SUFFIX}.db`;

function makePayload(opts: Partial<NormalizedHookPayload> & {
  id: string;
  session_id: string;
  event_type: 'pre_tool' | 'tool';
  tool_use_id: string;
}): NormalizedHookPayload {
  return {
    id: opts.id,
    session_id: opts.session_id,
    project_name: opts.project_name ?? 'race-test',
    timestamp: opts.timestamp ?? Date.now(),
    event_type: opts.event_type,
    request_type: 'tool_call',
    tool_name: opts.tool_name ?? 'Bash',
    tool_detail: opts.tool_detail ?? 'ls',
    tokens_input: opts.tokens_input ?? 0,
    tokens_output: opts.tokens_output ?? 0,
    tokens_total: opts.tokens_total ?? 0,
    duration_ms: opts.duration_ms ?? 0,
    payload: JSON.stringify({ tool_use_id: opts.tool_use_id }),
    source: opts.source ?? 'test',
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    tokens_confidence: 'high',
    tokens_source: 'transcript',
  };
}

describe('persist W-1 — pre/post merge race & 중복', () => {
  let db: SpyglassDatabase;
  let sessionId: string;
  const now = Date.now() - 60_000;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
    sessionId = crypto.randomUUID();
    createSession(db.instance, {
      id: sessionId,
      project_name: 'race-test',
      started_at: now - 30_000,
    });
  });
  afterEach(() => {
    try { db.close(); } catch {}
    try { require('fs').unlinkSync(TEST_DB_PATH); } catch {}
  });

  it('정상 순서 — pre → post 머지: 행 1개, event_type=tool, savedId=pre 행', () => {
    const tuid = 'tu-race-normal';
    const pre = makePayload({
      id: 'pre-1', session_id: sessionId, event_type: 'pre_tool',
      tool_use_id: tuid, timestamp: now,
    });
    const post = makePayload({
      id: 'post-1', session_id: sessionId, event_type: 'tool',
      tool_use_id: tuid, timestamp: now + 1000,
      tokens_input: 10, tokens_output: 20, tokens_total: 30, duration_ms: 500,
    });

    const r1 = saveRequest(db.instance, pre);
    expect(r1.saved).toBe(true);
    expect(r1.wasUpsert).toBe(false);

    const r2 = saveRequest(db.instance, post);
    expect(r2.saved).toBe(true);
    expect(r2.wasUpsert).toBe(true);
    expect(r2.savedId).toBe('pre-1');

    const rows = fetchAllRows(db.instance, sessionId);
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('pre-1');
    expect(rows[0].event_type).toBe('tool');
    expect(rows[0].tokens_total).toBe(30);
    expect(rows[0].duration_ms).toBe(500);
  });

  it('out-of-order — post 먼저 도착: pre 매칭 NG → 일반 INSERT', () => {
    // PostToolUse 가 PreToolUse 보다 먼저 도착하는 race. 현재 동작은
    // "pre 매칭 실패 → fallthrough 일반 INSERT" 이고 이후 pre 가 와도 매칭이 안 된다.
    // 결과: 같은 tool_use_id 의 두 행이 별개 (event_type='tool' + 'pre_tool').
    const tuid = 'tu-race-ooo';
    const post = makePayload({
      id: 'post-ooo', session_id: sessionId, event_type: 'tool',
      tool_use_id: tuid, timestamp: now + 1000,
      tokens_total: 50, duration_ms: 200,
    });
    const pre = makePayload({
      id: 'pre-ooo', session_id: sessionId, event_type: 'pre_tool',
      tool_use_id: tuid, timestamp: now,
    });

    const r1 = saveRequest(db.instance, post);
    expect(r1.saved).toBe(true);
    expect(r1.wasUpsert).toBe(false);  // out-of-order → 머지 미발생

    const r2 = saveRequest(db.instance, pre);
    expect(r2.saved).toBe(true);
    expect(r2.wasUpsert).toBe(false);

    // 두 행 별개 저장 — 같은 tool_use_id 지만 머지되지 않음.
    const rows = fetchAllRows(db.instance, sessionId);
    expect(rows.length).toBe(2);
    const ids = rows.map(r => r.id).sort();
    expect(ids).toEqual(['post-ooo', 'pre-ooo']);
    const types = new Set(rows.map(r => r.event_type));
    expect(types).toEqual(new Set(['tool', 'pre_tool']));
  });

  it('중복 PreToolUse — 같은 tool_use_id 의 두 pre 행은 둘 다 INSERT', () => {
    // UNIQUE constraint 없으므로 둘 다 저장. 두 번째 post 가 와도 LIMIT 1 로 한 행만 머지.
    const tuid = 'tu-race-dup-pre';
    const pre1 = makePayload({
      id: 'pre-dup-1', session_id: sessionId, event_type: 'pre_tool',
      tool_use_id: tuid, timestamp: now,
    });
    const pre2 = makePayload({
      id: 'pre-dup-2', session_id: sessionId, event_type: 'pre_tool',
      tool_use_id: tuid, timestamp: now + 500,
    });

    expect(saveRequest(db.instance, pre1).saved).toBe(true);
    expect(saveRequest(db.instance, pre2).saved).toBe(true);

    const rows = fetchAllRows(db.instance, sessionId)
      .filter(r => r.tool_use_id === tuid);
    expect(rows.length).toBe(2);
    for (const r of rows) expect(r.event_type).toBe('pre_tool');
  });

  it('중복 PostToolUse — 이미 머지된 행 + 두 번째 post 는 fallthrough INSERT', () => {
    // 첫 post 가 pre 행을 'tool' 로 머지. 두 번째 post 가 도착 시 pre 매칭 실패
    // (event_type='tool' 이라 LIMIT 1 SELECT 가 NULL).
    // → 일반 INSERT 분기, 별도 행 저장.
    const tuid = 'tu-race-dup-post';
    const pre = makePayload({
      id: 'pre-2', session_id: sessionId, event_type: 'pre_tool',
      tool_use_id: tuid, timestamp: now,
    });
    const post1 = makePayload({
      id: 'post-2a', session_id: sessionId, event_type: 'tool',
      tool_use_id: tuid, timestamp: now + 1000,
      tokens_total: 50,
    });
    const post2 = makePayload({
      id: 'post-2b', session_id: sessionId, event_type: 'tool',
      tool_use_id: tuid, timestamp: now + 2000,
      tokens_total: 70,
    });

    saveRequest(db.instance, pre);
    const r1 = saveRequest(db.instance, post1);
    expect(r1.wasUpsert).toBe(true);
    expect(r1.savedId).toBe('pre-2');

    const r2 = saveRequest(db.instance, post2);
    expect(r2.saved).toBe(true);
    // 첫 머지 이후 pre 가 'tool' 이라 두 번째 post 는 머지 미발생 → 새 행.
    expect(r2.wasUpsert).toBe(false);

    const rows = fetchAllRows(db.instance, sessionId)
      .filter(r => r.tool_use_id === tuid);
    expect(rows.length).toBe(2);
    // pre-2 머지된 행 + post-2b 새 INSERT 행.
    const ids = rows.map(r => r.id).sort();
    expect(ids).toEqual(['post-2b', 'pre-2']);
    // 머지된 행은 tokens_total=50 (첫 post), 새 행은 70 (두 번째 post).
    const merged = rows.find(r => r.id === 'pre-2');
    const standalone = rows.find(r => r.id === 'post-2b');
    expect(merged!.tokens_total).toBe(50);
    expect(standalone!.tokens_total).toBe(70);
  });

  it('다른 session_id 의 같은 tool_use_id — 머지 격리 (session 별 SSoT)', () => {
    const tuid = 'tu-race-cross-session';
    const otherSessionId = crypto.randomUUID();
    createSession(db.instance, {
      id: otherSessionId,
      project_name: 'race-test',
      started_at: now - 30_000,
    });

    const preA = makePayload({
      id: 'pre-A', session_id: sessionId, event_type: 'pre_tool',
      tool_use_id: tuid, timestamp: now,
    });
    const postB = makePayload({
      id: 'post-B', session_id: otherSessionId, event_type: 'tool',
      tool_use_id: tuid, timestamp: now + 1000, tokens_total: 100,
    });

    saveRequest(db.instance, preA);
    const r = saveRequest(db.instance, postB);
    // post 가 다른 세션 → A 세션의 pre 와 매칭 안 됨 → 일반 INSERT.
    expect(r.wasUpsert).toBe(false);

    const rowsA = fetchAllRows(db.instance, sessionId);
    const rowsB = fetchAllRows(db.instance, otherSessionId);
    expect(rowsA.length).toBe(1);
    expect(rowsA[0].event_type).toBe('pre_tool');
    expect(rowsB.length).toBe(1);
    expect(rowsB[0].event_type).toBe('tool');
  });
});
