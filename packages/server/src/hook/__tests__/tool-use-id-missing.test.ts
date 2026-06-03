/**
 * T12 — tool_use_id 없는 tool_call 의 저장 분기 현재 동작 고정.
 *
 * 검증 목적 (persist.ts saveRequest 의 toolUseId 가드 특성화):
 *   Upsert 매칭·멱등 흡수는 모두 `toolUseId` 가 있어야 동작한다(extractToolUseId(payload.payload)).
 *   payload 에 tool_use_id 가 없으면(또는 payload 자체가 없으면):
 *     - post_tool: pre 매칭/흡수 분기를 *건너뛰고* 일반 INSERT → event_type='tool', tool_use_id NULL.
 *     - 같은 상황의 post 2건은 흡수되지 않고 *별도 2행* 으로 INSERT (중복 방지 키 부재).
 *     - pre_tool: 흡수 분기 건너뜀 → pre_tool 행 INSERT, tool_use_id NULL.
 *
 *   ⇒ tool_use_id 가 없으면 멱등성 보장이 사라진다(현재 동작/위험). 본 테스트는 고정만 한다.
 *
 * 격리: 고유 임시 DB + afterEach 본체/-wal/-shm 삭제 + closeDatabase(). sessionId 는 uuid.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { unlinkSync } from 'fs';
import type { Database } from 'bun:sqlite';
import { SpyglassDatabase, closeDatabase, createSession } from '@spyglass/storage';
import { saveRequest } from '../persist';
import type { NormalizedHookPayload } from '../types';

const TEST_DB_PATH = `/tmp/spyglass-tuid-missing-${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}.db`;

function fetchRows(inst: Database, sessionId: string) {
  return inst.query(
    'SELECT id, event_type, tool_use_id FROM requests WHERE session_id = ? ORDER BY timestamp ASC',
  ).all(sessionId) as Array<{ id: string; event_type: string | null; tool_use_id: string | null }>;
}

/** payload 에서 tool_use_id 를 의도적으로 비운 tool_call. payload 자체는 유효 JSON(빈 객체). */
function makeNoTuid(opts: {
  id: string;
  session_id: string;
  event_type: 'pre_tool' | 'tool';
  timestamp: number;
  tokens_total?: number;
}): NormalizedHookPayload {
  return {
    id: opts.id,
    session_id: opts.session_id,
    project_name: 'tuid-missing-test',
    timestamp: opts.timestamp,
    event_type: opts.event_type,
    request_type: 'tool_call',
    tool_name: 'Bash',
    tool_detail: 'ls',
    tokens_input: 0,
    tokens_output: opts.tokens_total ?? 0,
    tokens_total: opts.tokens_total ?? 0,
    duration_ms: 0,
    payload: JSON.stringify({ no_tool_use_id: true }), // tool_use_id 부재
    source: 'test',
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    tokens_confidence: 'high',
    tokens_source: 'transcript',
  };
}

describe('T12 — tool_use_id 없는 tool_call', () => {
  let db: SpyglassDatabase;
  let sessionId: string;
  const now = Date.now() - 60_000;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
    sessionId = crypto.randomUUID();
    createSession(db.instance, {
      id: sessionId,
      project_name: 'tuid-missing-test',
      started_at: now - 30_000,
    });
  });

  afterEach(() => {
    closeDatabase();
    for (const ext of ['', '-wal', '-shm']) {
      try { unlinkSync(`${TEST_DB_PATH}${ext}`); } catch { /* ignore */ }
    }
  });

  it('post_tool (tool_use_id 없음) → 일반 INSERT, event_type=tool, tool_use_id NULL', () => {
    const r = saveRequest(db.instance, makeNoTuid({
      id: 'no-tuid-post', session_id: sessionId, event_type: 'tool',
      timestamp: now + 1000, tokens_total: 25,
    }));
    expect(r.saved).toBe(true);
    expect(r.wasUpsert).toBe(false);
    expect(r.duplicate).toBeUndefined();

    const rows = fetchRows(db.instance, sessionId);
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('no-tuid-post');
    expect(rows[0].event_type).toBe('tool');
    expect(rows[0].tool_use_id).toBeNull();
  });

  it('post_tool 2건 (모두 tool_use_id 없음) → 흡수되지 않고 별도 2행 (멱등성 부재)', () => {
    saveRequest(db.instance, makeNoTuid({
      id: 'no-tuid-a', session_id: sessionId, event_type: 'tool',
      timestamp: now + 1000, tokens_total: 25,
    }));
    const r2 = saveRequest(db.instance, makeNoTuid({
      id: 'no-tuid-b', session_id: sessionId, event_type: 'tool',
      timestamp: now + 2000, tokens_total: 25,
    }));
    // tool_use_id 부재 → findToolRecord 흡수 분기 미진입 → 일반 INSERT.
    expect(r2.duplicate).toBeUndefined();

    const rows = fetchRows(db.instance, sessionId);
    expect(rows.length).toBe(2);
    for (const row of rows) expect(row.tool_use_id).toBeNull();
  });

  it('pre_tool (tool_use_id 없음) → pre_tool 행 INSERT, 흡수 분기 미진입', () => {
    const r = saveRequest(db.instance, makeNoTuid({
      id: 'no-tuid-pre', session_id: sessionId, event_type: 'pre_tool',
      timestamp: now,
    }));
    expect(r.saved).toBe(true);
    expect(r.wasUpsert).toBe(false);
    expect(r.duplicate).toBeUndefined();

    const rows = fetchRows(db.instance, sessionId);
    expect(rows.length).toBe(1);
    expect(rows[0].event_type).toBe('pre_tool');
    expect(rows[0].tool_use_id).toBeNull();
  });

  it('payload 자체가 undefined 인 post_tool → 일반 INSERT (extractToolUseId null 가드)', () => {
    const base = makeNoTuid({
      id: 'no-payload-post', session_id: sessionId, event_type: 'tool',
      timestamp: now + 3000, tokens_total: 10,
    });
    const r = saveRequest(db.instance, { ...base, payload: undefined });
    expect(r.saved).toBe(true);
    expect(r.wasUpsert).toBe(false);
    const rows = fetchRows(db.instance, sessionId).filter(x => x.id === 'no-payload-post');
    expect(rows.length).toBe(1);
    expect(rows[0].event_type).toBe('tool');
    expect(rows[0].tool_use_id).toBeNull();
  });
});
