/**
 * T5 — 세션 첫 요청이 tool_call(prompt 선행 없음) 일 때 turn_id NULL 현재 동작 고정.
 *
 * 검증 목적 (turn.ts getLastTurnId / persist.ts 일반 INSERT 경로 특성화):
 *   turn_id 는 prompt 도착 시에만 채번(assignTurnId)된다. prompt 가 한 번도 없는 세션에
 *   tool_call(pre_tool/tool) 이 먼저 들어오면 getLastTurnId 가 null 을 반환하고,
 *   persist.runInsert 는 turn_id=undefined → DB 에 NULL 로 저장된다(현재 동작).
 *
 *   - pre_tool first (prompt 없음): turn_id NULL.
 *   - post-first tool (prompt 없음): turn_id NULL.
 *   - 이후 prompt 가 도착하면 그 prompt 부터 `<sess>-T1` 채번, 그 다음 tool 은 T1 재사용.
 *     (= 이전에 NULL 로 들어간 tool 행은 소급 보정되지 않음 — orphan 잔존 특성화.)
 *
 * 격리: 고유 임시 DB + afterEach 본체/-wal/-shm 삭제 + closeDatabase(). sessionId 는 uuid.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { unlinkSync } from 'fs';
import type { Database } from 'bun:sqlite';
import { SpyglassDatabase, closeDatabase, createSession } from '@spyglass/storage';
import { saveRequest } from '../persist';
import type { NormalizedHookPayload } from '../types';

const TEST_DB_PATH = `/tmp/spyglass-turn-undef-${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}.db`;

function fetchRow(inst: Database, id: string): { turn_id: string | null } | null {
  return inst.query('SELECT turn_id FROM requests WHERE id = ?').get(id) as
    | { turn_id: string | null }
    | null;
}

function makeTool(opts: {
  id: string;
  session_id: string;
  event_type: 'pre_tool' | 'tool';
  tool_use_id: string;
  timestamp: number;
}): NormalizedHookPayload {
  return {
    id: opts.id,
    session_id: opts.session_id,
    project_name: 'turn-undef-test',
    timestamp: opts.timestamp,
    event_type: opts.event_type,
    request_type: 'tool_call',
    tool_name: 'Bash',
    tool_detail: 'ls',
    tokens_input: 0,
    tokens_output: 0,
    tokens_total: 0,
    duration_ms: 0,
    payload: JSON.stringify({ tool_use_id: opts.tool_use_id }),
    source: 'test',
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    tokens_confidence: 'high',
    tokens_source: 'transcript',
  };
}

function makePrompt(opts: {
  id: string;
  session_id: string;
  timestamp: number;
}): NormalizedHookPayload {
  return {
    id: opts.id,
    session_id: opts.session_id,
    project_name: 'turn-undef-test',
    timestamp: opts.timestamp,
    event_type: 'prompt',
    request_type: 'prompt',
    tokens_input: 0,
    tokens_output: 0,
    tokens_total: 0,
    duration_ms: 0,
    payload: JSON.stringify({ prompt: 'hi' }),
    source: 'test',
    tokens_confidence: 'high',
    tokens_source: 'transcript',
  };
}

describe('T5 — 세션 첫 요청이 tool_call → turn_id NULL', () => {
  let db: SpyglassDatabase;
  let sessionId: string;
  const now = Date.now() - 60_000;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
    sessionId = crypto.randomUUID();
    createSession(db.instance, {
      id: sessionId,
      project_name: 'turn-undef-test',
      started_at: now - 30_000,
    });
  });

  afterEach(() => {
    closeDatabase();
    for (const ext of ['', '-wal', '-shm']) {
      try { unlinkSync(`${TEST_DB_PATH}${ext}`); } catch { /* ignore */ }
    }
  });

  it('prompt 없이 pre_tool 가 첫 요청 → turn_id NULL', () => {
    saveRequest(db.instance, makeTool({
      id: 'pre-first', session_id: sessionId, event_type: 'pre_tool',
      tool_use_id: 'tu-no-prompt-pre', timestamp: now,
    }));
    expect(fetchRow(db.instance, 'pre-first')?.turn_id).toBeNull();
  });

  it('prompt 없이 post-first tool 가 첫 요청 → turn_id NULL', () => {
    saveRequest(db.instance, makeTool({
      id: 'tool-first', session_id: sessionId, event_type: 'tool',
      tool_use_id: 'tu-no-prompt-tool', timestamp: now + 100,
    }));
    expect(fetchRow(db.instance, 'tool-first')?.turn_id).toBeNull();
  });

  it('prompt 가 나중에 도착해도 이전 NULL tool 행은 소급 보정되지 않음 (orphan 잔존)', () => {
    // 1) prompt 없이 tool → NULL
    saveRequest(db.instance, makeTool({
      id: 'orphan-tool', session_id: sessionId, event_type: 'tool',
      tool_use_id: 'tu-orphan', timestamp: now + 100,
    }));
    // 2) prompt 도착 → T1 채번
    saveRequest(db.instance, makePrompt({ id: 'late-prompt', session_id: sessionId, timestamp: now + 200 }));
    // 3) 그 다음 tool → T1 재사용
    saveRequest(db.instance, makeTool({
      id: 'tool-after-prompt', session_id: sessionId, event_type: 'tool',
      tool_use_id: 'tu-after', timestamp: now + 300,
    }));

    // orphan tool 은 여전히 NULL (소급 보정 없음).
    expect(fetchRow(db.instance, 'orphan-tool')?.turn_id).toBeNull();
    // prompt 는 T1.
    expect(fetchRow(db.instance, 'late-prompt')?.turn_id).toBe(`${sessionId}-T1`);
    // prompt 이후 tool 은 T1 재사용.
    expect(fetchRow(db.instance, 'tool-after-prompt')?.turn_id).toBe(`${sessionId}-T1`);
  });
});
